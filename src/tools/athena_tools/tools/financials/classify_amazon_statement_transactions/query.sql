-- Tool: financials_classify_amazon_statement_transactions (reference / standard-class mode)
-- Purpose: Aggregate classified settlement transactions by class/subclass for reconciliation.
-- Source: sp_api_iceberg.amazon_statement_details (base table, partitioned)
--         + financial_accounting.settlement_flat_mapping (classification + service_name rules)
--         + financial_accounting.settlement_subclasses / settlement_classes (lookups)
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
    {{class_codes_array}}                                                  AS class_codes,
    {{subclass_codes_array}}                                               AS subclass_codes,

    -- Group-by flags (1 = enabled, 0 = disabled)
    CAST({{group_by_class}} AS INTEGER)                                    AS group_by_class,
    CAST({{group_by_subclass}} AS INTEGER)                                 AS group_by_subclass,
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
    -- Date filter (parsed posted_date_time_raw → LA timezone)
    AND (p.start_date IS NULL OR CAST(
      COALESCE(
        TRY(DATE_PARSE(SUBSTR(d.posted_date_time_raw, 1, 19), '%d.%m.%Y %H:%i:%s')),
        TRY(DATE_PARSE(REGEXP_REPLACE(d.posted_date_time_raw, ' UTC$', ''), '%Y-%m-%d %H:%i:%s')),
        TRY(DATE_PARSE(SUBSTR(d.posted_date_time_raw, 1, 19), '%Y/%m/%d %H:%i:%s')),
        TRY(DATE_PARSE(REGEXP_REPLACE(REGEXP_REPLACE(SUBSTR(d.posted_date_time_raw, 1, 19), 'T', ' '), '(Z|[+-][0-9]{2}:[0-9]{2})$', ''), '%Y-%m-%d %H:%i:%s')),
        TIMESTAMP '2010-01-01 00:00:00'
      ) AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles'
    AS DATE) >= p.start_date)
    AND (p.end_date   IS NULL OR CAST(
      COALESCE(
        TRY(DATE_PARSE(SUBSTR(d.posted_date_time_raw, 1, 19), '%d.%m.%Y %H:%i:%s')),
        TRY(DATE_PARSE(REGEXP_REPLACE(d.posted_date_time_raw, ' UTC$', ''), '%Y-%m-%d %H:%i:%s')),
        TRY(DATE_PARSE(SUBSTR(d.posted_date_time_raw, 1, 19), '%Y/%m/%d %H:%i:%s')),
        TRY(DATE_PARSE(REGEXP_REPLACE(REGEXP_REPLACE(SUBSTR(d.posted_date_time_raw, 1, 19), 'T', ' '), '(Z|[+-][0-9]{2}:[0-9]{2})$', ''), '%Y-%m-%d %H:%i:%s')),
        TIMESTAMP '2010-01-01 00:00:00'
      ) AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles'
    AS DATE) <= p.end_date)
    -- Settlement ID filter
    AND (cardinality(p.settlement_ids) = 0 OR contains(p.settlement_ids, d.settlement_id))
),

