-- Tool: financials_list_unmapped_statement_transactions (reference mode)
-- Purpose: List transaction-type combos that have no settlement_flat_mapping rule.
-- Aggregates unmapped rows by transaction_type, amount_type, amount_description
-- so the user can see which mapping rules need to be added.

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

-- ── LEFT JOIN to settlement_flat_mapping → keep only unmapped ────────
unmapped AS (
  SELECT
    n.currency,
    n.transaction_type,
    n.amount_type,
    n.amount_description,
    n.amount_type_norm,
    n.amount_description_norm,
    n.amount,
    n.quantity,
    n.settlement_id,
    n.company_id
  FROM normalized n
  LEFT JOIN "{{catalog}}"."financial_accounting"."settlement_flat_mapping" m
    ON n.transaction_type = m.transaction_type
   AND n.amount_type_norm = m.amount_type_normalized
   AND n.amount_description_norm = m.amount_description_normalized
  WHERE m.transaction_type IS NULL
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

-- ── Aggregate by transaction_type + amount_type + amount_description ─
aggregated AS (
  SELECT
    f.currency,
    f.transaction_type,
    f.amount_type,
    f.amount_description,
    f.amount_type_norm,
    f.amount_description_norm,
    SUM(f.amount)       AS total_amount,
    COUNT(*)            AS line_count,
    SUM(f.quantity)     AS total_quantity
  FROM filtered f
  GROUP BY
    f.currency,
    f.transaction_type,
    f.amount_type,
    f.amount_description,
    f.amount_type_norm,
    f.amount_description_norm
)

SELECT
  ROW_NUMBER() OVER (ORDER BY {{sort_column}} {{sort_direction}} NULLS LAST) AS rank,
  a.currency,
  a.transaction_type,
  a.amount_type,
  a.amount_description,
  a.amount_type_norm,
  a.amount_description_norm,
  ROUND(a.total_amount, 2) AS total_amount,
  a.line_count,
  a.total_quantity
FROM aggregated a
ORDER BY {{sort_column}} {{sort_direction}} NULLS LAST
LIMIT {{limit_top_n}}
