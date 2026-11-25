-- Tool: financials_analyze_financial_transactions
-- Source: Invoice V2 (app.invoices_v2 / _items / _item_breakdowns), the processed invoice layer
-- that replaced the retired SP-API financial transaction lines. Classification uses the same
-- staging.financial_transaction_class_map (match_key x sign x fulfillment) with the
-- staging.service_summary_class_map service fallback, as the Amazon Profitability source does.
-- Coverage is limited to companies/periods loaded into Invoice V2. Amounts are native currency.
-- The optional {{period_expr}} adds day/week/month/quarter/year time buckets;
-- periodicity='none' preserves the class/subclass/currency report shape.
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
v2_lines AS (
    SELECT
        toInt64(h.company_id)                                        AS company_id,
        formatDateTime(toDate(b.date), '%Y-%m')                      AS posted_month,
        toDate(b.date)                                               AS posted_date_day,
        coalesce(m.amazon_marketplace_id, '')                        AS marketplace_id,
        coalesce(m.name, '')                                         AS marketplace_name,
        i.amount_type                                                AS breakdown_type,
        i.description                                                AS description,
        lowerUTF8(trimBoth(coalesce(s.name, '')))                    AS service_name,
        upper(b.currency)                                            AS currency,
        toFloat64(b.amount)                                          AS amount
    FROM app.invoices_v2 h
    INNER JOIN app.invoices_v2_items i ON i.invoice_id = h.id
    INNER JOIN app.invoices_v2_item_breakdowns b ON b.item_id = i.id AND b.invoice_id = h.id
    LEFT JOIN app.services s ON toInt64(s.id) = toInt64(i.service_id)
    LEFT JOIN app.amazon_marketplaces m ON toInt64(m.id) = toInt64(h.marketplace_id)
    WHERE h.source = 'amazon'
      AND toInt64(h.company_id) = (SELECT company_id FROM params)
),
source_rows AS (
    SELECT r.*
    FROM v2_lines r
    CROSS JOIN params p
    WHERE (length(p.report_months) = 0 OR has(p.report_months, r.posted_month))
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
            WHEN service_key IN ('principal chargeback refund', 'commission chargeback refund',
                                 'refundcommission chargeback refund')
                THEN 'ChargebackRefund:' || breakdown_type
            WHEN breakdown_type IN ('Base', 'BaseTax', 'Promo')
                THEN breakdown_type || ':' || COALESCE(description, '')
            WHEN breakdown_type = 'FBADisposalFee' AND posted_date_day < toDate('2026-06-19')
                THEN 'FBADisposalFee:legacy'
            WHEN breakdown_type = 'Tax'
                 AND (description = 'Adjustment' OR endsWith(service_name, ' adjustment'))
                THEN breakdown_type || ':' || COALESCE(description, '')
            ELSE breakdown_type
        END                    AS match_key,
        multiIf(startsWith(service_name, 'non-amazon '), 'MFN',
                startsWith(service_name, 'amazon mcf '), 'MCF', 'AFN') AS fulfillment_network,
        replaceRegexpOne(service_name, '^(amazon mcf |non-amazon |amazon |shopify )', '') AS service_key,
        replaceRegexpOne(service_key, ' (order|refund|other-transaction|liquidations)$', '') AS service_token,
        currency,
        posted_date_day,
        amount
    FROM source_rows
    WHERE amount <> 0
),
priced_lines AS (
    SELECT
        l.match_key,
        l.fulfillment_network,
        l.service_key,
        l.service_token,
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
        ASOF LEFT JOIN fx fr
      ON fr.currency_key = lower(l.currency)
         AND fr.rate_date <= l.posted_date_day
        ASOF LEFT JOIN fx fc
      ON fc.currency_key = lower(p.consolidation_currency)
         AND fc.rate_date <= l.posted_date_day
),
transaction_class_map AS (
    SELECT match_key, sign, fulfillment, summary_class, summary_subclass, class_order, subclass_order
    FROM {{database}}.financial_transaction_class_map
),
service_class_map AS (
    SELECT service_key, summary_class, summary_subclass, class_order, subclass_order
    FROM {{database}}.service_summary_class_map
    ORDER BY service_key, summary_class, summary_subclass
    LIMIT 1 BY service_key
),
resolved AS (
    SELECT
        l.match_key           AS match_key,
        l.currency            AS currency,
        l.posted_date_day     AS posted_date_day,
        l.amount              AS amount,
        l.amount_consolidated AS amount_consolidated,
        l.fx_missing          AS fx_missing,
        COALESCE(ms.summary_class,    mw.summary_class,    sc.summary_class,    st.summary_class)    AS summary_class,
        COALESCE(ms.summary_subclass, mw.summary_subclass, sc.summary_subclass, st.summary_subclass) AS summary_subclass,
        COALESCE(ms.class_order,      mw.class_order,      sc.class_order,      st.class_order)      AS class_order,
        COALESCE(ms.subclass_order,   mw.subclass_order,   sc.subclass_order,   st.subclass_order)   AS subclass_order
    FROM priced_lines l
    LEFT JOIN transaction_class_map ms
      ON ms.match_key = l.match_key
     AND ms.sign = CASE WHEN l.amount >= 0 THEN 'POS' ELSE 'NEG' END
     AND ms.fulfillment = l.fulfillment_network
    LEFT JOIN transaction_class_map mw
      ON mw.match_key = l.match_key
     AND mw.sign = CASE WHEN l.amount >= 0 THEN 'POS' ELSE 'NEG' END
     AND mw.fulfillment = '*'
    LEFT JOIN service_class_map sc ON sc.service_key = l.service_key
    LEFT JOIN service_class_map st ON st.service_key = l.service_token
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
