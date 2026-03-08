-- Tool: financials_classify_amazon_statement_transactions (default / CoA-based mode)
-- Purpose: Aggregate classified settlement transactions by Chart of Accounts mapping.
--          Joins service_name → services.name → accounts (with parent chain)
--          to produce totals grouped by account_classification / account_type / account_name.
-- Source: sp_api_iceberg.amazon_statement_details (base table, partitioned)
--         + financial_accounting.settlement_flat_mapping (classification + service_name rules)
--         + neonpanel_iceberg.services / accounts (CoA mapping via income_account_id)
--         + sp_api_iceberg.amazon_statements (marketplace_name per settlement)
--         + neonpanel_iceberg.amazon_marketplaces (marketplace code/country lookup)
--         + neonpanel_iceberg.currency_rates (FX conversion)
--         + neonpanel_iceberg.app_companies (main currency)

WITH params AS (
  SELECT
    {{limit_top_n}}                                                        AS limit_top_n,
    {{start_date_sql}}                                                     AS start_date,
    {{end_date_sql}}                                                       AS end_date,
    transform({{company_ids_array}}, x -> CAST(x AS VARCHAR))             AS company_ids_str,
    {{settlement_ids_array}}                                               AS settlement_ids,
    {{marketplace_codes_array}}                                            AS marketplace_codes,
    {{account_classifications_array}}                                      AS account_classifications,
    {{account_types_array}}                                                AS account_types_filter,
    {{account_names_array}}                                                AS account_names,

    -- Group-by flags (1 = enabled, 0 = disabled)
    CAST({{group_by_account_classification}} AS INTEGER)                   AS group_by_account_classification,
    CAST({{group_by_account_type}} AS INTEGER)                             AS group_by_account_type,
    CAST({{group_by_account_name}} AS INTEGER)                             AS group_by_account_name,
    CAST({{group_by_service_name}} AS INTEGER)                             AS group_by_service_name,
    CAST({{group_by_marketplace}} AS INTEGER)                              AS group_by_marketplace,
    CAST({{group_by_settlement}} AS INTEGER)                               AS group_by_settlement
),

-- ── Marketplace resolution (from amazon_statements.marketplace_name) ─
-- ~10% of statements have NULL marketplace_name → fallback by currency.
-- EUR is ambiguous (multiple EU marketplaces) → mapped to 'Europe'.
statement_marketplace AS (
  SELECT
    s.settlement_id,
    s.company_id,
    COALESCE(m.currency_iso, m_cur.currency_iso)                           AS marketplace_currency,
    COALESCE(s.marketplace_name, m_cur.name,
             CASE WHEN s.currency = 'EUR' THEN 'Europe' END)              AS marketplace_name,
    COALESCE(m.code, m_cur.code)                                           AS marketplace_code,
    COALESCE(m.country, m_cur.country,
             CASE WHEN s.currency = 'EUR' THEN 'Europe' END)              AS marketplace_country
  FROM "{{catalog}}"."sp_api_iceberg"."amazon_statements" s
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."amazon_marketplaces" m
    ON m.name = s.marketplace_name
  LEFT JOIN (
    SELECT currency_iso,
           MIN(name) AS name, MIN(code) AS code, MIN(country) AS country
    FROM "{{catalog}}"."neonpanel_iceberg"."amazon_marketplaces"
    WHERE currency_iso IS NOT NULL AND currency_iso <> 'EUR'
    GROUP BY currency_iso
  ) m_cur
    ON s.marketplace_name IS NULL AND m_cur.currency_iso = s.currency
),

