-- Tool: amazon_supply_chain.inventory_sku_deep_dive
-- Purpose: return the raw inventory_planning_snapshot row(s) for a specific SKU + marketplace.
-- Notes:
-- - company_id filtering is REQUIRED for authorization + partition pruning.
-- - This query always filters to the latest (year,month,day) partition for the permitted company_ids.

WITH params AS (
  SELECT
    {{company_ids_array}} AS company_ids,
    {{sku_sql}} AS sku,
    {{marketplace_sql}} AS marketplace,
    {{limit_top_n}} AS top_results
),

latest_snapshot AS (
  SELECT pil.year, pil.month, pil.day
  FROM "{{catalog}}"."{{database}}"."{{table}}" pil
  CROSS JOIN params p
  WHERE contains(p.company_ids, pil.company_id)
  GROUP BY 1, 2, 3
  ORDER BY CAST(pil.year AS INTEGER) DESC, CAST(pil.month AS INTEGER) DESC, CAST(pil.day AS INTEGER) DESC
  LIMIT 1
)

SELECT
  pil.*,

  -- Standardized aliases for MCP output parsing/beautification
  pil.inventory_id AS item_ref_inventory_id,
  pil.sku AS item_ref_sku,
  CAST(NULL AS VARCHAR) AS item_ref_asin,
  pil.country AS item_ref_marketplace,
  pil.product_name AS item_ref_item_name,
  pil.asin_img_path AS item_ref_item_icon_url,

  pil.year AS snapshot_year,
  pil.month AS snapshot_month,
  pil.day AS snapshot_day

FROM "{{catalog}}"."{{database}}"."{{table}}" pil
CROSS JOIN params p
CROSS JOIN latest_snapshot s

WHERE
  contains(p.company_ids, pil.company_id)

  AND pil.year = s.year
  AND pil.month = s.month
  AND pil.day = s.day

  AND pil.sku = p.sku
  AND pil.country = p.marketplace

LIMIT {{limit_top_n}};
