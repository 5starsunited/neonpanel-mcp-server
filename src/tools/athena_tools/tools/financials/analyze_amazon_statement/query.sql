-- Tool: financials_analyze_amazon_statement (analyze mode)
-- Purpose: Filter and aggregate Amazon settlement transaction detail rows.
-- Source tables:
--   sp_api_iceberg.amazon_statement_details  (transaction-level detail lines)
--   sp_api_iceberg.amazon_statements          (settlement-level header: dates, deposit, totals)
--   neonpanel_iceberg.amazon_marketplaces     (marketplace code, country, currency_iso)
-- Join chain:
--   amazon_statement_details D
--     → amazon_statements      S   ON S.settlement_id = D.settlement_id AND S.company_id = D.company_id
--     → app_companies          C   ON CAST(C.id AS VARCHAR) = D.company_id  (company name/shortname, main currency)
--     → amazon_marketplaces    M   ON M.name = S.marketplace_name
--     → marketplace_by_currency      ON currency_iso = S.currency  (fallback when marketplace_name IS NULL)
--     → currency_rate          CR  ON CR.currency = COALESCE(D.currency, M.currency_iso, m_cur.currency_iso)
--                                     AND CR.date = CAST(D.transaction_date AS DATE)  (FX conversion)
-- Notes:
--   • Detail rows have: transaction_type, order_id, amount_type, amount_description, amount.
--   • ~10% of statements have NULL marketplace_name. Fallback resolves by currency.
--   • EUR maps to 'Europe' (multiple EU marketplaces share EUR).
--   • currency_rate converts local amount → company's main currency.
--   • amount_main = amount * COALESCE(cr.rate, 1.0).
--   • M.currency_iso is used as fallback when D.currency is NULL.

WITH params AS (
  SELECT
    {{limit_top_n}}                                                        AS limit_top_n,
    {{start_date_sql}}                                                     AS start_date,
    {{end_date_sql}}                                                       AS end_date,
    {{company_ids_array}}                                                  AS company_ids,
    transform({{company_ids_array}}, x -> CAST(x AS VARCHAR))             AS company_ids_str,

    -- Filters
    {{settlement_ids_array}}                                               AS settlement_ids,
    {{marketplace_codes_array}}                                            AS marketplace_codes,
    {{transaction_types_array}}                                            AS transaction_types,
    {{amount_types_array}}                                                 AS amount_types,
    {{amount_descriptions_array}}                                          AS amount_descriptions,
    {{order_ids_array}}                                                    AS order_ids,
    {{skus_array}}                                                         AS skus,
    {{fulfillment_ids_array}}                                              AS fulfillment_ids,
    {{min_amount_sql}}                                                     AS min_amount,
    {{max_amount_sql}}                                                     AS max_amount,

    -- Aggregation
    {{periodicity_sql}}                                                    AS periodicity,

    -- Group-by flags (1 = enabled, 0 = disabled)
    CAST({{group_by_company}} AS INTEGER)                                  AS group_by_company,
    CAST({{group_by_marketplace}} AS INTEGER)                              AS group_by_marketplace,
    CAST({{group_by_settlement}} AS INTEGER)                               AS group_by_settlement,
    CAST({{group_by_amount_type}} AS INTEGER)                              AS group_by_amount_type,
    CAST({{group_by_amount_description}} AS INTEGER)                       AS group_by_amount_description,
    CAST({{group_by_transaction_type}} AS INTEGER)                         AS group_by_transaction_type,
    CAST({{group_by_sku}} AS INTEGER)                                      AS group_by_sku,
    CAST({{group_by_order}} AS INTEGER)                                    AS group_by_order,
    CAST({{group_by_fulfillment}} AS INTEGER)                              AS group_by_fulfillment
),

-- ─── Currency rates (USD is base; no row for USD → COALESCE to 1.0) ─────────
currency_rates AS (
  SELECT currency, date, rate
  FROM "{{catalog}}"."neonpanel_iceberg"."currency_rates"
),

