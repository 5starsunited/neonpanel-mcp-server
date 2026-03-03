-- Tool: financials_classify_amazon_statement_transactions
-- Purpose: Aggregate classified settlement transactions by class/subclass for reconciliation.
-- Source: financial_accounting.amazon_statement_details_classified (view)
--         + amazon_sellers / amazon_marketplaces for marketplace resolution
-- The view already handles classification rule matching (settlement_subclass_mapping),
-- subclass/class name lookup, and service_name generation.

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

-- ── Marketplace resolution (amazon_seller_id → marketplace code) ─────
seller_marketplace AS (
  SELECT
    asl.amazon_seller_id,
    am.code   AS marketplace_code,
    am.name   AS marketplace_name,
    am.country AS marketplace_country
  FROM "{{catalog}}"."neonpanel_iceberg"."amazon_sellers" asl
  INNER JOIN "{{catalog}}"."neonpanel_iceberg"."amazon_marketplaces" am
    ON am.id = asl.marketplace_id
),

-- ── Filtered classified rows ─────────────────────────────────────────
filtered AS (
  SELECT
    cv.settlement_id,
    cv.company_id,
    cv.amazon_seller_id,
    cv.currency,
    cv.transaction_type,
    cv.amount_type,
    cv.amount_description,
    cv.transaction_date,
    cv.amount,
    cv.quantity,
    cv.subclass_code,
    cv.subclass_name,
    cv.class_code,
    cv.class_name,
    cv.service_name,

    -- Marketplace from seller
    sm.marketplace_code,
    sm.marketplace_name,
    sm.marketplace_country,

    -- Debit / credit split (positive = credit to seller, negative = debit/charge)
    CASE WHEN cv.amount >= 0 THEN cv.amount ELSE 0 END AS credit_amount,
    CASE WHEN cv.amount < 0  THEN ABS(cv.amount) ELSE 0 END AS debit_amount

  FROM "{{catalog}}"."financial_accounting"."amazon_statement_details_classified" cv

  LEFT JOIN seller_marketplace sm
    ON sm.amazon_seller_id = cv.amazon_seller_id

  CROSS JOIN params p

  WHERE
    -- Authorization
    contains(p.company_ids_str, cv.company_id)

    -- Partition pruning (settlement_year + settlement_month)
    AND cv.settlement_year >= {{partition_year_start}}
    AND cv.settlement_year <= {{partition_year_end}}
    AND (cv.settlement_year > {{partition_year_start}} OR cv.settlement_month >= {{partition_month_start}})
    AND (cv.settlement_year < {{partition_year_end}}   OR cv.settlement_month <= {{partition_month_end}})

    -- Date filter on transaction_date
    AND (p.start_date IS NULL OR CAST(cv.transaction_date AS DATE) >= p.start_date)
    AND (p.end_date   IS NULL OR CAST(cv.transaction_date AS DATE) <= p.end_date)

    -- Settlement ID filter
    AND (
      cardinality(p.settlement_ids) = 0
      OR contains(p.settlement_ids, cv.settlement_id)
    )

    -- Marketplace code filter
    AND (
      cardinality(p.marketplace_codes) = 0
      OR any_match(p.marketplace_codes, mc -> lower(mc) = lower(sm.marketplace_code))
    )

    -- Class code filter
    AND (
      cardinality(p.class_codes) = 0
      OR contains(p.class_codes, cv.class_code)
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
    SUM(f.quantity)         AS total_quantity

  FROM filtered f
  CROSS JOIN params p
  GROUP BY
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
  a.class_code,
  a.class_name,
  a.subclass_code,
  a.subclass_name,
  a.service_name,
  a.marketplace_code,
  a.marketplace_name,
  a.settlement_id,
  ROUND(a.total_amount, 2)  AS total_amount,
  ROUND(a.total_debit, 2)   AS total_debit,
  ROUND(a.total_credit, 2)  AS total_credit,
  a.line_count,
  a.total_quantity
FROM aggregated a
ORDER BY {{sort_column}} {{sort_direction}} NULLS LAST
LIMIT {{limit_top_n}}
