-- Tool: shopify_list_inventory_balances (detail mode)
-- Purpose: List Shopify inventory balance records with warehouse and seller details.
-- Data sources:
--   shopify_balances      SFY  (quantity, sku, barcode, date, type)
--   shopify_sellers       SL   ON SL.id = SFY.seller_id AND SFY.company_id = SL.company_id  (seller name, domain, status)
--   inventory_warehouses  W    ON W.id  = SFY.warehouse_id  (warehouse name)
--   app_companies         C    ON C.id  = SFY.company_id    (company name)

WITH params AS (
  SELECT
    {{limit_top_n}} AS top_results,

    -- REQUIRED (authorization + partition pruning)
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

    -- Snapshot filter: if set, only return rows for that exact date
    {{snapshot_date_sql}} AS snapshot_date
),

t_base AS (
  SELECT
    sfy.id AS balance_id,
    sfy.company_id,
    c.name AS company_name,

    sfy.seller_id,
    sl.name AS seller_name,
    sl.status AS store_status,
    sl.domain AS store_domain,
    sl.state AS connection_state,

    sfy.date AS snapshot_date,
    CAST(sfy.type AS VARCHAR) AS balance_type,

    sfy.inventory_id,
    sfy.warehouse_id,
    w.name AS warehouse_name,

    sfy.quantity AS stock_quantity,

    sfy.shopify_variant_id,
    sfy.sku AS product_sku,
    sfy.barcode,

    sfy.synced_at AS last_sync_timestamp

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
    -- REQUIRED: company authorization
    contains(p.company_ids, sfy.company_id)

    -- Snapshot date: exact date match (highest priority date filter)
    AND (p.snapshot_date IS NULL OR CAST(sfy.date AS DATE) = CAST(p.snapshot_date AS DATE))

    -- Date range (only applied when snapshot_date is NULL)
    AND (p.snapshot_date IS NOT NULL OR p.date_from IS NULL OR CAST(sfy.date AS DATE) >= CAST(p.date_from AS DATE))
    AND (p.snapshot_date IS NOT NULL OR p.date_to   IS NULL OR CAST(sfy.date AS DATE) <= CAST(p.date_to   AS DATE))

    -- Optional filters
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
      OR contains(p.balance_types_lower, lower(trim(CAST(sfy.type AS VARCHAR))))
    )
    AND (
      cardinality(p.seller_statuses) = 0
      OR contains(p.seller_statuses_lower, lower(trim(CAST(sl.status AS VARCHAR))))
    )
    AND (cardinality(p.inventory_ids) = 0 OR contains(p.inventory_ids, sfy.inventory_id))
)

-- Detail output
SELECT
  t.balance_id,
  t.company_id,
  t.company_name,

  t.seller_id,
  t.seller_name,
  t.store_status,
  t.store_domain,
  t.connection_state,

  CAST(t.snapshot_date AS VARCHAR) AS snapshot_date,
  t.balance_type,

  t.inventory_id,
  t.warehouse_id,
  t.warehouse_name,

  t.stock_quantity,

  t.shopify_variant_id,
  t.product_sku,
  t.barcode,

  CAST(t.last_sync_timestamp AS VARCHAR) AS last_sync_timestamp

FROM t_base t
CROSS JOIN params p

ORDER BY
  t.snapshot_date DESC,
  COALESCE(t.stock_quantity, 0) DESC

LIMIT {{limit_top_n}}
