-- Tool: financials_analyze_financial_transactions_ch  (ClickHouse pilot)
-- ClickHouse translation of ../analyze_financial_transactions/query.sql (v1 LONG-format
-- source). Same classification model and output contract; see that file for the full
-- commentary. Dialect changes only:
--   cardinality() -> length(), contains() -> has(), any_match(a, x -> ..) ->
--   arrayExists(x -> .., a), CAST(x AS DOUBLE) -> toFloat64(x), DATE 'x' -> toDate('x').
-- Data source: ClickHouse tables loaded from the Iceberg lake (one-time snapshot for the
-- migration pilot; incremental pipeline pending).
-- DIVERGENCE from the (now deprecated) Athena twin: this version threads posted_date_day
-- forward and adds an optional time bucket ({{period_expr}} -> the `period` column) so
-- results can be broken out by day/week/month/quarter/year. period is NULL when
-- periodicity='none', which reproduces the original class/subclass/currency grouping.
WITH params AS (
    SELECT
        toInt64({{company_id}})         AS company_id,
        {{report_months_array}}         AS report_months,
        {{marketplaces_array}}          AS marketplaces,
        {{start_date}}                  AS start_date,
        {{end_date}}                    AS end_date,
        {{summary_classes_array}}       AS summary_classes,
        {{summary_subclasses_array}}    AS summary_subclasses,
        {{consolidation_currency}}      AS consolidation_currency,
        {{limit_top_n}}                 AS limit_top_n
),
fx AS (
    SELECT lower(currency) AS currency_key, date AS rate_date, MAX(toFloat64(rate)) AS rate
    FROM {{database}}.currency_rates
    GROUP BY lower(currency), date
),
source_rows AS (
    SELECT r.*
    -- Serving VIEW (analytics): reproduces Iceberg's per-transaction restate/delete fidelity
    -- (latest generation per company_id+transaction_id, tombstones excluded). Live via the
    -- S3 ClickPipe fed by the aws_etl Lambda. Dims (currency_rates, class_map) stay in staging.
    FROM analytics.financial_transaction_lines_v1_current r
    CROSS JOIN params p
    WHERE toInt64(r.company_id) = p.company_id
      AND (length(p.report_months) = 0 OR has(p.report_months, r.posted_month))
      AND (
          length(p.marketplaces) = 0
          OR arrayExists(m -> lower(m) = lower(r.marketplace_name), p.marketplaces)
          OR has(p.marketplaces, r.marketplace_id)
      )
      AND (p.start_date IS NULL OR r.posted_date_day >= p.start_date)
      AND (p.end_date   IS NULL OR r.posted_date_day <= p.end_date)
),
all_lines AS (
    SELECT
        CASE
            WHEN breakdown_type IN ('Base', 'BaseTax')
                THEN breakdown_type || ':' || COALESCE(description, '')
            WHEN breakdown_type = 'Promo' AND transaction_type = 'ServiceFee'
                THEN breakdown_type || ':' || COALESCE(description, '')
            WHEN breakdown_type = 'FBADisposalFee' AND posted_date_day < toDate('2026-06-19')
                THEN 'FBADisposalFee:legacy'
            WHEN breakdown_type = 'Tax' AND transaction_type = 'Adjustment'
                THEN breakdown_type || ':' || COALESCE(description, '')
            ELSE breakdown_type
        END                    AS match_key,
        fulfillment_network,
        currency,
        posted_date_day,
        toFloat64(amount)      AS amount
    FROM source_rows
    WHERE amount IS NOT NULL AND amount <> 0
),
priced_lines AS (
    SELECT
        l.match_key,
        l.fulfillment_network,
        COALESCE(l.currency, 'UNKNOWN') AS currency,
        l.posted_date_day,
        l.amount,
        CASE WHEN p.consolidation_currency IS NOT NULL
                  AND fr.rate IS NOT NULL AND fc.rate IS NOT NULL AND fc.rate <> 0
             THEN l.amount * fr.rate / fc.rate
        END AS amount_consolidated,
        CASE WHEN p.consolidation_currency IS NOT NULL
                  AND (fr.rate IS NULL OR fc.rate IS NULL OR fc.rate = 0)
             THEN 1 ELSE 0
        END AS fx_missing
    FROM all_lines l
    CROSS JOIN params p
    LEFT JOIN fx fr
      ON fr.currency_key = lower(l.currency)
     AND fr.rate_date = l.posted_date_day
    LEFT JOIN fx fc
      ON fc.currency_key = lower(p.consolidation_currency)
     AND fc.rate_date = l.posted_date_day
),
transaction_class_map AS (
    SELECT match_key, sign, fulfillment, summary_class, summary_subclass, class_order, subclass_order
    FROM {{database}}.financial_transaction_class_map
),
resolved AS (
    SELECT
        l.match_key           AS match_key,
        l.currency            AS currency,
        l.posted_date_day     AS posted_date_day,
        l.amount              AS amount,
        l.amount_consolidated AS amount_consolidated,
        l.fx_missing          AS fx_missing,
        COALESCE(ms.summary_class,    mw.summary_class)    AS summary_class,
        COALESCE(ms.summary_subclass, mw.summary_subclass) AS summary_subclass,
        COALESCE(ms.class_order,      mw.class_order)      AS class_order,
        COALESCE(ms.subclass_order,   mw.subclass_order)   AS subclass_order
    FROM priced_lines l
    LEFT JOIN transaction_class_map ms
      ON ms.match_key = l.match_key
     AND ms.sign = CASE WHEN l.amount >= 0 THEN 'POS' ELSE 'NEG' END
     AND ms.fulfillment = l.fulfillment_network
    LEFT JOIN transaction_class_map mw
      ON mw.match_key = l.match_key
     AND mw.sign = CASE WHEN l.amount >= 0 THEN 'POS' ELSE 'NEG' END
     AND mw.fulfillment = '*'
),
combined AS (
    SELECT
        COALESCE(summary_class, 'Unclassified')               AS summary_class,
        COALESCE(summary_subclass, 'Unmapped: ' || match_key) AS summary_subclass,
        COALESCE(class_order, 9)                              AS class_order,
        COALESCE(subclass_order, 999)                         AS subclass_order,
        currency,
        -- Time bucket over the marketplace-local posted day. {{period_expr}} is
        -- CAST(NULL AS Nullable(Date)) when periodicity='none' (single group,
        -- period=NULL), else toStartOf{Day,Week,Month,Quarter,Year}(posted_date_day).
        {{period_expr}}                                       AS period,
        amount,
        amount_consolidated,
        fx_missing
    FROM resolved
),
subclass_summary AS (
    SELECT
        summary_class,
        summary_subclass,
        currency,
        period,
        MIN(class_order) AS class_order,
        MIN(subclass_order) AS subclass_order,
        SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END) AS debits,
        SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS credits,
        SUM(amount) AS net_amount,
        SUM(amount_consolidated) AS net_amount_consolidated,
        SUM(fx_missing) AS fx_missing_lines,
        COUNT(*) AS line_count
    FROM combined
    GROUP BY summary_class, summary_subclass, currency, period
),
final_rows AS (
    SELECT s.*
    FROM subclass_summary s
    CROSS JOIN params p
    WHERE (
        length(p.summary_classes) = 0
        OR arrayExists(c -> lower(c) = lower(s.summary_class), p.summary_classes)
    )
      AND (
        length(p.summary_subclasses) = 0
        OR arrayExists(sc -> lower(s.summary_subclass) LIKE '%' || lower(sc) || '%', p.summary_subclasses)
    )
)
SELECT
    f.period,
    f.class_order,
    f.subclass_order,
    f.summary_class,
    f.summary_subclass,
    f.currency,
    round(f.debits, 2)  AS debits,
    round(f.credits, 2) AS credits,
    round(f.net_amount, 2) AS net_amount,
    p.consolidation_currency,
    round(f.net_amount_consolidated, 2) AS net_amount_consolidated,
    f.fx_missing_lines,
    f.line_count
FROM final_rows f
CROSS JOIN params p
-- period leads the ordering so time-series results come back chronologically;
-- when periodicity='none' every period is NULL, so this leading key is a no-op.
ORDER BY period ASC, {{sort_column}} {{sort_direction}}, class_order ASC, subclass_order ASC, currency ASC
LIMIT {{limit_top_n}}