-- ─── Enriched detail rows ───────────────────────────────────────────────────
enriched AS (
  SELECT
    d.settlement_id,
    s.settlement_start_date,
    s.settlement_end_date,
    s.deposit_date,
    COALESCE(d.currency, m.currency_iso, m_cur.currency_iso)                AS statement_currency,
    d.transaction_type,
    d.order_id,
    d.merchant_order_id,
    d.adjustment_id,
    d.shipment_id,
    d.amount_type,
    d.amount_description,
    d.amount,
    d.fulfillment_id,
    d.transaction_date,
    d.posted_date_time_raw,
    d.merchant_order_item_code,
    d.sku,
    d.quantity,
    d.promotion_id,
    d.amazon_seller_id                                                     AS seller_id,

    -- Company
    CAST(d.company_id AS BIGINT)                                           AS company_id,
    c.name                                                                 AS company_name,
    c.shortname                                                            AS company_short_name,
    c.currency                                                             AS main_currency,

    -- Marketplace (directly from amazon_statements.marketplace_name + amazon_marketplaces for code/country/currency)
    -- Fallback: currency-based lookup when marketplace_name IS NULL; EUR → 'Europe'
    COALESCE(
      s.marketplace_name,
      m_cur.name,
      CASE WHEN s.currency = 'EUR' THEN 'Europe' ELSE NULL END
    )                                                                      AS marketplace_name,
    COALESCE(m.code, m_cur.code)                                           AS marketplace_code,
    COALESCE(
      m.country,
      m_cur.country,
      CASE WHEN s.currency = 'EUR' THEN 'Europe' ELSE NULL END
    )                                                                      AS marketplace_country,
    COALESCE(m.currency_iso, m_cur.currency_iso, s.currency)               AS marketplace_currency,

    -- FX conversion: amount in company's main currency
    -- Use d.currency with m.currency_iso as fallback
    d.amount * COALESCE(cr.rate, 1.0)                                      AS amount_main

  FROM "{{catalog}}"."sp_api_iceberg"."amazon_statement_details" d

  INNER JOIN "{{catalog}}"."sp_api_iceberg"."amazon_statements" s
    ON s.settlement_id = d.settlement_id
    AND s.company_id = d.company_id

  INNER JOIN "{{catalog}}"."neonpanel_iceberg"."app_companies" c
    ON CAST(c.id AS VARCHAR) = d.company_id

  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."amazon_marketplaces" m
    ON m.name = s.marketplace_name

  -- Fallback: resolve marketplace by currency when marketplace_name is NULL
  -- EUR excluded (multiple EU marketplaces share EUR → handled inline as 'Europe')
  LEFT JOIN (
    SELECT currency_iso,
           MIN(name) AS name,
           MIN(code) AS code,
           MIN(country) AS country
    FROM "{{catalog}}"."neonpanel_iceberg"."amazon_marketplaces"
    WHERE currency_iso IS NOT NULL AND currency_iso <> 'EUR'
    GROUP BY currency_iso
  ) m_cur
    ON s.marketplace_name IS NULL
    AND m_cur.currency_iso = s.currency

  LEFT JOIN currency_rates cr
    ON lower(cr.currency) = lower(COALESCE(d.currency, m.currency_iso, m_cur.currency_iso))
    AND cr.date = CAST(d.transaction_date AS DATE)

  CROSS JOIN params p

  WHERE
    -- Detail rows only (skip title/summary rows)
    d.transaction_type IS NOT NULL
    AND TRIM(d.transaction_type) <> ''

    -- Authorization
    AND contains(p.company_ids_str, d.company_id)

    -- Partition pruning (settlement_year + settlement_month)
    AND d.settlement_year >= {{partition_year_start}}
    AND d.settlement_year <= {{partition_year_end}}
    AND (d.settlement_year > {{partition_year_start}} OR d.settlement_month >= {{partition_month_start}})
    AND (d.settlement_year < {{partition_year_end}}   OR d.settlement_month <= {{partition_month_end}})

    -- Date filter on transaction_date (precise, after partition pruning)
    AND (p.start_date IS NULL OR CAST(d.transaction_date AS DATE) >= p.start_date)
    AND (p.end_date   IS NULL OR CAST(d.transaction_date AS DATE) <= p.end_date)

    -- Settlement ID filter
    AND (
      cardinality(p.settlement_ids) = 0
      OR contains(p.settlement_ids, d.settlement_id)
    )

    -- Marketplace code filter
    AND (
      cardinality(p.marketplace_codes) = 0
      OR any_match(p.marketplace_codes, mc -> lower(mc) = lower(COALESCE(m.code, m_cur.code)))
    )

    -- Transaction type filter
    AND (
      cardinality(p.transaction_types) = 0
      OR any_match(p.transaction_types, tt -> lower(tt) = lower(d.transaction_type))
    )

    -- Amount type filter
    AND (
      cardinality(p.amount_types) = 0
      OR any_match(p.amount_types, at -> lower(at) = lower(d.amount_type))
    )

    -- Amount description filter
    AND (
      cardinality(p.amount_descriptions) = 0
      OR any_match(p.amount_descriptions, ad -> lower(d.amount_description) LIKE '%' || lower(ad) || '%')
    )

    -- Order ID filter
    AND (
      cardinality(p.order_ids) = 0
      OR any_match(p.order_ids, oid -> oid = d.order_id)
    )

    -- SKU filter
    AND (
      cardinality(p.skus) = 0
      OR any_match(p.skus, sk -> lower(sk) = lower(d.sku))
    )

    -- Fulfillment ID filter
    AND (
      cardinality(p.fulfillment_ids) = 0
      OR any_match(p.fulfillment_ids, fi -> lower(fi) = lower(d.fulfillment_id))
    )

    -- Amount range filter
    AND (p.min_amount IS NULL OR d.amount >= p.min_amount)
    AND (p.max_amount IS NULL OR d.amount <= p.max_amount)
),

