-- Tool: assortment_action_plan_generate
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
  NULL AS plan_action,
  NULL AS plan_owner_role,
  NULL AS plan_due_date,
  NULL AS plan_success_metric
FROM "{{catalog}}"."{{database}}"."{{table}}"
WHERE company_id IN ({{companyIdsSql}})
LIMIT {{topN}}
