-- Tool: financials_analyze_financial_transactions  (v1 LONG-format source)
-- Purpose: Summarize SP-API financial transactions into monthly summary report
--          classes, mirroring Amazon's Date Range Summary report.
--
-- SOURCE: neonpanel_iceberg.financial_transaction_lines_v1 -- the LONG / leaf-grain
--   table (one row per breakdown leaf; verbatim breakdown_type; NO bd_* pivot, NO
--   bd_other). This replaces the old bd_* wide table + in-SQL unpivot. Because the
--   leaf grain already exists, there is no UNION-ALL unpivot here anymore: each row
--   is already one classified line. (Backup of the old bd_* query: query.v0.sql.bak.)
--
-- Classification model:
--   * Money is classified at the BREAKDOWN (leaf) level. The table's breakdown_type
--     IS the match_key: verbatim leaf type for line_kind='breakdown', or the
--     'TXN:<type>[:<description>]' composite for line_kind='txn' (breakdown-less
--     transactions such as Transfer / FBAInventoryReimbursement).
--   * The class is constant per breakdown type; only the subclass flips with the
--     sign of the amount (charge vs refund). SUM of all classified lines reconciles
--     to SUM(item_total) because SUM(leaf amount) == item_total per source row.
--
-- CLASS MAP: read from the maintained physical table
--   neonpanel_iceberg.financial_transaction_class_map (same table QuickSight uses,
--   incl. the _v1 additions that classify the fee types previously hidden in
--   bd_other -- FBAStorageFee, FBAInventoryReimbursement, ReserveDebit, etc.).
--   New/unmapped leaf types fall to 'Unclassified' (visible), never dropped.