-- ─── Aggregate by dynamic group-by ──────────────────────────────────────────
aggregated AS (
  SELECT
    -- Periodicity key
    CASE p.periodicity
      WHEN 'day'     THEN CAST(CAST(e.transaction_date AS DATE) AS VARCHAR)
      WHEN 'week'    THEN DATE_FORMAT(CAST(e.transaction_date AS DATE), '%x-W%v')
      WHEN 'month'   THEN DATE_FORMAT(CAST(e.transaction_date AS DATE), '%Y-%m')
      WHEN 'quarter' THEN CAST(YEAR(CAST(e.transaction_date AS DATE)) AS VARCHAR) || '-Q' || CAST(QUARTER(CAST(e.transaction_date AS DATE)) AS VARCHAR)
      WHEN 'year'    THEN CAST(YEAR(CAST(e.transaction_date AS DATE)) AS VARCHAR)
      ELSE NULL
    END                                                                    AS time_period,

    -- Conditional group-by keys
    CASE WHEN p.group_by_company = 1 THEN e.company_id ELSE NULL END       AS company_id,
    CASE WHEN p.group_by_company = 1 THEN e.company_name ELSE NULL END     AS company_name,
    CASE WHEN p.group_by_company = 1 THEN e.company_short_name ELSE NULL END AS company_short_name,
    CASE WHEN p.group_by_company = 1 THEN e.main_currency ELSE NULL END    AS main_currency,
    CASE WHEN p.group_by_marketplace = 1 THEN e.marketplace_name ELSE NULL END AS marketplace_name,
    CASE WHEN p.group_by_marketplace = 1 THEN e.marketplace_code ELSE NULL END AS marketplace_code,
    CASE WHEN p.group_by_marketplace = 1 THEN e.marketplace_country ELSE NULL END AS marketplace_country,
    CASE WHEN p.group_by_marketplace = 1 THEN e.marketplace_currency ELSE NULL END AS marketplace_currency,
    CASE WHEN p.group_by_settlement = 1 THEN e.settlement_id ELSE NULL END AS settlement_id,
    CASE WHEN p.group_by_settlement = 1 THEN CAST(e.deposit_date AS VARCHAR) ELSE NULL END AS deposit_date,
    CASE WHEN p.group_by_settlement = 1 THEN e.statement_currency ELSE NULL END AS statement_currency,
    CASE WHEN p.group_by_amount_type = 1 THEN e.amount_type ELSE NULL END  AS amount_type,
    CASE WHEN p.group_by_amount_description = 1 THEN e.amount_description ELSE NULL END AS amount_description,
    CASE WHEN p.group_by_transaction_type = 1 THEN e.transaction_type ELSE NULL END AS transaction_type,
    CASE WHEN p.group_by_sku = 1 THEN e.sku ELSE NULL END                  AS sku,
    CASE WHEN p.group_by_order = 1 THEN e.order_id ELSE NULL END           AS order_id,
    CASE WHEN p.group_by_fulfillment = 1 THEN e.fulfillment_id ELSE NULL END AS fulfillment_id,

    -- Metrics
    SUM(e.amount)                              AS total_amount,
    SUM(e.amount_main)                         AS total_amount_main,
    COUNT(*)                                   AS line_count,
    COUNT(DISTINCT e.order_id)                 AS order_count,
    COUNT(DISTINCT e.settlement_id)            AS settlement_count,
    SUM(e.quantity)                             AS total_quantity

  FROM enriched e
  CROSS JOIN params p
  GROUP BY
    CASE p.periodicity
      WHEN 'day'     THEN CAST(CAST(e.transaction_date AS DATE) AS VARCHAR)
      WHEN 'week'    THEN DATE_FORMAT(CAST(e.transaction_date AS DATE), '%x-W%v')
      WHEN 'month'   THEN DATE_FORMAT(CAST(e.transaction_date AS DATE), '%Y-%m')
      WHEN 'quarter' THEN CAST(YEAR(CAST(e.transaction_date AS DATE)) AS VARCHAR) || '-Q' || CAST(QUARTER(CAST(e.transaction_date AS DATE)) AS VARCHAR)
      WHEN 'year'    THEN CAST(YEAR(CAST(e.transaction_date AS DATE)) AS VARCHAR)
      ELSE NULL
    END,
    CASE WHEN p.group_by_company = 1 THEN e.company_id ELSE NULL END,
    CASE WHEN p.group_by_company = 1 THEN e.company_name ELSE NULL END,
    CASE WHEN p.group_by_company = 1 THEN e.company_short_name ELSE NULL END,
    CASE WHEN p.group_by_company = 1 THEN e.main_currency ELSE NULL END,
    CASE WHEN p.group_by_marketplace = 1 THEN e.marketplace_name ELSE NULL END,
    CASE WHEN p.group_by_marketplace = 1 THEN e.marketplace_code ELSE NULL END,
    CASE WHEN p.group_by_marketplace = 1 THEN e.marketplace_country ELSE NULL END,
    CASE WHEN p.group_by_marketplace = 1 THEN e.marketplace_currency ELSE NULL END,
    CASE WHEN p.group_by_settlement = 1 THEN e.settlement_id ELSE NULL END,
    CASE WHEN p.group_by_settlement = 1 THEN CAST(e.deposit_date AS VARCHAR) ELSE NULL END,
    CASE WHEN p.group_by_settlement = 1 THEN e.statement_currency ELSE NULL END,
    CASE WHEN p.group_by_amount_type = 1 THEN e.amount_type ELSE NULL END,
    CASE WHEN p.group_by_amount_description = 1 THEN e.amount_description ELSE NULL END,
    CASE WHEN p.group_by_transaction_type = 1 THEN e.transaction_type ELSE NULL END,
    CASE WHEN p.group_by_sku = 1 THEN e.sku ELSE NULL END,
    CASE WHEN p.group_by_order = 1 THEN e.order_id ELSE NULL END,
    CASE WHEN p.group_by_fulfillment = 1 THEN e.fulfillment_id ELSE NULL END
)

-- ─── Final ranked output ────────────────────────────────────────────────────
SELECT
  ROW_NUMBER() OVER (ORDER BY {{sort_column}} {{sort_direction}} NULLS LAST) AS rank,
  a.time_period,
  a.company_id,
  a.company_name,
  a.company_short_name,
  a.main_currency,
  a.marketplace_name,
  a.marketplace_code,
  a.marketplace_country,
  a.marketplace_currency,
  a.settlement_id,
  a.deposit_date,
  a.statement_currency,
  a.amount_type,
  a.amount_description,
  a.transaction_type,
  a.sku,
  a.order_id,
  a.fulfillment_id,
  ROUND(a.total_amount, 2)        AS total_amount,
  ROUND(a.total_amount_main, 2)   AS total_amount_main,
  a.line_count,
  a.order_count,
  a.settlement_count,
  a.total_quantity
FROM aggregated a
ORDER BY {{sort_column}} {{sort_direction}} NULLS LAST
LIMIT {{limit_top_n}}
