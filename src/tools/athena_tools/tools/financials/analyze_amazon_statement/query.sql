-- Tool: financials_analyze_amazon_statement (analyze mode)
-- Purpose: Filter and aggregate Amazon settlement transaction detail rows.
-- Source table:
--   sp_api_iceberg.v2_settlement_report_data_flat_file_v2
-- Join chain:
--   settlement S
--     → app_companies  C   ON CAST(C.id AS VARCHAR) = S.ingest_company_id  (company name, main currency)
--     → currency_rate  CR  ON CR.currency = S.currency AND CR.date = posted_date  (FX conversion)
-- Notes:
--   • Detail rows have: transaction_type, order_id, amount_type, amount_description, amount.
--   • currency_rate converts local amount → company's main currency.
--   • amount_main = amount * COALESCE(cr.rate, 1.0).

WITH params AS (
  SELECT
    {{limit_top_n}}                                                        AS limit_top_n,
    {{start_date_sql}}                                                     AS start_date,
    {{end_date_sql}}                                                       AS end_date,
    {{company_ids_array}}                                                  AS company_ids,
    transform({{company_ids_array}}, x -> CAST(x AS VARCHAR))             AS company_ids_str,

    -- Filters
    {{settlement_ids_array}}                                               AS settlement_ids,
    {{marketplace_names_array}}                                            AS marketplace_names,
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
  FROM "{{catalog}}"."neonpanel_iceberg"."currency_rate"
),

-- ─── Enriched detail rows ───────────────────────────────────────────────────
enriched AS (
  SELECT
    s.settlement_id,
    s.settlement_start_date,
    s.settlement_end_date,
    s.deposit_date,
    s.currency                                                             AS statement_currency,
    s.transaction_type,
    s.order_id,
    s.merchant_order_id,
    s.adjustment_id,
    s.shipment_id,
    s.marketplace_name,
    s.amount_type,
    s.amount_description,
    s.amount,
    s.fulfillment_id,
    s.posted_date,
    s.posted_date_time,
    s.order_item_code,
    s.sku,
    s.quantity_purchased,
    s.promotion_id,
    s.ingest_seller_id                                                     AS seller_id,

    -- Company
    CAST(s.ingest_company_id AS BIGINT)                                    AS company_id,
    c.name                                                                 AS company_name,
    c.currency                                                             AS main_currency,

    -- FX conversion: amount in company's main currency
    s.amount * COALESCE(cr.rate, 1.0)                                      AS amount_main

  FROM "{{catalog}}"."sp_api_iceberg"."v2_settlement_report_data_flat_file_v2" s

  INNER JOIN "{{catalog}}"."neonpanel_iceberg"."app_companies" c
    ON CAST(c.id AS VARCHAR) = s.ingest_company_id

  LEFT JOIN currency_rates cr
    ON lower(cr.currency) = lower(s.currency)
    AND cr.date = TRY_CAST(s.posted_date AS DATE)

  CROSS JOIN params p

  WHERE
    -- Detail rows only (skip title/summary rows)
    s.transaction_type IS NOT NULL
    AND TRIM(s.transaction_type) <> ''

    -- Authorization
    AND contains(p.company_ids_str, s.ingest_company_id)

    -- Partition pruning (partition_year + partition_month)
    AND s.partition_year >= {{partition_year_start}}
    AND s.partition_year <= {{partition_year_end}}
    AND (s.partition_year > {{partition_year_start}} OR s.partition_month >= {{partition_month_start}})
    AND (s.partition_year < {{partition_year_end}}   OR s.partition_month <= {{partition_month_end}})

    -- Date filter on posted_date (precise, after partition pruning)
    AND (p.start_date IS NULL OR TRY_CAST(s.posted_date AS DATE) >= p.start_date)
    AND (p.end_date   IS NULL OR TRY_CAST(s.posted_date AS DATE) <= p.end_date)

    -- Settlement ID filter
    AND (
      cardinality(p.settlement_ids) = 0
      OR contains(p.settlement_ids, s.settlement_id)
    )

    -- Marketplace filter
    AND (
      cardinality(p.marketplace_names) = 0
      OR any_match(p.marketplace_names, mn -> lower(mn) = lower(s.marketplace_name))
    )

    -- Transaction type filter
    AND (
      cardinality(p.transaction_types) = 0
      OR any_match(p.transaction_types, tt -> lower(tt) = lower(s.transaction_type))
    )

    -- Amount type filter
    AND (
      cardinality(p.amount_types) = 0
      OR any_match(p.amount_types, at -> lower(at) = lower(s.amount_type))
    )

    -- Amount description filter
    AND (
      cardinality(p.amount_descriptions) = 0
      OR any_match(p.amount_descriptions, ad -> lower(s.amount_description) LIKE '%' || lower(ad) || '%')
    )

    -- Order ID filter
    AND (
      cardinality(p.order_ids) = 0
      OR any_match(p.order_ids, oid -> oid = s.order_id)
    )

    -- SKU filter
    AND (
      cardinality(p.skus) = 0
      OR any_match(p.skus, sk -> lower(sk) = lower(s.sku))
    )

    -- Fulfillment ID filter
    AND (
      cardinality(p.fulfillment_ids) = 0
      OR any_match(p.fulfillment_ids, fi -> lower(fi) = lower(s.fulfillment_id))
    )

    -- Amount range filter
    AND (p.min_amount IS NULL OR s.amount >= p.min_amount)
    AND (p.max_amount IS NULL OR s.amount <= p.max_amount)
),

