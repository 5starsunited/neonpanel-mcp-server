-- Tool: financials_classify_amazon_statement_transactions (default / CoA-based mode)
-- Purpose: Aggregate classified settlement transactions by Chart of Accounts mapping.
--          Joins service_name → services.name → accounts → account_types
--          to produce totals grouped by account_classification / account_type / account_name.
-- Source: sp_api_iceberg.amazon_statement_details (base table, partitioned)
--         + financial_accounting.settlement_subclass_mapping (to compute service_name)
--         + financial_accounting.settlement_subclasses / settlement_classes
--         + neonpanel_iceberg.services (service → CoA mapping via income_account_id)
--         + neonpanel_iceberg.accounts (CoA accounts)
--         + neonpanel_iceberg.account_types (account type + classification)
--         + amazon_sellers / amazon_marketplaces for marketplace resolution

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

-- ── Marketplace resolution (amazon_seller_id → marketplace code) ─────
-- Deduplicated to exactly 1 row per amazon_seller_id to prevent fan-out.
seller_marketplace AS (
  SELECT
    amazon_seller_id,
    marketplace_code,
    marketplace_name,
    marketplace_country
  FROM (
    SELECT
      asl.amazon_seller_id,
      am.code   AS marketplace_code,
      am.name   AS marketplace_name,
      am.country AS marketplace_country,
      ROW_NUMBER() OVER (PARTITION BY asl.amazon_seller_id ORDER BY am.id) AS rn
    FROM "{{catalog}}"."neonpanel_iceberg"."amazon_sellers" asl
    INNER JOIN "{{catalog}}"."neonpanel_iceberg"."amazon_marketplaces" am
      ON am.id = asl.marketplace_id
  )
  WHERE rn = 1
),

-- ── Classify: inline the view logic against the base table ───────────
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

-- ── Resolve service_name (same logic as reference mode) ──────────────
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
  WHERE c.rn = 1
),

-- ── Map service_name → CoA via services → accounts → account_types ───
coa_mapped AS (
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
    cv.service_name,

    -- CoA mapping status (3 states)
    -- mapped:          service found + account found → full CoA classification
    -- account_missing: service found + income_account_id set, but account row missing (dangling FK)
    -- unmapped:        no matching service found for this service_name + company
    CASE
      WHEN s.income_account_id IS NOT NULL AND a.name IS NOT NULL THEN 'mapped'
      WHEN s.income_account_id IS NOT NULL AND a.name IS NULL     THEN 'account_missing'
      WHEN s.id IS NOT NULL AND s.income_account_id IS NULL       THEN 'unmapped'
      ELSE 'unmapped'
    END AS mapping_status,
    a.name              AS account_name,
    a.full_name         AS account_full_name,
    a.number            AS account_number,
    atypes.name         AS account_type,
    atypes.classification AS account_classification,

    -- Marketplace from seller (deduplicated)
    sm.marketplace_code,
    sm.marketplace_name,
    sm.marketplace_country,

    -- Debit / credit split
    CASE WHEN cv.amount >= 0 THEN cv.amount ELSE 0 END AS credit_amount,
    CASE WHEN cv.amount < 0  THEN ABS(cv.amount) ELSE 0 END AS debit_amount

  FROM classified_resolved cv

  -- Service → Account → Account Type (direct join, no dedup needed)
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."services" s
    ON lower(s.name) = lower(cv.service_name)
    AND s.company_id = CAST(cv.company_id AS BIGINT)
    AND s.template = 0
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."accounts" a
    ON a.id = s.income_account_id
    AND a.company_id = s.company_id
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."account_types" atypes
    ON atypes.id = a.account_type_id

  -- Seller → Marketplace (deduplicated)
  LEFT JOIN seller_marketplace sm
    ON sm.amazon_seller_id = cv.amazon_seller_id
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
    SUM(f.quantity)        AS total_quantity

  FROM filtered f
  CROSS JOIN params p
  GROUP BY
    f.currency,
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
  ROUND(a.total_amount, 2)  AS total_amount,
  ROUND(a.total_debit, 2)   AS total_debit,
  ROUND(a.total_credit, 2)  AS total_credit,
  a.line_count,
  a.total_quantity
FROM aggregated a
ORDER BY {{sort_column}} {{sort_direction}} NULLS LAST
LIMIT {{limit_top_n}}
