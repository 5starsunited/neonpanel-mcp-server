-- Tool: event_seasonal_build_plan
-- Draft SQL scaffold. Replace NULL columns with real fields/expressions and update FROM/WHERE as needed.
-- This draft intentionally enumerates all output fields from the tool JSON (flattened).

SELECT
  company_id,
  NULL AS plan_item_ref_inventory_id,
  NULL AS plan_item_ref_sku,
  NULL AS plan_item_ref_asin,
  NULL AS plan_item_ref_marketplace,
  NULL AS plan_item_ref_item_name,
  NULL AS plan_item_ref_item_icon_url,
  NULL AS plan_recommended_prebuild_units,
  NULL AS plan_expected_event_sell_units,
  NULL AS plan_notes
FROM "{{catalog}}"."{{database}}"."{{table}}"
WHERE company_id IN ({{companyIdsSql}})
LIMIT {{limit}}
