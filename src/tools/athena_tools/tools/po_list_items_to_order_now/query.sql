-- Tool: po_list_items_to_order_now
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
  NULL AS items_supplier,
  NULL AS items_total_available_units,
  NULL AS items_days_to_oos_total,
  NULL AS items_recommended_po_units,
  NULL AS items_recommended_po_date,
  NULL AS items_priority,
  NULL AS items_reason
FROM "{{catalog}}"."{{database}}"."{{table}}"
WHERE company_id IN ({{companyIdsSql}})
LIMIT {{limit}}
