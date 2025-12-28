-- Tool: inbound_expedite_candidates
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
  NULL AS candidates_shipment_id,
  NULL AS candidates_days_to_oos,
  NULL AS candidates_expedite_recommendation,
  NULL AS candidates_reason,
  NULL AS candidates_severity
FROM "{{catalog}}"."{{database}}"."{{table}}"
WHERE company_id IN ({{companyIdsSql}})
LIMIT {{topN}}