-- ── Service → Account mapping (with parent account chain) ────────────
-- Uses a.type / a.classification directly (not account_types table).
-- Normalizes type & classification labels (e.g., REVENUE → 1.Income).
service_account_map AS (
  SELECT
    s.name            AS service_name,
    s.company_id,
    CONCAT(
      COALESCE(a.number, ''), ' ',
      COALESCE(CONCAT(ap2.name, ': '), ''),
      COALESCE(CONCAT(ap1.name, ': '), ''),
      COALESCE(a.name, '')
    ) AS account_name,
    CASE a.type
      WHEN 'Income'             THEN '1.Income'
      WHEN 'REVENUE'            THEN '1.Income'
      WHEN 'Cost of Goods Sold' THEN '2.Cost of Goods Sold'
      WHEN 'DIRECTCOSTS'        THEN '2.Cost of Goods Sold'
      WHEN 'Expense'            THEN '3.Expense'
      WHEN 'EXPENSE'            THEN '3.Expense'
      WHEN 'Other Expense'      THEN '4.Other Expense'
      WHEN 'OVERHEADS'          THEN '4.Other Expense'
      ELSE a.type
    END AS account_type,
    a.type_detail     AS account_type_detail,
    a.description     AS account_description,
    CASE a.classification
      WHEN 'Revenue'   THEN '1.Revenue'
      WHEN 'Expense'   THEN '2.Expense'
      WHEN 'Asset'     THEN '3.Asset'
      WHEN 'Liability' THEN '4.Liability'
      ELSE a.classification
    END AS account_classification,
    COALESCE(apnl.name, 'N/A') AS pnl_class_name
  FROM "{{catalog}}"."neonpanel_iceberg"."services" s
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."accounts" a
    ON s.income_account_id = a.id
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."accounts" ap1
    ON a.parent_id = ap1.id
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."accounts" ap2
    ON ap1.parent_id = ap2.id
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."account_pnl_classes" apnl
    ON apnl.id = a.id
),

-- ── Normalize amount_type / amount_description before mapping ────────
normalized AS (
  SELECT
    d.*,
    CASE
      WHEN d.amount_type LIKE 'FBA Customer Returns Fee%for ASIN:%'
      THEN 'FBA Customer Returns Fee'
      ELSE d.amount_type
    END AS amount_type_norm,
    CASE
      WHEN d.transaction_type = 'CouponRedemptionFee' THEN '*'
      WHEN d.transaction_type LIKE 'Grade and Resell%' THEN '*'
      WHEN d.transaction_type = 'Debt Adjustment' THEN '*'
      WHEN d.amount_type LIKE 'Inbound Defect Fee%' THEN '*'
      WHEN d.amount_description LIKE 'Transfer of funds unsuccessful%' THEN 'Transfer of funds unsuccessful'
      ELSE TRIM(d.amount_description)
    END AS amount_description_norm
  FROM "{{catalog}}"."sp_api_iceberg"."amazon_statement_details" d
  CROSS JOIN params p
  WHERE
    -- Authorization
    contains(p.company_ids_str, d.company_id)
    -- Partition pruning on the BASE TABLE (critical for performance)
    AND d.settlement_year >= {{partition_year_start}}
    AND d.settlement_year <= {{partition_year_end}}
    AND (d.settlement_year > {{partition_year_start}} OR d.settlement_month >= {{partition_month_start}})
    AND (d.settlement_year < {{partition_year_end}}   OR d.settlement_month <= {{partition_month_end}})
    -- Date filter (LA timezone)
    AND (p.start_date IS NULL OR CAST(AT_TIMEZONE(d.transaction_date, 'America/Los_Angeles') AS DATE) >= p.start_date)
    AND (p.end_date   IS NULL OR CAST(AT_TIMEZONE(d.transaction_date, 'America/Los_Angeles') AS DATE) <= p.end_date)
    -- Settlement ID filter
    AND (cardinality(p.settlement_ids) = 0 OR contains(p.settlement_ids, d.settlement_id))
),

