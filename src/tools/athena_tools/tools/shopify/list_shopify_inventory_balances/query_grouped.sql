-- Tool: shopify_list_inventory_balances (grouped/aggregated mode)
-- Purpose: Aggregated view of Shopify inventory balances, grouped by caller-specified dimensions.
-- Notes:
--   - Dimensions injected via template variables (group_select_base, group_by_clause_base, etc.)
--   - company_id is always included in GROUP BY for authorization.

WITH params AS (
  SELECT
    {{limit_top_n}} AS top_results,

    -- REQUIRED (authorization)
    {{company_ids_array}} AS company_ids,

    -- OPTIONAL filters (empty array => no filter)
    {{skus_array}} AS skus,
    {{skus_lower_array}} AS skus_lower,
    {{barcodes_array}} AS barcodes,
    {{warehouse_names_array}} AS warehouse_names,
    {{warehouse_names_lower_array}} AS warehouse_names_lower,
    {{seller_names_array}} AS seller_names,
    {{seller_names_lower_array}} AS seller_names_lower,
    {{balance_types_array}} AS balance_types,
    {{balance_types_lower_array}} AS balance_types_lower,
    {{seller_statuses_array}} AS seller_statuses,
    {{seller_statuses_lower_array}} AS seller_statuses_lower,
    {{inventory_ids_array}} AS inventory_ids,

    -- Date range filter (nullable)
    {{date_from_sql}} AS date_from,
    {{date_to_sql}} AS date_to,

    -- Snapshot filter
    {{snapshot_date_sql}} AS snapshot_date
),

t_base AS (
  SELECT
    sfy.company_id,
    c.name AS company_name,

    sfy.seller_id,
    sl.name AS seller_name,
    sl.status AS store_status,
    sl.domain AS store_domain,

    sfy.date AS snapshot_date,
    sfy.type AS balance_type,

    sfy.inventory_id,
    w.name AS warehouse_name,

    sfy.quantity AS stock_quantity,

    sfy.sku AS product_sku,
    sfy.barcode

  FROM "{{catalog}}"."neonpanel_iceberg"."shopify_balances" sfy
  CROSS JOIN params p

  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."shopify_sellers" sl
    ON sl.id = sfy.seller_id
    AND sfy.company_id = sl.company_id

  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."inventory_warehouses" w
    ON w.id = sfy.warehouse_id

  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."app_companies" c
    ON c.id = sfy.company_id

  WHERE
    contains(p.company_ids, sfy.company_id)

    AND (p.snapshot_date IS NULL OR CAST(sfy.date AS DATE) = CAST(p.snapshot_date AS DATE))
    AND (p.snapshot_date IS NOT NULL OR p.date_from IS NULL OR CAST(sfy.date AS DATE) >= CAST(p.date_from AS DATE))
    AND (p.snapshot_date IS NOT NULL OR p.date_to   IS NULL OR CAST(sfy.date AS DATE) <= CAST(p.date_to   AS DATE))

    AND (
      cardinality(p.skus) = 0
      OR contains(p.skus, sfy.sku)
      OR contains(p.skus_lower, lower(trim(sfy.sku)))
    )
    AND (cardinality(p.barcodes) = 0 OR contains(p.barcodes, sfy.barcode))
    AND (
      cardinality(p.warehouse_names) = 0
      OR contains(p.warehouse_names_lower, lower(trim(w.name)))
    )
    AND (
      cardinality(p.seller_names) = 0
      OR contains(p.seller_names_lower, lower(trim(sl.name)))
    )
    AND (
      cardinality(p.balance_types) = 0
      OR contains(p.balance_types_lower, lower(trim(sfy.type)))
    )
    AND (
      cardinality(p.seller_statuses) = 0
      OR contains(p.seller_statuses_lower, lower(trim(sl.status)))
    )
    AND (cardinality(p.inventory_ids) = 0 OR contains(p.inventory_ids, sfy.inventory_id))
),

-- Aggregation
t_grouped AS (
  SELECT
    {{group_select_base}},

    COUNT(*) AS record_count,
    COUNT(DISTINCT t.inventory_id) AS distinct_inventory_ids,
    COUNT(DISTINCT t.product_sku) AS distinct_skus,

    SUM(COALESCE(CAST(t.stock_quantity AS BIGINT), 0)) AS total_stock_quantity,
    AVG(COALESCE(CAST(t.stock_quantity AS DOUBLE), 0.0)) AS avg_stock_quantity,
    MIN(COALESCE(CAST(t.stock_quantity AS BIGINT), 0)) AS min_stock_quantity,
    MAX(COALESCE(CAST(t.stock_quantity AS BIGINT), 0)) AS max_stock_quantity,

    MIN(CAST(t.snapshot_date AS VARCHAR)) AS earliest_snapshot_date,
    MAX(CAST(t.snapshot_date AS VARCHAR)) AS latest_snapshot_date

  FROM t_base t
  GROUP BY {{group_by_clause_base}}
)

SELECT
  g.*
FROM t_grouped g
ORDER BY g.total_stock_quantity DESC
LIMIT {{limit_top_n}}
