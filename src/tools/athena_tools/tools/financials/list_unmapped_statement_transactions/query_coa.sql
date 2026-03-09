-- Tool: financials_list_unmapped_statement_transactions (coa mode)
-- Purpose: List service_name values that have no CoA mapping (no matching service → account chain).
-- Aggregates unmapped rows by service_name so the user can see which services
-- need to be linked to an account in the Chart of Accounts.

WITH params AS (
  SELECT
    {{limit_top_n}}                                                        AS limit_top_n,
    {{start_date_sql}}                                                     AS start_date,
    {{end_date_sql}}                                                       AS end_date,
    transform({{company_ids_array}}, x -> CAST(x AS VARCHAR))             AS company_ids_str,
    {{settlement_ids_array}}                                               AS settlement_ids,
    {{marketplace_codes_array}}                                            AS marketplace_codes
),

-- ── Marketplace resolution (from amazon_statements.marketplace_name) ─
statement_marketplace AS (
  SELECT
    s.settlement_id,
    s.company_id,
    COALESCE(m.code, m_cur.code)                                           AS marketplace_code
  FROM "{{catalog}}"."sp_api_iceberg"."amazon_statements" s
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."amazon_marketplaces" m
    ON m.name = s.marketplace_name
  LEFT JOIN (
    SELECT currency_iso,
           MIN(code) AS code
    FROM "{{catalog}}"."neonpanel_iceberg"."amazon_marketplaces"
    WHERE currency_iso IS NOT NULL AND currency_iso <> 'EUR'
    GROUP BY currency_iso
  ) m_cur
    ON s.marketplace_name IS NULL AND m_cur.currency_iso = s.currency
),

-- ── Normalize amount_type / amount_description before mapping ────────
normalized AS (
  SELECT
    d.settlement_id,
    d.company_id,
    d.currency,
    d.transaction_type,
    d.amount_type,
    d.amount_description,
    d.amount,
    d.quantity,
    d.order_id,
    d.merchant_order_id,
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
    contains(p.company_ids_str, d.company_id)
    AND d.settlement_year >= {{partition_year_start}}
    AND d.settlement_year <= {{partition_year_end}}
    AND (d.settlement_year > {{partition_year_start}} OR d.settlement_month >= {{partition_month_start}})
    AND (d.settlement_year < {{partition_year_end}}   OR d.settlement_month <= {{partition_month_end}})
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
    AND (cardinality(p.settlement_ids) = 0 OR contains(p.settlement_ids, d.settlement_id))
),

-- ── Build service_name (same logic as classify tool) ─────────────────
service_name_builder AS (
  SELECT
    n.settlement_id,
    n.company_id,
    n.currency,
    n.amount,
    n.quantity,
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

-- ── LEFT JOIN to services → accounts → keep only unmapped ────────────
unmapped AS (
  SELECT
    sv.currency,
    sv.service_name,
    sv.amount,
    sv.quantity,
    sv.settlement_id,
    sv.company_id
  FROM service_name_builder sv
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."services" s
    ON s.name = sv.service_name
   AND CAST(s.company_id AS VARCHAR) = sv.company_id
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."accounts" a
    ON s.income_account_id = a.id
  WHERE s.name IS NULL OR a.id IS NULL
),

-- ── Filter by marketplace if requested ───────────────────────────────
filtered AS (
  SELECT u.*
  FROM unmapped u
  CROSS JOIN params p
  LEFT JOIN statement_marketplace sm
    ON sm.settlement_id = u.settlement_id
   AND sm.company_id = u.company_id
  WHERE
    cardinality(p.marketplace_codes) = 0
    OR any_match(p.marketplace_codes, mc -> lower(mc) = lower(sm.marketplace_code))
),

-- ── Aggregate by service_name ────────────────────────────────────────
aggregated AS (
  SELECT
    f.currency,
    f.service_name,
    SUM(f.amount)       AS total_amount,
    COUNT(*)            AS line_count,
    SUM(f.quantity)     AS total_quantity
  FROM filtered f
  GROUP BY
    f.currency,
    f.service_name
)

SELECT
  ROW_NUMBER() OVER (ORDER BY {{sort_column}} {{sort_direction}} NULLS LAST) AS rank,
  a.currency,
  a.service_name,
  ROUND(a.total_amount, 2) AS total_amount,
  a.line_count,
  a.total_quantity
FROM aggregated a
ORDER BY {{sort_column}} {{sort_direction}} NULLS LAST
LIMIT {{limit_top_n}}