-- ─── Aggregate by dynamic group-by ──────────────────────────────────────────
aggregated AS (
  SELECT
    -- Periodicity key
    CASE p.periodicity
      WHEN 'day'     THEN CAST(TRY_CAST(e.posted_date AS DATE) AS VARCHAR)
      WHEN 'week'    THEN DATE_FORMAT(TRY_CAST(e.posted_date AS DATE), '%x-W%v')
      WHEN 'month'   THEN DATE_FORMAT(TRY_CAST(e.posted_date AS DATE), '%Y-%m')
      WHEN 'quarter' THEN CAST(YEAR(TRY_CAST(e.posted_date AS DATE)) AS VARCHAR) || '-Q' || CAST(QUARTER(TRY_CAST(e.posted_date AS DATE)) AS VARCHAR)
      WHEN 'year'    THEN CAST(YEAR(TRY_CAST(e.posted_date AS DATE)) AS VARCHAR)
      ELSE NULL
    END                                                                    AS time_period,

    -- Conditional group-by keys
    CASE WHEN p.group_by_company = 1 THEN e.company_id ELSE NULL END       AS company_id,
    CASE WHEN p.group_by_company = 1 THEN e.company_name ELSE NULL END     AS company_name,
    CASE WHEN p.group_by_company = 1 THEN e.main_currency ELSE NULL END    AS main_currency,
    CASE WHEN p.group_by_marketplace = 1 THEN e.marketplace_name ELSE NULL END AS marketplace_name,
    CASE WHEN p.group_by_marketplace = 1 THEN e.statement_currency ELSE NULL END AS statement_currency,
    CASE WHEN p.group_by_settlement = 1 THEN e.settlement_id ELSE NULL END AS settlement_id,
    CASE WHEN p.group_by_settlement = 1 THEN e.deposit_date ELSE NULL END  AS deposit_date,
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
    SUM(e.quantity_purchased)                  AS total_quantity

  FROM enriched e
  CROSS JOIN params p
  GROUP BY
    CASE p.periodicity
      WHEN 'day'     THEN CAST(TRY_CAST(e.posted_date AS DATE) AS VARCHAR)
      WHEN 'week'    THEN DATE_FORMAT(TRY_CAST(e.posted_date AS DATE), '%x-W%v')
      WHEN 'month'   THEN DATE_FORMAT(TRY_CAST(e.posted_date AS DATE), '%Y-%m')
      WHEN 'quarter' THEN CAST(YEAR(TRY_CAST(e.posted_date AS DATE)) AS VARCHAR) || '-Q' || CAST(QUARTER(TRY_CAST(e.posted_date AS DATE)) AS VARCHAR)
      WHEN 'year'    THEN CAST(YEAR(TRY_CAST(e.posted_date AS DATE)) AS VARCHAR)
      ELSE NULL
    END,
    CASE WHEN p.group_by_company = 1 THEN e.company_id ELSE NULL END,
    CASE WHEN p.group_by_company = 1 THEN e.company_name ELSE NULL END,
    CASE WHEN p.group_by_company = 1 THEN e.main_currency ELSE NULL END,
    CASE WHEN p.group_by_marketplace = 1 THEN e.marketplace_name ELSE NULL END,
    CASE WHEN p.group_by_marketplace = 1 THEN e.statement_currency ELSE NULL END,
    CASE WHEN p.group_by_settlement = 1 THEN e.settlement_id ELSE NULL END,
    CASE WHEN p.group_by_settlement = 1 THEN e.deposit_date ELSE NULL END,
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
  a.main_currency,
  a.marketplace_name,
  a.statement_currency,
  a.settlement_id,
  a.deposit_date,
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
