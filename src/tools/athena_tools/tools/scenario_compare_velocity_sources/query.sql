-- Tool: scenario_compare_velocity_sources
-- Draft SQL scaffold. Replace NULL columns with real fields/expressions and update FROM/WHERE as needed.
-- This draft intentionally enumerates all output fields from the tool JSON (flattened).

SELECT
  company_id,
  NULL AS comparisons_item_ref_inventory_id,
  NULL AS comparisons_item_ref_sku,
  NULL AS comparisons_item_ref_asin,
  NULL AS comparisons_item_ref_marketplace,
  NULL AS comparisons_item_ref_item_name,
  NULL AS comparisons_item_ref_item_icon_url,
  NULL AS comparisons_days_to_oos_current,
  NULL AS comparisons_days_to_oos_planned,
  NULL AS comparisons_days_to_oos_target,
  NULL AS comparisons_most_conservative,
  NULL AS comparisons_note
FROM "{{catalog}}"."{{database}}"."{{table}}"
WHERE company_id IN ({{companyIdsSql}})
LIMIT {{topN}}
