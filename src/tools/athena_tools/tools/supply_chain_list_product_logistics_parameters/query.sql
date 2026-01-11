-- Tool: supply_chain_list_product_logistics_parameters
-- Purpose: return product logistics parameters (vendor, product_spec, dimensions, box params, MOQ)
--          from the latest inventory_planning_snapshot partition.
-- Notes:
-- - company_id filtering is REQUIRED for authorization + partition pruning.
-- - Keep the result set intentionally narrow (avoid returning pil.*).

WITH params AS (
  SELECT
    {{company_ids_array}} AS company_ids,
    {{inventory_ids_array}} AS inventory_ids,
    {{sku_sql}} AS sku,
    {{apply_inventory_ids_filter_sql}} AS apply_inventory_ids_filter,
    {{apply_sku_filter_sql}} AS apply_sku_filter,
    {{limit_top_n}} AS top_results
),

normalized_params AS (
  SELECT
    company_ids,
    inventory_ids,
    UPPER(TRIM(regexp_replace(sku, '[‐‑‒–—−]', '-'))) AS sku_norm,
    apply_inventory_ids_filter,
    apply_sku_filter,
    top_results
  FROM params
),

latest_snapshot AS (
  SELECT pil.year, pil.month, pil.day
  FROM "{{catalog}}"."{{database}}"."{{table}}" pil
  CROSS JOIN normalized_params p
  WHERE contains(p.company_ids, pil.company_id)
  GROUP BY 1, 2, 3
  ORDER BY CAST(pil.year AS INTEGER) DESC, CAST(pil.month AS INTEGER) DESC, CAST(pil.day AS INTEGER) DESC
  LIMIT 1
)

SELECT
  -- Core logistics fields
  pil.company_id AS company_id,
  pil.brand AS brand,
  pil.vendor AS vendor,
  pil.product_family AS product_family,
  pil.vendor_product_specs AS vendor_product_specs,
  pil.optional_product_code AS optional_product_code,
  pil.optional_product_code_type AS optional_product_code_type,

  pil.product_weight AS product_weight,
  pil.product_length AS product_length,
  pil.product_depth AS product_depth,
  pil.product_height AS product_height,
  pil.length_and_girth AS length_and_girth,

  pil.box_quantity AS box_quantity,
  pil.box_height AS box_height,
  pil.box_depth AS box_depth,
  pil.box_length AS box_length,
  pil.box_weight AS box_weight,
  pil.moq AS moq,

  -- Standardized aliases for MCP output parsing/beautification
  pil.inventory_id AS item_ref_inventory_id,
  pil.sku AS item_ref_sku,
  CAST(NULL AS VARCHAR) AS item_ref_asin,
  pil.country_code AS item_ref_marketplace,
  pil.product_name AS item_ref_item_name,
  pil.asin_img_path AS item_ref_item_icon_url,

  pil.year AS snapshot_year,
  pil.month AS snapshot_month,
  pil.day AS snapshot_day

FROM "{{catalog}}"."{{database}}"."{{table}}" pil
CROSS JOIN normalized_params p
CROSS JOIN latest_snapshot s

WHERE
  contains(p.company_ids, pil.company_id)

  AND pil.year = s.year
  AND pil.month = s.month
  AND pil.day = s.day

  AND (
    (p.apply_inventory_ids_filter AND contains(p.inventory_ids, pil.inventory_id))
    OR (
      p.apply_sku_filter
      AND UPPER(TRIM(regexp_replace(pil.sku, '[‐‑‒–—−]', '-'))) = p.sku_norm
    )
  )

LIMIT {{limit_top_n}};
