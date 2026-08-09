-- BOM calculations are owned by etl.inventory_planning_bom. Do not recompute
-- cumulative lead time, shared component claims, or WIP availability here.
WITH params AS (
  SELECT
    toUInt64({{company_id}}) AS company_id,
    {{skus_array}} AS skus,
    {{inventory_ids_array}} AS inventory_ids,
    {{marketplaces_array}} AS marketplaces,
    {{planning_sources_array}} AS planning_sources
)
SELECT
  b.company_id,
  b.inventory_id,
  b.product_id,
  b.product_type,
  b.marketplace_id,
  b.company_name,
  b.sku,
  b.product_name,
  b.country_code,
  b.is_assembly,
  b.is_component,
  b.bom_depth,
  b.planning_source,
  b.actual_daily_units,
  b.plan_units_arr,
  b.warehouse_units,
  b.fba_units,
  b.in_transit_units,
  b.on_order_units,
  b.on_hand_units,
  b.buildable_from_components_units,
  b.binding_component_product_id,
  b.binding_component_sku,
  b.binding_component_name,
  b.effective_available_units,
  b.own_lead_time_days,
  b.component_max_lead_time_days,
  b.cumulative_lead_time_days,
  b.safety_stock_days_eff,
  b.days_of_cover_excl_components,
  b.days_of_cover_incl_components,
  b.net_requirement_units_actual,
  b.assembly_shortfall_units_actual,
  b.moq,
  b.box_quantity,
  b.item_cost
FROM etl.inventory_planning_bom AS b
CROSS JOIN params AS p
WHERE b.company_id = p.company_id
  AND (empty(p.skus) OR has(p.skus, b.sku))
  AND (empty(p.inventory_ids) OR has(p.inventory_ids, b.inventory_id))
  AND (empty(p.marketplaces) OR has(p.marketplaces, b.country_code))
  AND (empty(p.planning_sources) OR has(p.planning_sources, b.planning_source))
  AND (NOT {{components_only}} OR b.is_component = 1)
  AND (NOT {{apply_min_shortfall}} OR b.assembly_shortfall_units_actual >= {{min_shortfall}})
ORDER BY
  if('{{sort_by}}' = 'assembly_shortfall_units_actual', b.assembly_shortfall_units_actual, NULL) {{sort_direction}},
  if('{{sort_by}}' = 'days_of_cover_incl_components', b.days_of_cover_incl_components, NULL) {{sort_direction}},
  if('{{sort_by}}' = 'sku', b.sku, '') {{sort_direction}},
  b.inventory_id ASC
LIMIT {{limit}}