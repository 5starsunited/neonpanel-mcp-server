-- Tool: supply_chain_list_fulfillment_warehouses
-- Source: ClickHouse etl.fulfillment_warehouses (migrations 0088 + 0089). Warehouses with
-- invoice stock outflows or outbound transfers, with 30/90-day volume, sales channels,
-- transfer routes and lead-time history. Planned (is_fulfillment) only with invoice sales.

SELECT
  toUInt64(fw.company_id) AS company_id,
  fw.Company AS company_name,
  toUInt64(fw.warehouse_id) AS warehouse_id,
  fw.warehouse_uuid AS warehouse_uuid,
  fw.warehouse_name AS warehouse_name,
  fw.warehouse_type AS warehouse_type,
  toUInt8(fw.is_planning_eligible_type) AS is_planning_eligible_type,
  toUInt8(fw.is_fulfillment) AS is_fulfillment,
  toString(fw.first_sale_date) AS first_sale_date,
  toString(fw.last_sale_date) AS last_sale_date,
  toFloat64(fw.units_sold_30d) AS units_sold_30d,
  toFloat64(fw.units_sold_90d) AS units_sold_90d,
  toUInt64(fw.item_invoice_lines_90d) AS item_invoice_lines_90d,
  toUInt64(fw.items_sold_90d) AS items_sold_90d,
  fw.sales_channels_90d AS sales_channels_90d,
  toUInt64(coalesce(fw.lead_time_events_365d, 0)) AS lead_time_events_365d,
  fw.median_lead_time_days AS median_lead_time_days,
  fw.p80_lead_time_days AS p80_lead_time_days,
  fw.default_lead_time_days AS default_lead_time_days,
  fw.default_safety_stock_days AS default_safety_stock_days,
  fw.default_replenishment_frequency_days AS default_replenishment_frequency_days,
  fw.warehouse_role AS warehouse_role,
  toFloat64(fw.units_transferred_30d) AS units_transferred_30d,
  toFloat64(fw.units_transferred_90d) AS units_transferred_90d,
  toUInt64(fw.items_transferred_90d) AS items_transferred_90d,
  fw.transfer_routes_90d AS transfer_routes_90d,
  if(fw.last_transfer_date IS NULL, NULL, toString(fw.last_transfer_date)) AS last_transfer_date,
  toFloat64(fw.units_out_90d) AS units_out_90d
FROM etl.fulfillment_warehouses AS fw
WHERE toUInt64(fw.company_id) = toUInt64({{company_id}})
  AND ({{include_non_eligible_sql}} OR fw.is_fulfillment = 1)
ORDER BY is_fulfillment DESC, units_out_90d DESC, warehouse_id ASC
LIMIT {{limit_top_n}}
