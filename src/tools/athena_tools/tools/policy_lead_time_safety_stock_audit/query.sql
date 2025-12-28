-- Tool: policy_lead_time_safety_stock_audit
-- Draft SQL scaffold. Replace NULL columns with real fields/expressions and update FROM/WHERE as needed.
-- This draft intentionally enumerates all output fields from the tool JSON (flattened).

SELECT
  company_id,
  NULL AS items_item_ref_inventory_id,
  NULL AS items_item_ref_sku,
  NULL AS items_item_ref_asin,
  NULL AS items_item_ref_marketplace,
  NULL AS items_item_ref_item_name,
  NULL AS items_item_ref_item_icon_url,
  NULL AS items_current_lead_time_days,
  NULL AS items_observed_lead_time_days_p50,
  NULL AS items_observed_lead_time_days_p90,
  NULL AS items_current_safety_stock_days,
  NULL AS items_recommended_safety_stock_days,
  NULL AS items_recommendation
FROM "{{catalog}}"."{{database}}"."{{table}}"
WHERE company_id IN ({{companyIdsSql}})
LIMIT {{topN}}
