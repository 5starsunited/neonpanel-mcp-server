-- Tool: network_rebalance_recommendations
-- Draft SQL scaffold. Replace NULL columns with real fields/expressions and update FROM/WHERE as needed.
-- This draft intentionally enumerates all output fields from the tool JSON (flattened).

SELECT
  company_id,
  NULL AS recommendations_item_ref_inventory_id,
  NULL AS recommendations_item_ref_sku,
  NULL AS recommendations_item_ref_asin,
  NULL AS recommendations_item_ref_marketplace,
  NULL AS recommendations_item_ref_item_name,
  NULL AS recommendations_item_ref_item_icon_url,
  NULL AS recommendations_move_direction,
  NULL AS recommendations_recommended_units,
  NULL AS recommendations_reason
FROM "{{catalog}}"."{{database}}"."{{table}}"
WHERE company_id IN ({{companyIdsSql}})
LIMIT {{topN}}
