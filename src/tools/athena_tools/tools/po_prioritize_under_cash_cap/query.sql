-- Tool: po_prioritize_under_cash_cap
-- Draft SQL scaffold. Replace NULL columns with real fields/expressions and update FROM/WHERE as needed.
-- This draft intentionally enumerates all output fields from the tool JSON (flattened).

SELECT
  company_id,
  NULL AS selected_items_item_ref_inventory_id,
  NULL AS selected_items_item_ref_sku,
  NULL AS selected_items_item_ref_asin,
  NULL AS selected_items_item_ref_marketplace,
  NULL AS selected_items_item_ref_item_name,
  NULL AS selected_items_item_ref_item_icon_url,
  NULL AS selected_items_supplier,
  NULL AS selected_items_po_units,
  NULL AS selected_items_estimated_cost,
  NULL AS selected_items_priority,
  NULL AS total_estimated_cost,
  NULL AS items_deferred_item_ref_inventory_id,
  NULL AS items_deferred_item_ref_sku,
  NULL AS items_deferred_item_ref_asin,
  NULL AS items_deferred_item_ref_marketplace,
  NULL AS items_deferred_item_ref_item_name,
  NULL AS items_deferred_item_ref_item_icon_url,
  NULL AS items_deferred_reason
FROM "{{catalog}}"."{{database}}"."{{table}}"
WHERE company_id IN ({{companyIdsSql}})
LIMIT {{topN}}
