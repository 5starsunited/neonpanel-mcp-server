-- Tool: financials_classify_amazon_statement_transactions
-- Purpose: Aggregate classified settlement transactions by class/subclass for reconciliation.
-- Source: sp_api_iceberg.amazon_statement_details (base table, partitioned)
--         + financial_accounting.settlement_subclass_mapping (classification rules)
--         + financial_accounting.settlement_subclasses / settlement_classes (lookups)
--         + amazon_sellers / amazon_marketplaces for marketplace resolution
-- NOTE: We inline the view logic instead of querying the view so Athena can
--       push partition filters (settlement_year, settlement_month) directly
--       to the Iceberg base table scan.

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

-- ── Classify: inline the view logic against the base table ───────────
-- This matches financial_accounting.amazon_statement_details_classified
-- but lets Athena prune partitions on the base table scan.
classified AS (
  SELECT
    d.*,
    m.subclass_code AS mapped_subclass_code,
    ROW_NUMBER() OVER (
      PARTITION BY d.settlement_id, d.posted_date_time_raw,
                   d.transaction_type, d.amount_type,
                   d.amount_description, d.order_id, d.sku, d.amount
      ORDER BY m.rule_priority
    ) AS rn
  FROM "{{catalog}}"."sp_api_iceberg"."amazon_statement_details" d
  CROSS JOIN params p
  LEFT JOIN "{{catalog}}"."financial_accounting"."settlement_subclass_mapping" m
    ON (m.transaction_type IS NULL OR d.transaction_type = m.transaction_type)
   AND (m.amount_type IS NULL OR d.amount_type = m.amount_type)
   AND (m.amount_description IS NULL
        OR (m.match_mode = 'exact' AND d.amount_description = m.amount_description)
        OR (m.match_mode = 'like'  AND d.amount_description LIKE m.amount_description)
        OR (m.match_mode = 'regex' AND regexp_like(d.amount_description, m.amount_description)))
   AND (m.fulfillment_id IS NULL OR d.fulfillment_id = m.fulfillment_id)
   AND (m.amount_sign IS NULL
        OR (m.amount_sign = 'non_negative' AND d.amount >= 0)
        OR (m.amount_sign = 'negative'     AND d.amount < 0))
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

-- ── Resolve subclass/class names and service_name ────────────────────
classified_resolved AS (
  SELECT
    c.settlement_id,
    c.company_id,
    c.amazon_seller_id,
    c.currency,
    c.transaction_type,
    c.amount_type,
    c.amount_description,
    c.transaction_date,
    c.amount,
    c.quantity,
    c.order_id,
    c.merchant_order_id,
    c.fulfillment_id,
    COALESCE(c.mapped_subclass_code, '9.99') AS subclass_code,
    sc.subclass_name,
    sc.class_code,
    cl.class_name,
    CONCAT(
      CASE
        WHEN c.order_id IS NOT NULL
             AND c.merchant_order_id IS NOT NULL
             AND c.order_id != c.merchant_order_id
             AND NOT regexp_like(c.order_id, '^\d{3}-\d{7}-\d{7}$')
        THEN 'Amazon MCF'
        ELSE 'Amazon'
      END,
      ' ',
      CASE
        WHEN c.amount_description IN (
                'FREE_REPLACEMENT_REFUND_ITEMS', 'WAREHOUSE_DAMAGE',
                'WAREHOUSE_DAMAGE_EXCEPTION', 'WAREHOUSE_LOST_MANUAL',
                'CS_ERROR_ITEMS', 'REVERSAL_REIMBURSEMENT',
                'MISSING_FROM_INBOUND', 'REMOVAL_ORDER_LOST')
             OR c.amount_type = 'FBA Inventory Reimbursement'
             OR (c.amount_type = 'ItemPrice' AND c.amount_description = 'Principal')
        THEN c.amount_description || ' ' || c.transaction_type
        WHEN c.amount_type IN ('Tax', 'Promotion', 'CouponRedemptionFee', 'Grade and Resell Charge')
        THEN c.amount_type || ' ' || c.transaction_type
        WHEN c.amount_description = 'Transaction Total Amount'
        THEN 'Cost of Advertising ' || c.transaction_type
        ELSE c.amount_description || ' ' || c.transaction_type
      END
    ) AS service_name
  FROM classified c
  LEFT JOIN "{{catalog}}"."financial_accounting"."settlement_subclasses" sc
    ON sc.subclass_code = COALESCE(c.mapped_subclass_code, '9.99')
  LEFT JOIN "{{catalog}}"."financial_accounting"."settlement_classes" cl
    ON sc.class_code = cl.class_code
  WHERE c.rn = 1
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

    -- Debit / credit split
    CASE WHEN cv.amount >= 0 THEN cv.amount ELSE 0 END AS credit_amount,
    CASE WHEN cv.amount < 0  THEN ABS(cv.amount) ELSE 0 END AS debit_amount

  FROM classified_resolved cv

  LEFT JOIN seller_marketplace sm
    ON sm.amazon_seller_id = cv.amazon_seller_id

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
    -- Currency is ALWAYS grouped to prevent mixing different currencies
    f.currency,

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
    f.currency,
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
  ROUND(a.total_amount, 2)  AS total_amount,
  ROUND(a.total_debit, 2)   AS total_debit,
  ROUND(a.total_credit, 2)  AS total_credit,
  a.line_count,
  a.total_quantity
FROM aggregated a
ORDER BY {{sort_column}} {{sort_direction}} NULLS LAST
LIMIT {{limit_top_n}}
