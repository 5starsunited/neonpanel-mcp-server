-- Tool: supply_chain_list_fba_replenishment_candidates
-- Sources: ClickHouse etl.sales_forecast and etl.inventory_planning_snapshot.

WITH params AS (
  SELECT
    {{sales_velocity_sql}} AS sales_velocity,
    {{planning_base_sql}} AS planning_base,
    {{override_default_sql}} AS override_default,
    {{use_seasonality_sql}} AS use_seasonality,
    {{fba_lead_time_days_override}} AS fba_lead_time_days_override,
    {{fba_safety_stock_days_override}} AS fba_safety_stock_days_override,
    {{days_between_shipments}} AS days_between_shipments,
    toFloat64({{active_sold_min_units_per_day}}) AS active_sold_min_units_per_day,
    toFloat64({{weight_30d}}) AS weight_30d,
    toFloat64({{weight_7d}}) AS weight_7d,
    toFloat64({{weight_3d}}) AS weight_3d,
    {{company_ids_array}} AS company_ids,
    {{skus_array}} AS skus,
    {{inventory_ids_array}} AS inventory_ids,
    {{asins_array}} AS asins,
    {{parent_asins_array}} AS parent_asins,
    {{brands_array}} AS brands,
    {{product_families_array}} AS product_families,
    {{countries_array}} AS countries,
    {{revenue_abcd_classes_array}} AS revenue_abcd_classes
),
latest_snapshot AS (
  SELECT pil.year AS year, pil.month AS month, pil.day AS day
  FROM etl.inventory_planning_snapshot AS pil
  CROSS JOIN params AS p
  WHERE has(p.company_ids, toUInt64(pil.company_id))
  GROUP BY pil.year, pil.month, pil.day
  ORDER BY toInt32(pil.year) DESC, toInt32(pil.month) DESC, toInt32(pil.day) DESC
  LIMIT 1
),
forecast_run_candidates AS (
  SELECT
    f.company_id AS company_id,
    f.inventory_id AS inventory_id,
    f.scenario_uuid AS scenario_uuid,
    f.calc_period AS calc_period,
    max(f.updated_at) AS run_updated_at
  FROM etl.sales_forecast AS f
  CROSS JOIN params AS p
  WHERE has(p.company_ids, f.company_id) AND f.dataset != 'actual'
  GROUP BY f.company_id, f.inventory_id, f.scenario_uuid, f.calc_period
),
forecast_selected_run AS (
  SELECT
    runs.company_id AS company_id,
    runs.inventory_id AS inventory_id,
    runs.scenario_uuid AS scenario_uuid,
    runs.calc_period AS calc_period
  FROM forecast_run_candidates AS runs
  QUALIFY row_number() OVER (
    PARTITION BY runs.company_id, runs.inventory_id
    ORDER BY runs.calc_period DESC, runs.run_updated_at DESC
  ) = 1
),
forecast_latest_rows AS (
  SELECT
    f.company_id AS company_id,
    f.inventory_id AS inventory_id,
    f.forecast_period AS forecast_period,
    coalesce(toFloat64(f.units_sold), 0.0) AS units_sold
  FROM etl.sales_forecast AS f
  INNER JOIN forecast_selected_run AS selected
    ON selected.company_id = f.company_id
    AND selected.inventory_id = f.inventory_id
    AND selected.scenario_uuid = f.scenario_uuid
    AND selected.calc_period = f.calc_period
  WHERE f.dataset != 'actual'
  QUALIFY row_number() OVER (
    PARTITION BY f.company_id, f.inventory_id, f.forecast_period,
      coalesce(f.amazon_marketplace_id, ''), coalesce(f.sales_channel, ''), coalesce(f.country_code, '')
    ORDER BY f.updated_at DESC
  ) = 1
),
forecast_item_periods AS (
  SELECT
    rows.company_id AS company_id,
    rows.inventory_id AS inventory_id,
    rows.forecast_period AS forecast_period,
    sum(rows.units_sold) AS units_sold
  FROM forecast_latest_rows AS rows
  GROUP BY rows.company_id, rows.inventory_id, rows.forecast_period
),
forecast_item_plan AS (
  SELECT
    periods.company_id AS company_id,
    periods.inventory_id AS inventory_id,
    arraySlice(
      arrayMap(entry -> entry.2, arraySort(entry -> entry.1, groupArray((toString(periods.forecast_period), periods.units_sold)))),
      1,
      12
    ) AS plan_monthly_units
  FROM forecast_item_periods AS periods
  GROUP BY periods.company_id, periods.inventory_id
),
snapshot_rows AS (
  SELECT
    toUInt64(pil.company_id) AS company_id,
    toUInt64(pil.inventory_id) AS inventory_id,
    pil.sku AS sku,
    pil.country AS country,
    pil.country_code AS country_code,
    pil.child_asin AS child_asin,
    pil.parent_asin AS parent_asin,
    pil.brand AS brand,
    pil.product_family AS product_family,
    pil.asin_img_path AS asin_img_path,
    pil.product_name AS product_name,
    pil.recommended_replenishment_qty AS recommended_by_amazon_replenishment_quantity,
    coalesce(pil.fba_shipments_json, '[]') AS fba_shipments_json,
    coalesce(toFloat64(pil.sales_last_30_days), 0.0) AS revenue_30d,
    coalesce(toFloat64(pil.daily_unit_sales_target), 0.0) AS target_units_per_day,
    coalesce(toFloat64(pil.avg_units_30d), 0.0) AS avg_units_30d,
    coalesce(toFloat64(pil.avg_units_7d), 0.0) AS avg_units_7d,
    coalesce(toFloat64(pil.avg_units_3d), 0.0) AS avg_units_3d,
    coalesce(toFloat64(pil.units_sold_last_30_days), 0.0) AS units_sold_last_30_days,
    coalesce(toFloat64(pil.inbound), 0.0) + coalesce(toFloat64(pil.available), 0.0)
      + coalesce(toFloat64(pil.fc_transfer), 0.0) + coalesce(toFloat64(pil.fc_processing), 0.0)
      AS total_fba_available_units,
    pil.fba_lead_time_days AS item_fba_lead_time_days,
    pil.fba_safety_stock_days AS item_fba_safety_stock_days
  FROM etl.inventory_planning_snapshot AS pil
  CROSS JOIN params AS p
  CROSS JOIN latest_snapshot AS snapshot
  WHERE has(p.company_ids, toUInt64(pil.company_id))
    AND pil.year = snapshot.year AND pil.month = snapshot.month AND pil.day = snapshot.day
    AND (empty(p.skus) OR has(p.skus, pil.sku))
    AND (empty(p.inventory_ids) OR has(p.inventory_ids, toUInt64(pil.inventory_id)))
    AND (empty(p.asins) OR has(p.asins, pil.child_asin))
    AND (empty(p.parent_asins) OR has(p.parent_asins, pil.parent_asin))
    AND (empty(p.brands) OR has(p.brands, pil.brand))
    AND (empty(p.product_families) OR has(p.product_families, pil.product_family))
    AND (empty(p.countries) OR has(p.countries, pil.country) OR has(p.countries, pil.country_code))
),
t_base AS (
  SELECT
    snapshot.company_id AS company_id,
    snapshot.inventory_id AS inventory_id,
    snapshot.* EXCEPT (company_id, inventory_id),
    p.sales_velocity AS selected_sales_velocity,
    p.weight_30d * snapshot.avg_units_30d
      + p.weight_7d * snapshot.avg_units_7d
      + p.weight_3d * snapshot.avg_units_3d AS current_units_per_day,
    coalesce(plan.plan_monthly_units, CAST([], 'Array(Float64)')) AS plan_monthly_units,
    if(p.override_default, p.fba_lead_time_days_override, snapshot.item_fba_lead_time_days)
      AS fba_lead_time_days,
    if(p.override_default, p.fba_safety_stock_days_override, snapshot.item_fba_safety_stock_days)
      AS fba_safety_stock_days,
    if(
      p.override_default,
      p.fba_lead_time_days_override + p.fba_safety_stock_days_override + p.days_between_shipments,
      snapshot.item_fba_lead_time_days + snapshot.item_fba_safety_stock_days + p.days_between_shipments
    ) AS target_coverage_days
  FROM snapshot_rows AS snapshot
  CROSS JOIN params AS p
  LEFT JOIN forecast_item_plan AS plan
    ON plan.company_id = snapshot.company_id AND plan.inventory_id = snapshot.inventory_id
  WHERE
    p.planning_base = 'all'
    OR (p.planning_base = 'targeted only' AND snapshot.target_units_per_day > 0)
    OR (p.planning_base = 'actively sold only'
      AND coalesce(snapshot.avg_units_30d, snapshot.units_sold_last_30_days / 30.0, 0.0)
        >= p.active_sold_min_units_per_day)
    OR (p.planning_base = 'planned only' AND plan.plan_monthly_units IS NOT NULL)
),
t_plan AS (
  SELECT
    base.*,
    least(
      greatest(toInt64(1), toInt64(1) + toInt64(floor(toFloat64(base.fba_lead_time_days) / 30.0))),
      greatest(toInt64(1), toInt64(length(base.plan_monthly_units)))
    ) AS planned_arrival_month_index
  FROM t_base AS base
),
t_window AS (
  SELECT
    plan.*,
    greatest(
      toInt64(1),
      least(
        toInt64(round(toFloat64(plan.fba_lead_time_days + plan.fba_safety_stock_days) / 30.41)),
        toInt64(length(plan.plan_monthly_units)) - plan.planned_arrival_month_index + toInt64(1)
      )
    ) AS planned_window_months
  FROM t_plan AS plan
),
t_velocity AS (
  SELECT
    windowed.company_id AS company_id,
    windowed.inventory_id AS inventory_id,
    windowed.sku AS sku,
    windowed.country_code AS country_code,
    windowed.child_asin AS child_asin,
    windowed.parent_asin AS parent_asin,
    windowed.brand AS brand,
    windowed.product_family AS product_family,
    windowed.asin_img_path AS asin_img_path,
    windowed.product_name AS product_name,
    windowed.recommended_by_amazon_replenishment_quantity AS recommended_by_amazon_replenishment_quantity,
    windowed.fba_shipments_json AS fba_shipments_json,
    windowed.revenue_30d AS revenue_30d,
    windowed.target_units_per_day AS target_units_per_day,
    windowed.current_units_per_day AS current_units_per_day,
    windowed.plan_monthly_units AS plan_monthly_units,
    ifNotFinite(toFloat64(windowed.total_fba_available_units), 0.0) AS total_fba_available_units,
    windowed.target_coverage_days AS target_coverage_days,
    windowed.selected_sales_velocity AS selected_sales_velocity,
    windowed.planned_arrival_month_index AS planned_arrival_month_index,
    windowed.planned_window_months AS planned_window_months,
    ifNotFinite(toFloat64(CASE windowed.selected_sales_velocity
      WHEN 'target' THEN windowed.target_units_per_day
      WHEN 'current' THEN windowed.current_units_per_day
      WHEN 'planned' THEN arraySum(arraySlice(
        windowed.plan_monthly_units,
        windowed.planned_arrival_month_index,
        windowed.planned_window_months
      )) / (windowed.planned_window_months * 30.41)
      ELSE windowed.current_units_per_day
    END), 0.0) AS sales_velocity
  FROM t_window AS windowed
),
t_classed AS (
  SELECT
    velocity.*,
    CASE
      WHEN sum(velocity.revenue_30d) OVER (PARTITION BY velocity.company_id, velocity.country_code) <= 0 THEN 'D'
      WHEN sum(velocity.revenue_30d) OVER (
        PARTITION BY velocity.company_id, velocity.country_code ORDER BY velocity.revenue_30d DESC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) / nullIf(sum(velocity.revenue_30d) OVER (PARTITION BY velocity.company_id, velocity.country_code), 0) <= 0.80 THEN 'A'
      WHEN sum(velocity.revenue_30d) OVER (
        PARTITION BY velocity.company_id, velocity.country_code ORDER BY velocity.revenue_30d DESC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) / nullIf(sum(velocity.revenue_30d) OVER (PARTITION BY velocity.company_id, velocity.country_code), 0) <= 0.95 THEN 'B'
      WHEN sum(velocity.revenue_30d) OVER (
        PARTITION BY velocity.company_id, velocity.country_code ORDER BY velocity.revenue_30d DESC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) / nullIf(sum(velocity.revenue_30d) OVER (PARTITION BY velocity.company_id, velocity.country_code), 0) <= 0.99 THEN 'C'
      ELSE 'D'
    END AS revenue_abcd_class,
    CASE
      WHEN sum(velocity.revenue_30d) OVER (PARTITION BY velocity.company_id, velocity.country_code) <= 0 THEN 'C'
      WHEN sum(velocity.revenue_30d) OVER (
        PARTITION BY velocity.company_id, velocity.country_code ORDER BY velocity.revenue_30d DESC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) / nullIf(sum(velocity.revenue_30d) OVER (PARTITION BY velocity.company_id, velocity.country_code), 0) <= 0.80 THEN 'A'
      WHEN sum(velocity.revenue_30d) OVER (
        PARTITION BY velocity.company_id, velocity.country_code ORDER BY velocity.revenue_30d DESC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) / nullIf(sum(velocity.revenue_30d) OVER (PARTITION BY velocity.company_id, velocity.country_code), 0) <= 0.95 THEN 'B'
      ELSE 'C'
    END AS pareto_abc_class
  FROM t_velocity AS velocity
)
SELECT
  t.company_id AS company_id,
  t.revenue_abcd_class AS revenue_abcd_class,
  CASE t.revenue_abcd_class
    WHEN 'A' THEN 'Top 80% of 30d revenue (cumulative)'
    WHEN 'B' THEN 'Next 15% of 30d revenue (80%-95% cumulative)'
    WHEN 'C' THEN 'Next 4% of 30d revenue (95%-99% cumulative)'
    ELSE 'Remaining / no revenue (bottom 1%+ or zero)'
  END AS revenue_abcd_class_description,
  t.pareto_abc_class AS pareto_abc_class,
  t.child_asin AS child_asin,
  t.parent_asin AS parent_asin,
  t.brand AS brand,
  t.product_family AS product_family,
  t.fba_shipments_json AS fba_shipments_json,
  t.inventory_id AS item_ref_inventory_id,
  t.sku AS item_ref_sku,
  t.child_asin AS item_ref_asin,
  t.country_code AS item_ref_marketplace,
  t.product_name AS item_ref_item_name,
  t.asin_img_path AS item_ref_item_icon_url,
  t.sales_velocity AS sales_velocity,
  if(t.sales_velocity > 0, toInt64OrNull(toString(round(
    t.total_fba_available_units / nullIf(t.sales_velocity, 0.0)))), NULL)
    AS fba_days_of_supply,
  if(t.sales_velocity > 0, toInt64OrNull(toString(round(
    t.total_fba_available_units / nullIf(t.sales_velocity, 0.0))))
    - toInt64(t.target_coverage_days), NULL) AS shipment_due_in_days,
  if(t.sales_velocity > 0, greatest(toInt64(0), -(toInt64OrNull(toString(round(
    t.total_fba_available_units / nullIf(t.sales_velocity, 0.0))))
    - toInt64(t.target_coverage_days))), NULL) AS shipment_overdue_days,
  if(t.sales_velocity > 0, greatest(toInt64(0), -(toInt64OrNull(toString(round(
    t.total_fba_available_units / nullIf(t.sales_velocity, 0.0))))
    - toInt64(t.target_coverage_days))), NULL) AS days_overdue,
  if(t.sales_velocity > 0, addDays(today(), greatest(toInt64(0),
    toInt64OrNull(toString(round(t.total_fba_available_units / nullIf(t.sales_velocity, 0.0))))
      - toInt64(t.target_coverage_days))), NULL)
    AS shipment_due_date,
  toInt64(t.total_fba_available_units) AS fba_on_hand,
  CAST(NULL, 'Nullable(Int64)') AS fba_inbound,
  if(t.sales_velocity > 0, greatest(toInt64(0), toInt64(ceil(
    toFloat64(t.target_coverage_days) * t.sales_velocity - t.total_fba_available_units))), toInt64(0))
    AS recommended_ship_units,
  toInt64(t.recommended_by_amazon_replenishment_quantity)
    AS recommended_by_amazon_replenishment_quantity,
  CASE
    WHEN t.sales_velocity <= 0 THEN 'low'
    WHEN toInt64OrNull(toString(round(t.total_fba_available_units / nullIf(t.sales_velocity, 0.0))))
      - toInt64(t.target_coverage_days) <= toInt64({{stockout_threshold_days}}) THEN 'critical'
    ELSE 'high'
  END AS priority,
  'Based on buffer coverage: days_of_supply vs lead time, safety stock, and shipment cadence.' AS reason
FROM t_classed AS t
CROSS JOIN params AS p
WHERE empty(p.revenue_abcd_classes) OR has(p.revenue_abcd_classes, t.revenue_abcd_class)
ORDER BY shipment_overdue_days DESC
LIMIT {{limit_top_n}}
