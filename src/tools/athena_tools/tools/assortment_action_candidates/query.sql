-- Tool: assortment_action_candidates
-- Draft SQL scaffold. Replace NULL columns with real fields/expressions and update FROM/WHERE as needed.
-- This draft intentionally enumerates all output fields from the tool JSON (flattened).

SELECT
  company_id,
  NULL AS candidates_item_ref_inventory_id,
  NULL AS candidates_item_ref_sku,
  NULL AS candidates_item_ref_asin,
  NULL AS candidates_item_ref_marketplace,
  NULL AS candidates_item_ref_item_name,
  NULL AS candidates_item_ref_item_icon_url,
  NULL AS candidates_issue,
  NULL AS candidates_recommended_action,
  NULL AS candidates_severity,
  NULL AS candidates_supporting_metrics
FROM "{{catalog}}"."{{database}}"."{{table}}"
WHERE company_id IN ({{companyIdsSql}})
LIMIT {{limit}}
