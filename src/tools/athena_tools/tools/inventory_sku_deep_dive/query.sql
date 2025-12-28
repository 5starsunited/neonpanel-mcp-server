-- Tool: inventory_sku_deep_dive
-- Draft SQL scaffold. Replace NULL columns with real fields/expressions and update FROM/WHERE as needed.
-- This draft intentionally enumerates all output fields from the tool JSON (flattened).

SELECT
  company_id,
  NULL AS item_ref_inventory_id,
  NULL AS item_ref_sku,
  NULL AS item_ref_asin,
  NULL AS item_ref_marketplace,
  NULL AS item_ref_item_name,
  NULL AS item_ref_item_icon_url,
  NULL AS metrics_days_to_oos,
  NULL AS metrics_days_of_supply,
  NULL AS metrics_fba_on_hand,
  NULL AS metrics_fba_inbound,
  NULL AS metrics_network_on_hand,
  NULL AS metrics_supplier_lead_time_days,
  NULL AS metrics_safety_stock_days,
  NULL AS metrics_current_units_per_day,
  NULL AS metrics_planned_units_per_day,
  NULL AS drivers,
  NULL AS notes
FROM "{{catalog}}"."{{database}}"."{{table}}"
WHERE company_id IN ({{companyIdsSql}})
LIMIT {{topN}}
