-- Tool: supply_chain_list_po_placement_candidates
-- Sources: ClickHouse etl.sales_forecast and etl.inventory_planning_snapshot.

WITH params AS (
  SELECT
    {{sales_velocity_sql}} AS sales_velocity,
    {{planning_base_sql}} AS planning_base,
    {{override_default_sql}} AS override_default,
    {{use_seasonality_sql}} AS use_seasonality,
    {{lead_time_days_override}} AS lead_time_days_override,
    {{safety_stock_days_override}} AS safety_stock_days_override,
    {{days_between_pos}} AS days_between_pos,
    toFloat64({{active_sold_min_units_per_day}}) AS active_sold_min_units_per_day,
    {{include_work_in_progress}} AS include_work_in_progress,
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
    coalesce(toFloat64(pil.sales_last_30_days), 0.0) AS revenue_30d,
    pil.moq AS moq,
    coalesce(toFloat64(pil.daily_unit_sales_target), 0.0) AS target_units_per_day,
    coalesce(toFloat64(pil.avg_units_30d), coalesce(toFloat64(pil.units_sold_last_30_days), 0.0) / 30.0, 0.0)
      AS current_units_per_day,
    coalesce(toFloat64(pil.total_balance_quantity), 0.0) + coalesce(toFloat64(pil.available), 0.0)
      + if(p.include_work_in_progress, coalesce(toFloat64(pil.wip_total_ordered_quantity), 0.0), 0.0)
      AS total_available_inventory_units,
    pil.lead_time_days AS item_lead_time_days,
    pil.safety_stock_days AS item_safety_stock_days,
    coalesce(toFloat64(pil.ss_multiplier), 1.0) AS ss_multiplier
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
    coalesce(plan.plan_monthly_units, CAST([], 'Array(Float64)')) AS plan_monthly_units,
    if(p.override_default, toFloat64(p.lead_time_days_override),
  toFloat64(coalesce(nullIf(snapshot.item_lead_time_days, 0), 90))) AS lead_time_days,
    if(p.override_default, 'override',
      if(snapshot.item_lead_time_days IS NULL OR snapshot.item_lead_time_days = 0, 'default_90', 'item'))
      AS lead_time_days_source,
    if(p.override_default, toFloat64(p.safety_stock_days_override),
      toFloat64(coalesce(nullIf(snapshot.item_safety_stock_days, 0), 60)) * snapshot.ss_multiplier)
      AS safety_stock_days,
    if(p.override_default, 'override',
      if(snapshot.item_safety_stock_days IS NULL OR snapshot.item_safety_stock_days = 0, 'default_60', 'item'))
      AS safety_stock_days_source,
    if(
      p.override_default,
      p.lead_time_days_override + p.safety_stock_days_override + p.days_between_pos,
      coalesce(nullIf(snapshot.item_lead_time_days, 0), 90)
        + coalesce(nullIf(snapshot.item_safety_stock_days, 0), 60) * snapshot.ss_multiplier
        + p.days_between_pos
    ) AS target_coverage_days
  FROM snapshot_rows AS snapshot
  CROSS JOIN params AS p
  LEFT JOIN forecast_item_plan AS plan
    ON plan.company_id = snapshot.company_id AND plan.inventory_id = snapshot.inventory_id
  WHERE
    p.planning_base = 'all'
    OR (p.planning_base = 'targeted only' AND snapshot.target_units_per_day > 0)
    OR (p.planning_base = 'actively sold only'
      AND snapshot.current_units_per_day >= p.active_sold_min_units_per_day)
    OR (p.planning_base = 'planned only' AND plan.plan_monthly_units IS NOT NULL)
),
t_plan AS (
  SELECT
    base.*,
    least(
      greatest(toInt64(1), toInt64(1) + toInt64(floor(base.lead_time_days / 30.0))),
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
        toInt64(round((plan.lead_time_days + plan.safety_stock_days) / 30.41)),
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
    windowed.revenue_30d AS revenue_30d,
    windowed.moq AS moq,
    windowed.target_units_per_day AS target_units_per_day,
    windowed.current_units_per_day AS current_units_per_day,
    windowed.plan_monthly_units AS plan_monthly_units,
    ifNotFinite(toFloat64(windowed.total_available_inventory_units), 0.0)
      AS total_available_inventory_units,
    windowed.lead_time_days AS lead_time_days,
    windowed.lead_time_days_source AS lead_time_days_source,
    windowed.safety_stock_days AS safety_stock_days,
    windowed.safety_stock_days_source AS safety_stock_days_source,
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
    END), 0.0) AS sales_velocity,
    windowed.selected_sales_velocity AS velocity_calculation_method,
    if(windowed.selected_sales_velocity = 'planned',
      CAST(windowed.planned_arrival_month_index, 'Nullable(Int64)'), NULL) AS forecast_month_index,
    if(windowed.selected_sales_velocity = 'planned',
      CAST(arraySum(arraySlice(windowed.plan_monthly_units, windowed.planned_arrival_month_index,
        windowed.planned_window_months)), 'Nullable(Float64)'), NULL) AS forecast_units_extracted
  FROM t_window AS windowed
),
t_classed AS (
  SELECT
    velocity.*,
    CASE
      WHEN sum(revenue_30d) OVER (PARTITION BY company_id, country_code) <= 0 THEN 'D'
      WHEN sum(revenue_30d) OVER (
        PARTITION BY company_id, country_code ORDER BY revenue_30d DESC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) / nullIf(sum(revenue_30d) OVER (PARTITION BY company_id, country_code), 0) <= 0.80 THEN 'A'
      WHEN sum(revenue_30d) OVER (
        PARTITION BY company_id, country_code ORDER BY revenue_30d DESC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) / nullIf(sum(revenue_30d) OVER (PARTITION BY company_id, country_code), 0) <= 0.95 THEN 'B'
      WHEN sum(revenue_30d) OVER (
        PARTITION BY company_id, country_code ORDER BY revenue_30d DESC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) / nullIf(sum(revenue_30d) OVER (PARTITION BY company_id, country_code), 0) <= 0.99 THEN 'C'
      ELSE 'D'
    END AS revenue_abcd_class,
    CASE
      WHEN sum(revenue_30d) OVER (PARTITION BY company_id, country_code) <= 0 THEN 'C'
      WHEN sum(revenue_30d) OVER (
        PARTITION BY company_id, country_code ORDER BY revenue_30d DESC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) / nullIf(sum(revenue_30d) OVER (PARTITION BY company_id, country_code), 0) <= 0.80 THEN 'A'
      WHEN sum(revenue_30d) OVER (
        PARTITION BY company_id, country_code ORDER BY revenue_30d DESC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) / nullIf(sum(revenue_30d) OVER (PARTITION BY company_id, country_code), 0) <= 0.95 THEN 'B'
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
  t.inventory_id AS item_ref_inventory_id,
  t.sku AS item_ref_sku,
  t.child_asin AS item_ref_asin,
  t.country_code AS item_ref_marketplace,
  t.product_name AS item_ref_item_name,
  t.asin_img_path AS item_ref_item_icon_url,
  t.sales_velocity AS sales_velocity,
  if(t.sales_velocity > 0, toInt64OrNull(toString(round(
    t.total_available_inventory_units / nullIf(t.sales_velocity, 0.0)))), NULL)
    AS po_days_of_supply,
  toInt64(round(t.total_available_inventory_units)) AS available_inventory_units,
  toInt64(t.lead_time_days) AS lead_time_days,
  toString(t.lead_time_days_source) AS lead_time_days_source,
  toInt64(t.safety_stock_days) AS safety_stock_days,
  toString(t.safety_stock_days_source) AS safety_stock_days_source,
  toInt64(t.target_coverage_days) AS target_coverage_days,
  toString(t.velocity_calculation_method) AS velocity_calculation_method,
  toFloat64(t.sales_velocity) AS velocity_units_per_day,
  t.forecast_month_index AS forecast_month_index,
  t.forecast_units_extracted AS forecast_units_extracted,
  if(t.sales_velocity > 0, toInt64OrNull(toString(round(
    t.total_available_inventory_units / nullIf(t.sales_velocity, 0.0))))
    - toInt64(t.target_coverage_days), NULL) AS po_due_in_days,
  if(t.sales_velocity > 0, greatest(toInt64(0), -(toInt64OrNull(toString(round(
    t.total_available_inventory_units / nullIf(t.sales_velocity, 0.0))))
    - toInt64(t.target_coverage_days))), NULL) AS po_overdue_days,
  if(t.sales_velocity > 0, addDays(today(), greatest(toInt64(0),
    toInt64OrNull(toString(round(t.total_available_inventory_units / nullIf(t.sales_velocity, 0.0))))
      - toInt64(t.target_coverage_days))), NULL)
    AS po_due_date,
  CASE
    WHEN t.sales_velocity <= 0 THEN toInt64(0)
    WHEN ceil(toFloat64(t.target_coverage_days) * t.sales_velocity - t.total_available_inventory_units) > 0
      AND t.moq IS NOT NULL
      AND ceil(toFloat64(t.target_coverage_days) * t.sales_velocity - t.total_available_inventory_units) < t.moq
      THEN toInt64(t.moq)
    ELSE toInt64(greatest(0.0,
      ceil(toFloat64(t.target_coverage_days) * t.sales_velocity - t.total_available_inventory_units)))
  END AS recommended_order_units,
  toInt64(t.moq) AS moq,
  CASE
    WHEN t.sales_velocity <= 0 THEN 'low'
    WHEN toInt64OrNull(toString(round(t.total_available_inventory_units / nullIf(t.sales_velocity, 0.0))))
      - toInt64(t.target_coverage_days) <= toInt64({{stockout_threshold_days}}) THEN 'critical'
    ELSE 'high'
  END AS priority,
  'Based on PO buffer coverage: days_of_supply vs lead time, safety stock, and PO cadence.' AS reason
FROM t_classed AS t
CROSS JOIN params AS p
WHERE empty(p.revenue_abcd_classes) OR has(p.revenue_abcd_classes, t.revenue_abcd_class)
ORDER BY po_overdue_days DESC
LIMIT {{limit_top_n}}
