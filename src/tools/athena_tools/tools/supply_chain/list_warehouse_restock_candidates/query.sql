-- Tool: supply_chain_list_warehouse_restock_candidates
-- Source: ClickHouse etl.inventory_planning_warehouse (migration 0088), grain
-- company x fulfillment warehouse x top-level inventory item.
-- The view already carries outputs for the default parameters. This query recomputes
-- rate, days of supply, ship due date, replenishment need, recommended quantities and
-- priority from the view's raw columns so the caller's parameters take effect.

WITH params AS (
  SELECT
    {{sales_velocity_sql}} AS sales_velocity,
    toFloat64({{weight_30d}}) AS weight_30d,
    toFloat64({{weight_7d}}) AS weight_7d,
    toFloat64({{weight_3d}}) AS weight_3d,
    {{lead_time_override_enabled_sql}} AS lead_time_override_enabled,
    toFloat64({{lead_time_days_override}}) AS lead_time_days_override,
    {{safety_stock_override_enabled_sql}} AS safety_stock_override_enabled,
    toFloat64({{safety_stock_days_override}}) AS safety_stock_days_override,
    toFloat64({{days_between_shipments}}) AS days_between_shipments,
    toInt64({{stockout_threshold_days}}) AS stockout_threshold_days,
    {{planning_base_sql}} AS planning_base,
    {{include_components_sql}} AS include_components,
    toUInt64({{company_id}}) AS company_id,
    {{warehouse_ids_array}} AS warehouse_ids,
    {{sales_channels_array}} AS sales_channels,
    {{revenue_abcd_classes_array}} AS revenue_abcd_classes,
    {{brands_array}} AS brands,
    {{product_families_array}} AS product_families,
    {{skus_array}} AS skus,
    {{inventory_ids_array}} AS inventory_ids
),
filtered AS (
  SELECT v.*
  FROM etl.inventory_planning_warehouse AS v
  CROSS JOIN params AS p
  WHERE toUInt64(v.company_id) = p.company_id
    AND (empty(p.warehouse_ids) OR has(p.warehouse_ids, toUInt64(v.warehouse_id)))
    AND (empty(p.inventory_ids) OR has(p.inventory_ids, toUInt64(v.inventory_id)))
    AND (empty(p.skus) OR has(p.skus, coalesce(v.sku, '')))
    AND (empty(p.brands) OR has(p.brands, coalesce(v.brand, '')))
    AND (empty(p.product_families) OR has(p.product_families, coalesce(v.product_family, '')))
    AND (empty(p.revenue_abcd_classes) OR has(p.revenue_abcd_classes, v.revenue_abcd_class))
    AND (p.include_components OR v.planning_source != 'COMPONENT')
    -- Channel filter: keep rows whose 30-day channel mix contains any requested channel
    -- (case-insensitive match on the JSON keys).
    AND (
      empty(p.sales_channels)
      OR arrayExists(
        channel_name -> has(p.sales_channels, lower(trim(channel_name))),
        JSONExtractKeys(coalesce(v.channel_units_30d_json, '{}'))
      )
    )
),
rated AS (
  SELECT
    f.*,
    p.sales_velocity AS sales_velocity_mode,
    -- Base (own) daily rate by velocity mode. 'current' re-blends the realized averages
    -- with the caller's weights, normalized by their sum like the view.
    ifNotFinite(coalesce(toFloat64(multiIf(
      p.sales_velocity = 'planned', f.planned_daily_rate,
      p.sales_velocity = 'target', f.target_daily_rate,
      -- No invoices in 30 days (monthly or B2B invoicing): fall back to the 90-day average.
      f.units_30d <= 0, f.units_90d / 90,
      (p.weight_30d * f.avg_units_30d + p.weight_7d * f.avg_units_7d + p.weight_3d * f.avg_units_3d)
        / nullIf(p.weight_30d + p.weight_7d + p.weight_3d, 0)
    )), 0.0), 0.0) AS base_daily_rate,
    toFloat64(coalesce(f.dependent_daily_units, 0)) AS dependent_rate,
    if(p.lead_time_override_enabled, p.lead_time_days_override, toFloat64(f.lead_time_days)) AS lt_days,
    if(p.lead_time_override_enabled, 'override', f.lead_time_days_source) AS lt_source,
    if(p.safety_stock_override_enabled, p.safety_stock_days_override, toFloat64(f.safety_stock_days)) AS ss_days,
    if(p.safety_stock_override_enabled, 'override', f.safety_stock_days_source) AS ss_source,
    p.days_between_shipments AS cadence_days,
    toFloat64(coalesce(f.effective_available_units, 0)) AS eff_available
  FROM filtered AS f
  CROSS JOIN params AS p
),
derived AS (
  SELECT
    r.*,
    r.base_daily_rate + r.dependent_rate AS rate,
    -- v1: flat safety stock, ss_multiplier is informational only (Amazon ABCD class).
    r.ss_days AS ss_eff
  FROM rated AS r
),
outputs AS (
  SELECT
    d.*,
    if(d.rate > 0, d.eff_available / d.rate, 99999.0) AS dos,
    if(d.rate > 0, toInt64(floor(d.eff_available / d.rate - d.ss_eff - d.lt_days)), NULL) AS due_in,
    greatest(d.rate * (d.lt_days + d.ss_eff + d.cadence_days) - d.eff_available, 0.0) AS need_units
  FROM derived AS d
),
final AS (
  SELECT
    o.*,
    toInt64(if(o.assembles_at_wh = 1, 0,
      if(toFloat64(o.box_quantity) > 0,
        ceil(o.need_units / toFloat64(o.box_quantity)) * toFloat64(o.box_quantity),
        ceil(o.need_units)))) AS rec_ship_qty,
    toInt64(if(o.assembles_at_wh = 1, ceil(o.need_units), 0)) AS rec_assembly_units,
    multiIf(
      o.rate <= 0, 'no_demand',
      o.due_in <= 0, 'critical',
      o.due_in <= p.stockout_threshold_days, 'high',
      toFloat64(o.due_in) <= o.cadence_days, 'normal',
      'ok'
    ) AS priority_level
  FROM outputs AS o
  CROSS JOIN params AS p
)
SELECT
  toUInt64(t.company_id) AS company_id,
  t.Company AS company_name,
  toUInt64(t.warehouse_id) AS warehouse_id,
  t.warehouse_uuid AS warehouse_uuid,
  t.warehouse_name AS warehouse_name,
  t.warehouse_type AS warehouse_type,
  toUInt64(t.inventory_id) AS inventory_id,
  toUInt64(t.product_id) AS product_id,
  t.sku AS sku,
  t.product_name AS product_name,
  t.brand AS brand,
  t.product_family AS product_family,
  t.vendor AS vendor,
  t.child_asin AS child_asin,
  t.image_url AS image_url,
  t.revenue_abcd_class AS revenue_abcd_class,
  toFloat64(t.ss_multiplier) AS ss_multiplier,
  t.planning_source AS planning_source,
  toUInt8(t.assembles_at_wh) AS assembles_at_wh,
  toUInt8(t.is_component_at_wh) AS is_component_at_wh,
  t.parent_product_ids AS parent_product_ids,
  toFloat64(t.buildable_at_wh_units) AS buildable_at_wh_units,
  toUInt64(t.binding_component_product_id) AS binding_component_product_id,
  toFloat64(t.on_hand_units) AS on_hand_units,
  toFloat64(t.in_transit_units) AS in_transit_units,
  toFloat64(t.open_po_units) AS open_po_units,
  toFloat64(t.available_units) AS available_units,
  t.eff_available AS effective_available_units,
  toFloat64(t.units_3d) AS units_3d,
  toFloat64(t.units_7d) AS units_7d,
  toFloat64(t.units_30d) AS units_30d,
  toFloat64(t.units_90d) AS units_90d,
  toFloat64(t.avg_units_30d) AS avg_units_30d,
  toFloat64(t.avg_units_7d) AS avg_units_7d,
  toFloat64(t.avg_units_3d) AS avg_units_3d,
  t.channel_units_30d_json AS channel_units_30d_json,
  toFloat64(t.actual_daily_rate) AS actual_daily_rate,
  toFloat64(t.blended_daily_rate) AS blended_daily_rate,
  t.velocity_basis AS velocity_basis,
  toFloat64(t.planned_daily_rate) AS planned_daily_rate,
  toFloat64(t.planned_units_arrival_month) AS planned_units_arrival_month,
  toFloat64(t.target_daily_rate) AS target_daily_rate,
  t.dependent_rate AS dependent_daily_units,
  t.base_daily_rate AS base_daily_rate,
  t.rate AS daily_sales_rate,
  t.sales_velocity_mode AS sales_velocity_mode,
  t.lt_days AS lead_time_days,
  t.lt_source AS lead_time_days_source,
  toUInt64(t.lead_time_item_events) AS lead_time_item_events,
  toUInt64(t.lead_time_warehouse_events) AS lead_time_warehouse_events,
  t.lead_time_item_p80_days AS lead_time_item_p80_days,
  t.ss_days AS safety_stock_days,
  t.ss_source AS safety_stock_days_source,
  t.ss_eff AS safety_stock_days_eff,
  t.cadence_days AS replenishment_frequency_days,
  toFloat64(t.box_quantity) AS box_quantity,
  round(t.dos, 1) AS days_of_supply,
  t.due_in AS ship_due_in_days,
  if(t.due_in IS NULL, NULL, toString(today() + toIntervalDay(greatest(t.due_in, 0)))) AS ship_due_date,
  greatest(coalesce(-t.due_in, 0), 0) AS days_overdue,
  round(t.need_units, 2) AS replenishment_need_units,
  t.rec_ship_qty AS recommended_ship_qty,
  t.rec_assembly_units AS recommended_assembly_units,
  t.priority_level AS priority,
  toUInt64(t.typical_origin_warehouse_id) AS typical_origin_warehouse_id,
  t.typical_origin_warehouse_name AS typical_origin_warehouse_name,
  toFloat64(t.origin_on_hand_units) AS origin_on_hand_units
FROM final AS t
CROSS JOIN params AS p
WHERE p.planning_base = 'all'
  OR (p.planning_base = 'actively_sold_only' AND (t.units_30d > 0 OR t.dependent_rate > 0))
  OR (p.planning_base = 'needs_replenishment' AND (t.rec_ship_qty > 0 OR t.rec_assembly_units > 0))
ORDER BY
  multiIf(t.priority_level = 'critical', 0, t.priority_level = 'high', 1, t.priority_level = 'normal', 2,
    t.priority_level = 'ok', 3, 4) ASC,
  t.due_in ASC NULLS LAST,
  t.rec_ship_qty + t.rec_assembly_units DESC,
  t.warehouse_id ASC,
  t.inventory_id ASC
LIMIT {{limit_top_n}}
