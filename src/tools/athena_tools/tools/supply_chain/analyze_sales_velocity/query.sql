-- Tool: supply_chain_analyze_sales_velocity
-- Sources: ClickHouse etl.sales_forecast and etl.inventory_planning_snapshot.

WITH params AS (
  SELECT
    {{company_ids_array}} AS company_ids,
    {{skus_array}} AS skus,
    {{asins_array}} AS asins,
    {{parent_asins_array}} AS parent_asins,
    {{brands_array}} AS brands,
    {{product_families_array}} AS product_families,
    {{marketplaces_array}} AS marketplaces,
    {{revenue_abcd_classes_array}} AS revenue_abcd_classes,
    toFloat64({{traffic_weight_3d}}) AS traffic_weight_3d,
    toFloat64({{traffic_weight_7d}}) AS traffic_weight_7d,
    toFloat64({{traffic_weight_30d}}) AS traffic_weight_30d,
    {{coverage_days_override_sql}} AS coverage_days_override
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
    pil.country_code AS country_code,
    pil.child_asin AS child_asin,
    pil.parent_asin AS parent_asin,
    pil.brand AS brand,
    pil.product_family AS product_family,
    pil.asin_img_path AS asin_img_path,
    pil.product_name AS product_name,
    pil.year AS year,
    pil.month AS month,
    pil.day AS day,
    pil.lead_time_days AS lead_time_days,
    pil.safety_stock_days AS safety_stock_days,
    coalesce(toFloat64(pil.avg_units_3d), 0.0) AS traffic_3d,
    coalesce(toFloat64(pil.avg_units_7d), 0.0) AS traffic_7d,
    coalesce(toFloat64(pil.avg_units_30d), coalesce(toFloat64(pil.units_sold_last_30_days), 0.0) / 30.0, 0.0)
      AS traffic_30d,
    coalesce(toFloat64(pil.units_sold_last_30_days), 0.0) / 30.0 AS restock_30d,
    coalesce(toFloat64(pil.units_sold_last_30_days), 0.0) AS units_sold_last_30_days,
    coalesce(toFloat64(pil.sales_last_30_days), 0.0) AS revenue_30d
  FROM etl.inventory_planning_snapshot AS pil
  CROSS JOIN params AS p
  CROSS JOIN latest_snapshot AS snapshot
  WHERE has(p.company_ids, toUInt64(pil.company_id))
    AND pil.year = snapshot.year AND pil.month = snapshot.month AND pil.day = snapshot.day
    AND (empty(p.skus) OR has(p.skus, pil.sku))
    AND (empty(p.asins) OR has(p.asins, pil.child_asin))
    AND (empty(p.parent_asins) OR has(p.parent_asins, pil.parent_asin))
    AND (empty(p.brands) OR has(p.brands, pil.brand))
    AND (empty(p.product_families) OR has(p.product_families, pil.product_family))
    AND (empty(p.marketplaces) OR has(p.marketplaces, pil.country_code))
),
t_base AS (
  SELECT
    snapshot.*,
    coalesce(plan.plan_monthly_units, CAST([], 'Array(Float64)')) AS plan_monthly_units
  FROM snapshot_rows AS snapshot
  LEFT JOIN forecast_item_plan AS plan
    ON plan.company_id = snapshot.company_id AND plan.inventory_id = snapshot.inventory_id
),
t_classed AS (
  SELECT
    base.*,
    CASE
      WHEN sum(base.revenue_30d) OVER (PARTITION BY base.company_id, base.country_code) <= 0 THEN 'D'
      WHEN sum(base.revenue_30d) OVER (
        PARTITION BY base.company_id, base.country_code ORDER BY base.revenue_30d DESC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) / nullIf(sum(base.revenue_30d) OVER (PARTITION BY base.company_id, base.country_code), 0) <= 0.80 THEN 'A'
      WHEN sum(base.revenue_30d) OVER (
        PARTITION BY base.company_id, base.country_code ORDER BY base.revenue_30d DESC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) / nullIf(sum(base.revenue_30d) OVER (PARTITION BY base.company_id, base.country_code), 0) <= 0.95 THEN 'B'
      WHEN sum(base.revenue_30d) OVER (
        PARTITION BY base.company_id, base.country_code ORDER BY base.revenue_30d DESC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) / nullIf(sum(base.revenue_30d) OVER (PARTITION BY base.company_id, base.country_code), 0) <= 0.99 THEN 'C'
      ELSE 'D'
    END AS revenue_abcd_class
  FROM t_base AS base
),
t_horizon AS (
  SELECT
    classed.*,
    classed.traffic_3d * p.traffic_weight_3d
      + classed.traffic_7d * p.traffic_weight_7d
      + classed.traffic_30d * p.traffic_weight_30d AS traffic_weighted_recent,
    toFloat64(if(
      p.coverage_days_override IS NOT NULL,
      p.coverage_days_override,
      coalesce(classed.lead_time_days, 0) + coalesce(classed.safety_stock_days, 0)
    )) AS planning_horizon_days
  FROM t_classed AS classed
  CROSS JOIN params AS p
),
t_demand AS (
  SELECT
    horizon.*,
    (
      (arraySum(arraySlice(horizon.plan_monthly_units, 1,
        toUInt64(floor(horizon.planning_horizon_days / 30.0)))))
      + (
        (horizon.planning_horizon_days - 30.0 * floor(horizon.planning_horizon_days / 30.0)) / 30.0
      ) * arrayElement(
        horizon.plan_monthly_units,
        toUInt64(1 + floor(horizon.planning_horizon_days / 30.0))
      )
    ) AS plan_horizon_total_units,
    arrayElement(horizon.plan_monthly_units, 1) AS plan_month_1_units,
    arrayElement(horizon.plan_monthly_units, 2) AS plan_month_2_units,
    arrayElement(horizon.plan_monthly_units, 3) AS plan_month_3_units,
    arrayElement(horizon.plan_monthly_units, 4) AS plan_month_4_units,
    arrayElement(horizon.plan_monthly_units, 5) AS plan_month_5_units,
    formatDateTime(addMonths(today(), 0), '%Y-%m') AS plan_month_1_yyyy_mm,
    formatDateTime(addMonths(today(), 1), '%Y-%m') AS plan_month_2_yyyy_mm,
    formatDateTime(addMonths(today(), 2), '%Y-%m') AS plan_month_3_yyyy_mm,
    formatDateTime(addMonths(today(), 3), '%Y-%m') AS plan_month_4_yyyy_mm,
    formatDateTime(addMonths(today(), 4), '%Y-%m') AS plan_month_5_yyyy_mm
  FROM t_horizon AS horizon
),
t AS (
  SELECT
    demand.*,
    if(
      demand.planning_horizon_days > 0,
      demand.plan_horizon_total_units / demand.planning_horizon_days,
      0.0
    ) AS plan_horizon_units_per_day
  FROM t_demand AS demand
)
SELECT
  t.company_id AS company_id,
  t.inventory_id AS item_ref_inventory_id,
  t.sku AS item_ref_sku,
  t.child_asin AS item_ref_asin,
  t.country_code AS item_ref_marketplace,
  t.product_name AS item_ref_item_name,
  t.asin_img_path AS item_ref_item_icon_url,
  t.child_asin AS child_asin,
  t.parent_asin AS parent_asin,
  t.brand AS brand,
  t.product_family AS product_family,
  t.revenue_abcd_class AS revenue_abcd_class,
  t.traffic_3d AS traffic_3d,
  t.traffic_7d AS traffic_7d,
  t.traffic_30d AS traffic_30d,
  t.restock_30d AS restock_30d,
  t.traffic_weighted_recent AS traffic_weighted_recent,
  t.units_sold_last_30_days AS units_sold_last_30_days,
  t.plan_month_1_yyyy_mm AS plan_month_1_yyyy_mm,
  t.plan_month_1_units AS plan_month_1_units,
  t.plan_month_2_yyyy_mm AS plan_month_2_yyyy_mm,
  t.plan_month_2_units AS plan_month_2_units,
  t.plan_month_3_yyyy_mm AS plan_month_3_yyyy_mm,
  t.plan_month_3_units AS plan_month_3_units,
  t.plan_month_4_yyyy_mm AS plan_month_4_yyyy_mm,
  t.plan_month_4_units AS plan_month_4_units,
  t.plan_month_5_yyyy_mm AS plan_month_5_yyyy_mm,
  t.plan_month_5_units AS plan_month_5_units,
  toInt64(t.planning_horizon_days) AS planning_horizon_days,
  t.plan_horizon_total_units AS plan_horizon_total_units,
  t.plan_horizon_units_per_day AS plan_horizon_units_per_day,
  t.lead_time_days AS lead_time_days,
  t.safety_stock_days AS safety_stock_days,
  t.year AS snapshot_year,
  t.month AS snapshot_month,
  t.day AS snapshot_day
FROM t AS t
CROSS JOIN params AS p
WHERE empty(p.revenue_abcd_classes) OR has(p.revenue_abcd_classes, t.revenue_abcd_class)
ORDER BY t.company_id, t.country_code, t.revenue_30d DESC
LIMIT {{limit_top_n}}