-- ── Map via settlement_flat_mapping → service_name ───────────────────
service_name_builder AS (
  SELECT
    n.settlement_id,
    n.company_id,
    n.amazon_seller_id,
    n.currency,
    n.transaction_type,
    n.amount_type,
    n.amount_description,
    n.transaction_date,
    n.amount,
    n.quantity,
    n.order_id,
    n.merchant_order_id,
    n.fulfillment_id,
    -- Transaction date in LA timezone
    CAST(AT_TIMEZONE(n.transaction_date, 'America/Los_Angeles') AS DATE)   AS transaction_date_tz,
    -- Derived service name
    CONCAT(
      CASE
        WHEN n.order_id IS NOT NULL
             AND n.merchant_order_id IS NOT NULL
             AND n.order_id != n.merchant_order_id
             AND NOT regexp_like(n.order_id, '^\d{3}-\d{7}-\d{7}$')
        THEN 'Non-Amazon'
        ELSE 'Amazon'
      END,
      ' ',
      COALESCE(m.service_name_suffix, n.amount_description || ' ' || n.transaction_type)
    ) AS service_name
  FROM normalized n
  LEFT JOIN "{{catalog}}"."financial_accounting"."settlement_flat_mapping" m
    ON n.transaction_type = m.transaction_type
   AND n.amount_type_norm = m.amount_type_normalized
   AND n.amount_description_norm = m.amount_description_normalized
),

-- ── Map service_name → CoA via service_account_map ───────────────────
coa_mapped AS (
  SELECT
    cv.settlement_id,
    cv.company_id,
    cv.currency,
    cv.transaction_type,
    cv.amount_type,
    cv.amount_description,
    cv.transaction_date_tz,
    cv.amount,
    cv.quantity,
    cv.service_name,

    -- CoA mapping status
    CASE
      WHEN sam.account_name IS NOT NULL THEN 'mapped'
      ELSE 'unmapped'
    END AS mapping_status,
    sam.account_name,
    sam.account_type,
    sam.account_type_detail,
    sam.account_description,
    sam.account_classification,
    sam.pnl_class_name,

    -- Marketplace from statement header
    sm.marketplace_code,
    sm.marketplace_name,
    sm.marketplace_country,
    sm.marketplace_currency,

    -- Debit / credit split
    CASE WHEN cv.amount >= 0 THEN cv.amount ELSE 0 END                    AS credit_amount,
    CASE WHEN cv.amount < 0  THEN ABS(cv.amount) ELSE 0 END               AS debit_amount,

    -- Currency conversion
    cv.amount * COALESCE(cr.rate, 0.00)                                    AS amount_usd,
    CASE WHEN crm.rate IS NOT NULL AND crm.rate != 0
         THEN cv.amount * COALESCE(cr.rate, 0.00) / crm.rate
         ELSE NULL
    END                                                                    AS amount_main,
    comp.currency                                                          AS main_currency

  FROM service_name_builder cv

  -- CoA mapping: service_name → accounts (with parent chain)
  LEFT JOIN service_account_map sam
    ON CAST(sam.company_id AS VARCHAR) = cv.company_id
    AND sam.service_name = cv.service_name

  -- Marketplace from statement header
  LEFT JOIN statement_marketplace sm
    ON sm.settlement_id = cv.settlement_id
    AND sm.company_id = cv.company_id

  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."app_companies" comp
    ON comp.id = CAST(cv.company_id AS BIGINT)

  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."currency_rates" cr
    ON cr.currency = COALESCE(sm.marketplace_currency, cv.currency)
    AND cr.date = cv.transaction_date_tz

  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."currency_rates" crm
    ON crm.currency = comp.currency
    AND crm.date = cv.transaction_date_tz
),

-- ── Filtered rows ────────────────────────────────────────────────────
filtered AS (
  SELECT cm.*
  FROM coa_mapped cm
  CROSS JOIN params p
  WHERE
    -- Marketplace code filter
    (
      cardinality(p.marketplace_codes) = 0
      OR any_match(p.marketplace_codes, mc -> lower(mc) = lower(cm.marketplace_code))
    )
    -- Account classification filter
    AND (
      cardinality(p.account_classifications) = 0
      OR any_match(p.account_classifications, ac -> lower(ac) = lower(cm.account_classification))
    )
    -- Account type filter
    AND (
      cardinality(p.account_types_filter) = 0
      OR any_match(p.account_types_filter, at -> lower(at) = lower(cm.account_type))
    )
    -- Account name filter (substring, case-insensitive)
    AND (
      cardinality(p.account_names) = 0
      OR any_match(p.account_names, an -> lower(cm.account_name) LIKE '%' || lower(an) || '%')
    )
),

