-- Tool: fba_create_shipment_draft
-- Draft SQL scaffold. Replace NULL columns with real fields/expressions and update FROM/WHERE as needed.
-- This draft intentionally enumerates all output fields from the tool JSON (flattened).

SELECT
  company_id,
  NULL AS draft_id,
  NULL AS items_item_ref_inventory_id,
  NULL AS items_item_ref_sku,
  NULL AS items_item_ref_asin,
  NULL AS items_item_ref_marketplace,
  NULL AS items_item_ref_item_name,
  NULL AS items_item_ref_item_icon_url,
  NULL AS items_quantity,
  NULL AS items_priority,
  NULL AS summary
FROM "{{catalog}}"."{{database}}"."{{table}}"
WHERE company_id IN ({{companyIdsSql}})
LIMIT {{topN}}
