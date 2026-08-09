-- The component plan is already aggregated at company x product. Never join it
-- back to parent assemblies and sum its shared stock fields per parent.
WITH params AS (
  SELECT
    toUInt64({{company_id}}) AS company_id,
    {{component_skus_array}} AS component_skus
)
SELECT
  c.company_id,
  c.product_id,
  c.component_sku,
  c.component_name,
  c.component_product_type,
  c.inventory_ids,
  c.has_inventory_item,
  if(c.has_inventory_item = 1, 'MEASURED', 'NO_STOCK_RECORD') AS stock_record_status,
  c.parent_product_ids,
  c.warehouse_units,
  c.fba_units,
  c.on_hand_units,
  c.in_transit_units,
  c.on_order_units,
  c.on_order_total_units,
  c.independent_actual_daily_units,
  c.dependent_actual_daily_units,
  c.total_actual_daily_units,
  c.independent_plan_units_arr,
  c.dependent_plan_units_arr,
  c.total_plan_units_arr,
  c.lead_time_days_eff,
  c.safety_stock_days_eff,
  c.cover_window_months,
  c.actual_window_units,
  c.plan_window_units,
  c.net_requirement_units_actual,
  c.net_requirement_units_plan,
  c.days_of_cover_actual
FROM etl.inventory_planning_component_plan AS c
CROSS JOIN params AS p
WHERE c.company_id = p.company_id
  AND (empty(p.component_skus) OR has(p.component_skus, c.component_sku))
  AND ('{{stock_record}}' = 'all' OR ('{{stock_record}}' = 'present' AND c.has_inventory_item = 1)
    OR ('{{stock_record}}' = 'missing' AND c.has_inventory_item = 0))
  AND if(
    '{{requirement_basis}}' = 'plan',
    c.net_requirement_units_plan,
    c.net_requirement_units_actual
  ) >= {{min_net_requirement}}
ORDER BY
  if(
    '{{requirement_basis}}' = 'plan',
    c.net_requirement_units_plan,
    c.net_requirement_units_actual
  ) DESC,
  c.component_sku ASC
LIMIT {{limit}}