-- ── Map via settlement_flat_mapping → subclass + service_name ────────
service_name_builder AS (
  SELECT
    n.settlement_id,
    n.company_id,
    n.amazon_seller_id,
    n.currency,
    n.transaction_type,
    n.amount_type,
    n.amount_description,
    n.amount,
    n.quantity,
    n.order_id,
    n.merchant_order_id,
    n.fulfillment_id,
    -- Transaction date in LA timezone (parsed from posted_date_time_raw)
    CAST(
      COALESCE(
        TRY(DATE_PARSE(SUBSTR(n.posted_date_time_raw, 1, 19), '%d.%m.%Y %H:%i:%s')),
        TRY(DATE_PARSE(REGEXP_REPLACE(n.posted_date_time_raw, ' UTC$', ''), '%Y-%m-%d %H:%i:%s')),
        TRY(DATE_PARSE(SUBSTR(n.posted_date_time_raw, 1, 19), '%Y/%m/%d %H:%i:%s')),
        TRY(DATE_PARSE(REGEXP_REPLACE(REGEXP_REPLACE(SUBSTR(n.posted_date_time_raw, 1, 19), 'T', ' '), '(Z|[+-][0-9]{2}:[0-9]{2})$', ''), '%Y-%m-%d %H:%i:%s')),
        TIMESTAMP '2010-01-01 00:00:00'
      ) AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles'
    AS DATE) AS transaction_date_tz,
    -- Raw subclass from flat mapping
    m.subclass_code                                                        AS raw_subclass_code,
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

-- ── Apply subclass override rules ────────────────────────────────────
classified AS (
  SELECT
    sb.*,
    CASE
      WHEN sb.raw_subclass_code = '1.03' AND sb.fulfillment_id = 'MFN'
      THEN '1.01'
      WHEN sb.raw_subclass_code = '1.04' AND sb.fulfillment_id = 'MFN'
           AND sb.transaction_type = 'Refund'
           AND sb.amount_type = 'ItemPrice'
           AND sb.amount_description = 'Principal'
      THEN '1.02'
      WHEN sb.raw_subclass_code = '1.05'
           AND sb.amount_type = 'FBA Inventory Reimbursement'
           AND sb.amount < 0
      THEN '2.14'
      ELSE COALESCE(sb.raw_subclass_code, '9.99')
    END AS subclass_code
  FROM service_name_builder sb
),

-- ── Filtered classified rows ─────────────────────────────────────────
filtered AS (
  SELECT
    cv.settlement_id,
    cv.company_id,
    cv.currency,
    cv.transaction_date_tz,
    cv.amount,
    cv.quantity,
    cv.subclass_code,
    sc.subclass_name,
    sc.class_code,
    cl.class_name,
    cv.service_name,

    -- Marketplace from statement header
    sm.marketplace_code,
    sm.marketplace_name,
    sm.marketplace_country,

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

  FROM classified cv

  LEFT JOIN "{{catalog}}"."financial_accounting"."settlement_subclasses" sc
    ON sc.subclass_code = cv.subclass_code
  LEFT JOIN "{{catalog}}"."financial_accounting"."settlement_classes" cl
    ON sc.class_code = cl.class_code

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

  CROSS JOIN params p

  WHERE
    -- Marketplace code filter
    (
      cardinality(p.marketplace_codes) = 0
      OR any_match(p.marketplace_codes, mc -> lower(mc) = lower(sm.marketplace_code))
    )
    -- Class code filter
    AND (
      cardinality(p.class_codes) = 0
      OR contains(p.class_codes, sc.class_code)
    )
    -- Subclass code filter
    AND (
      cardinality(p.subclass_codes) = 0
      OR contains(p.subclass_codes, cv.subclass_code)
    )
),

-- ── Aggregate by classification dimensions ───────────────────────────
aggregated AS (
  SELECT
    -- Currency is ALWAYS grouped to prevent mixing different currencies
    f.currency,
    f.main_currency,

    -- Classification keys (conditional group-by)
    CASE WHEN p.group_by_class = 1 THEN f.class_code ELSE NULL END             AS class_code,
    CASE WHEN p.group_by_class = 1 THEN f.class_name ELSE NULL END             AS class_name,
    CASE WHEN p.group_by_subclass = 1 THEN f.subclass_code ELSE NULL END       AS subclass_code,
    CASE WHEN p.group_by_subclass = 1 THEN f.subclass_name ELSE NULL END       AS subclass_name,
    CASE WHEN p.group_by_service_name = 1 THEN f.service_name ELSE NULL END    AS service_name,
    CASE WHEN p.group_by_marketplace = 1 THEN f.marketplace_code ELSE NULL END AS marketplace_code,
    CASE WHEN p.group_by_marketplace = 1 THEN f.marketplace_name ELSE NULL END AS marketplace_name,
    CASE WHEN p.group_by_settlement = 1 THEN f.settlement_id ELSE NULL END     AS settlement_id,

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
    CASE WHEN p.group_by_class = 1 THEN f.class_code ELSE NULL END,
    CASE WHEN p.group_by_class = 1 THEN f.class_name ELSE NULL END,
    CASE WHEN p.group_by_subclass = 1 THEN f.subclass_code ELSE NULL END,
    CASE WHEN p.group_by_subclass = 1 THEN f.subclass_name ELSE NULL END,
    CASE WHEN p.group_by_service_name = 1 THEN f.service_name ELSE NULL END,
    CASE WHEN p.group_by_marketplace = 1 THEN f.marketplace_code ELSE NULL END,
    CASE WHEN p.group_by_marketplace = 1 THEN f.marketplace_name ELSE NULL END,
    CASE WHEN p.group_by_settlement = 1 THEN f.settlement_id ELSE NULL END
)

-- ── Final output ─────────────────────────────────────────────────────
SELECT
  ROW_NUMBER() OVER (ORDER BY {{sort_column}} {{sort_direction}} NULLS LAST) AS rank,
  a.currency,
  a.class_code,
  a.class_name,
  a.subclass_code,
  a.subclass_name,
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