-- ── Aggregate by CoA dimensions ──────────────────────────────────────
aggregated AS (
  SELECT
    -- Currency is ALWAYS grouped to prevent mixing different currencies
    f.currency,
    f.main_currency,

    -- CoA keys (conditional group-by)
    CASE WHEN p.group_by_account_classification = 1 THEN f.account_classification ELSE NULL END  AS account_classification,
    CASE WHEN p.group_by_account_type = 1 THEN f.account_type ELSE NULL END                      AS account_type,
    CASE WHEN p.group_by_account_name = 1 THEN f.account_name ELSE NULL END                      AS account_name,
    CASE WHEN p.group_by_account_name = 1 THEN f.mapping_status ELSE NULL END                    AS mapping_status,
    CASE WHEN p.group_by_service_name = 1 THEN f.service_name ELSE NULL END                      AS service_name,
    CASE WHEN p.group_by_marketplace = 1 THEN f.marketplace_code ELSE NULL END                   AS marketplace_code,
    CASE WHEN p.group_by_marketplace = 1 THEN f.marketplace_name ELSE NULL END                   AS marketplace_name,
    CASE WHEN p.group_by_settlement = 1 THEN f.settlement_id ELSE NULL END                       AS settlement_id,

    -- Metrics
    SUM(f.amount)          AS total_amount,
    SUM(f.debit_amount)    AS total_debit,
    SUM(f.credit_amount)   AS total_credit,
    COUNT(*)               AS line_count,
    SUM(f.quantity)        AS total_quantity,
    SUM(f.amount_usd)      AS total_amount_usd,
    SUM(f.amount_main)     AS total_amount_main

  FROM filtered f
  CROSS JOIN params p
  GROUP BY
    f.currency,
    f.main_currency,
    CASE WHEN p.group_by_account_classification = 1 THEN f.account_classification ELSE NULL END,
    CASE WHEN p.group_by_account_type = 1 THEN f.account_type ELSE NULL END,
    CASE WHEN p.group_by_account_name = 1 THEN f.account_name ELSE NULL END,
    CASE WHEN p.group_by_account_name = 1 THEN f.mapping_status ELSE NULL END,
    CASE WHEN p.group_by_service_name = 1 THEN f.service_name ELSE NULL END,
    CASE WHEN p.group_by_marketplace = 1 THEN f.marketplace_code ELSE NULL END,
    CASE WHEN p.group_by_marketplace = 1 THEN f.marketplace_name ELSE NULL END,
    CASE WHEN p.group_by_settlement = 1 THEN f.settlement_id ELSE NULL END
)

-- ── Final output ─────────────────────────────────────────────────────
SELECT
  ROW_NUMBER() OVER (ORDER BY {{sort_column}} {{sort_direction}} NULLS LAST) AS rank,
  a.currency,
  a.account_classification,
  a.account_type,
  a.account_name,
  a.mapping_status,
  a.service_name,
  a.marketplace_code,
  a.marketplace_name,
  a.settlement_id,
  ROUND(a.total_amount, 2)       AS total_amount,
  ROUND(a.total_debit, 2)        AS total_debit,
  ROUND(a.total_credit, 2)       AS total_credit,
  a.line_count,
  a.total_quantity,
  ROUND(a.total_amount_usd, 2)   AS total_amount_usd,
  ROUND(a.total_amount_main, 2)  AS total_amount_main,
  a.main_currency
FROM aggregated a
ORDER BY {{sort_column}} {{sort_direction}} NULLS LAST
LIMIT {{limit_top_n}}