WITH params AS (
    SELECT
        CAST({{company_id}} AS BIGINT) AS company_id,
        {{report_months_array}} AS report_months,
        {{marketplaces_array}} AS marketplaces,
        {{start_date}} AS start_date,
        {{end_date}} AS end_date,
        {{summary_classes_array}} AS summary_classes,
        {{summary_subclasses_array}} AS summary_subclasses,
        {{consolidation_currency}} AS consolidation_currency,
        {{limit_top_n}} AS limit_top_n
),
-- Daily FX rates, USD-base multipliers: rate = USD per 1 unit of currency
-- (USD itself is present with rate 1.0). Used to convert each line at its
-- posted_date_day: amount_consolidated = amount * rate(line ccy) / rate(target).
fx AS (
    SELECT lower(currency) AS currency_key, date AS rate_date, MAX(rate) AS rate
    FROM "{{catalog}}"."neonpanel_iceberg"."currency_rates"
    GROUP BY lower(currency), date
),
-- posted_month and posted_date_day are derived in the MARKETPLACE-LOCAL report
-- timezone (US/CA=Pacific, UK=London, EU=CET, JP=Tokyo, AU=Sydney), so filtering
-- on them matches Amazon's report calendar. start_date/end_date bound the local
-- day (posted_date_day) inclusively; report_months bounds the local month.
source_rows AS (
    SELECT r.*
    FROM "{{catalog}}"."neonpanel_iceberg"."financial_transaction_lines_v1" r
    CROSS JOIN params p
    WHERE CAST(r.company_id AS BIGINT) = p.company_id
      AND (
          cardinality(p.report_months) = 0
          OR contains(p.report_months, r.posted_month)
      )
      AND (
          cardinality(p.marketplaces) = 0
          OR any_match(p.marketplaces, m -> lower(m) = lower(r.marketplace_name))
          OR contains(p.marketplaces, r.marketplace_id)
      )
      AND (p.start_date IS NULL OR r.posted_date_day >= p.start_date)
      AND (p.end_date   IS NULL OR r.posted_date_day <= p.end_date)
),
-- Each leaf row is already one line. breakdown_type is the classification key.
-- Ambiguous leaves get a composite key (same rule as financial_transaction_ledger_v1):
--   Base/BaseTax orphans and ServiceFee-context Promo carry their meaning in the txn
--   description (Base:AWDTransportationFee, BaseTax:Retrocharge, Promo:AWDTransportationFee).
all_lines AS (
    SELECT
        CASE
            WHEN breakdown_type IN ('Base', 'BaseTax')
                THEN breakdown_type || ':' || COALESCE(description, '')
            WHEN breakdown_type = 'Promo' AND transaction_type = 'ServiceFee'
                THEN breakdown_type || ':' || COALESCE(description, '')
            -- Amazon reclassified disposal fees mid-June 2026 (inventory -> transaction fees);
            -- legacy key keeps pre-cutover rows on the inventory line, matching Amazon statements.
            WHEN breakdown_type = 'FBADisposalFee' AND posted_date_day < DATE '2026-06-19'
                THEN 'FBADisposalFee:legacy'
            -- Adjustment-context Tax orphans (liquidation adjustments) are collected-side.
            WHEN breakdown_type = 'Tax' AND transaction_type = 'Adjustment'
                THEN breakdown_type || ':' || COALESCE(description, '')
            ELSE breakdown_type
        END                 AS match_key,
        fulfillment_network,
        currency,
        posted_date_day,
        CAST(amount AS DOUBLE) AS amount
    FROM source_rows
    WHERE amount IS NOT NULL AND amount <> 0
),
-- Per-line FX conversion at the line's posted_date_day. amount_consolidated is
-- NULL when no consolidation_currency was requested OR a needed daily rate is
-- missing (fx_missing flags the latter -- never silently assume rate=1.0).
priced_lines AS (
    SELECT
        l.match_key,
        l.fulfillment_network,
        COALESCE(l.currency, 'UNKNOWN') AS currency,
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
-- Classification rules from the maintained physical table (shared with QuickSight).
--   sign: 'POS' (amount >= 0), 'NEG' (amount < 0).
--   fulfillment: 'AFN' / 'MFN' for fulfillment-specific rules, '*' = any.
--   Resolution prefers a fulfillment-specific row over the '*' fallback.
transaction_class_map AS (
    SELECT match_key, sign, fulfillment, summary_class, summary_subclass, class_order, subclass_order
    FROM "{{catalog}}"."neonpanel_iceberg"."financial_transaction_class_map"
),
-- Resolve each line once: a fulfillment-specific rule wins over the '*' fallback.
resolved AS (
    SELECT
        l.match_key,
        l.currency,
        l.amount,
        l.amount_consolidated,
        l.fx_missing,
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
-- Lines with no matching rule fall to 'Unclassified' so totals never silently
-- drop; surfaces new Amazon breakdown/transaction types for triage.
combined AS (
    SELECT
        COALESCE(summary_class, 'Unclassified')               AS summary_class,
        COALESCE(summary_subclass, 'Unmapped: ' || match_key) AS summary_subclass,
        COALESCE(class_order, 9)                              AS class_order,
        COALESCE(subclass_order, 999)                         AS subclass_order,
        currency,
        amount,
        amount_consolidated,
        fx_missing
    FROM resolved
),
-- One row per (class, subclass, CURRENCY): local-currency figures must never be
-- summed across currencies; the *_consolidated figures (single target currency)
-- are the ones safe to aggregate across rows.
subclass_summary AS (
    SELECT
        summary_class,
        summary_subclass,
        currency,
        MIN(class_order) AS class_order,
        MIN(subclass_order) AS subclass_order,
        SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END) AS debits,
        SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS credits,
        SUM(amount) AS net_amount,
        SUM(amount_consolidated) AS net_amount_consolidated,
        SUM(fx_missing) AS fx_missing_lines,
        COUNT(*) AS line_count
    FROM combined
    GROUP BY 1, 2, 3
),
final_rows AS (
    SELECT s.*
    FROM subclass_summary s
    CROSS JOIN params p
    WHERE (
        cardinality(p.summary_classes) = 0
        OR any_match(p.summary_classes, c -> lower(c) = lower(s.summary_class))
    )
      AND (
        cardinality(p.summary_subclasses) = 0
        OR any_match(p.summary_subclasses, sc -> lower(s.summary_subclass) LIKE '%' || lower(sc) || '%')
    )
)
SELECT
    f.class_order,
    f.subclass_order,
    f.summary_class,
    f.summary_subclass,
    f.currency,
    f.debits,
    f.credits,
    f.net_amount,
    p.consolidation_currency,
    f.net_amount_consolidated,
    f.fx_missing_lines,
    f.line_count
FROM final_rows f
CROSS JOIN params p
ORDER BY {{sort_column}} {{sort_direction}}, f.class_order ASC, f.subclass_order ASC, f.currency ASC
LIMIT {{limit_top_n}}
