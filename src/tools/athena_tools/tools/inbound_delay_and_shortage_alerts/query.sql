-- Tool: inbound_delay_and_shortage_alerts
-- Draft SQL scaffold. Replace NULL columns with real fields/expressions and update FROM/WHERE as needed.
-- This draft intentionally enumerates all output fields from the tool JSON (flattened).

SELECT
  company_id,
  NULL AS alerts_item_ref_inventory_id,
  NULL AS alerts_item_ref_sku,
  NULL AS alerts_item_ref_asin,
  NULL AS alerts_item_ref_marketplace,
  NULL AS alerts_item_ref_item_name,
  NULL AS alerts_item_ref_item_icon_url,
  NULL AS alerts_shipment_id,
  NULL AS alerts_expected_date,
  NULL AS alerts_current_eta,
  NULL AS alerts_delay_days,
  NULL AS alerts_expected_units,
  NULL AS alerts_received_units,
  NULL AS alerts_shortage_pct,
  NULL AS alerts_severity,
  NULL AS alerts_note
FROM "{{catalog}}"."{{database}}"."{{table}}"
WHERE company_id IN ({{companyIdsSql}})
LIMIT {{limit}}
