-- Tool: forecasting_get_sales_forecast_details (grouped mode)
-- Sources: ClickHouse etl.sales_forecast and etl.inventory_planning_snapshot.

WITH params AS (
  SELECT
    toUInt32({{limit_top_n}}) AS top_results,
    toUInt32({{horizon_months}}) AS horizon_months,
    {{include_plan_series_sql}} AS include_plan_series,
    {{include_actuals_sql}} AS include_actuals,
    {{company_ids_array}} AS company_ids,
    {{run_scenario_uuid_sql}} AS run_scenario_uuid,
    {{run_calc_period_sql}} AS run_calc_period,
    {{skus_array}} AS skus,
    {{skus_lower_array}} AS skus_lower,
    {{asins_array}} AS asins,
    {{parent_asins_array}} AS parent_asins,
    {{brands_array}} AS brands,
    {{product_families_array}} AS product_families,
    {{marketplaces_array}} AS marketplaces,
    {{sales_channels_array}} AS sales_channels,
    {{country_codes_array}} AS country_codes,
    {{revenue_abcd_classes_array}} AS revenue_abcd_classes
),
latest_snapshot AS (
  SELECT year, month, day
  FROM etl.inventory_planning_snapshot AS pil
  CROSS JOIN params AS p
  WHERE has(p.company_ids, pil.company_id)
  GROUP BY year, month, day
  ORDER BY toInt32(year) DESC, toInt32(month) DESC, toInt32(day) DESC
  LIMIT 1
),
item_run_candidates AS (
  SELECT f.company_id, f.inventory_id, f.scenario_uuid, f.calc_period, max(f.updated_at) AS run_updated_at
  FROM etl.sales_forecast AS f
  CROSS JOIN params AS p
  WHERE has(p.company_ids, f.company_id) AND f.dataset != 'actual'
    AND (p.run_scenario_uuid IS NULL OR f.scenario_uuid = p.run_scenario_uuid)
    AND (p.run_calc_period IS NULL OR f.calc_period = p.run_calc_period)
    AND (empty(p.sales_channels) OR has(p.sales_channels, lower(trim(coalesce(f.sales_channel, '')))))
    AND (empty(p.country_codes) OR has(p.country_codes, lower(trim(coalesce(f.country_code, '')))))
  GROUP BY f.company_id, f.inventory_id, f.scenario_uuid, f.calc_period
),
item_selected_run AS (
  SELECT ranked_runs.company_id, ranked_runs.inventory_id, ranked_runs.scenario_uuid, ranked_runs.calc_period
  FROM (
    SELECT *, row_number() OVER (PARTITION BY company_id, inventory_id ORDER BY calc_period DESC, run_updated_at DESC) AS run_rank
    FROM item_run_candidates
  ) AS ranked_runs
  WHERE ranked_runs.run_rank = 1
),
forecast_latest_rows AS (
  SELECT
    f.company_id AS company_id, f.inventory_id AS inventory_id, f.forecast_period AS forecast_period,
    f.units_sold AS units_sold, f.sales_amount AS sales_amount
  FROM etl.sales_forecast AS f
  INNER JOIN item_selected_run AS r
    ON r.company_id = f.company_id AND r.inventory_id = f.inventory_id
    AND r.scenario_uuid = f.scenario_uuid AND r.calc_period = f.calc_period
  CROSS JOIN params AS p
  WHERE f.dataset != 'actual'
    AND (empty(p.sales_channels) OR has(p.sales_channels, lower(trim(coalesce(f.sales_channel, '')))))
    AND (empty(p.country_codes) OR has(p.country_codes, lower(trim(coalesce(f.country_code, '')))))
  QUALIFY row_number() OVER (
    PARTITION BY f.company_id, f.inventory_id, f.forecast_period,
      coalesce(f.amazon_marketplace_id, ''), coalesce(f.sales_channel, ''), coalesce(f.country_code, '')
    ORDER BY f.updated_at DESC
  ) = 1
),
forecast_item_periods AS (
  SELECT company_id, inventory_id, forecast_period,
    sum(coalesce(toFloat64(units_sold), 0.0)) AS units_sold,
    sum(coalesce(toFloat64(sales_amount), 0.0)) AS sales_amount,
    row_number() OVER (PARTITION BY company_id, inventory_id ORDER BY forecast_period) AS period_rank,
    toUInt32({{horizon_months}}) AS horizon_months
  FROM forecast_latest_rows
  GROUP BY company_id, inventory_id, forecast_period
),
actual_latest_rows AS (
  SELECT
    f.company_id AS company_id, f.inventory_id AS inventory_id, f.forecast_period AS forecast_period,
    f.units_sold AS units_sold, f.sales_amount AS sales_amount
  FROM etl.sales_forecast AS f
  CROSS JOIN params AS p
  WHERE has(p.company_ids, f.company_id) AND f.dataset = 'actual' AND p.include_actuals
    AND (empty(p.sales_channels) OR has(p.sales_channels, lower(trim(coalesce(f.sales_channel, '')))))
    AND (empty(p.country_codes) OR has(p.country_codes, lower(trim(coalesce(f.country_code, '')))))
  QUALIFY row_number() OVER (
    PARTITION BY f.company_id, f.inventory_id, f.forecast_period, coalesce(f.scenario_uuid, ''),
      coalesce(f.amazon_marketplace_id, ''), coalesce(f.sales_channel, ''), coalesce(f.country_code, '')
    ORDER BY f.calc_period DESC, f.updated_at DESC
  ) = 1
),
actual_item_periods AS (
  SELECT company_id, inventory_id, forecast_period,
    sum(coalesce(toFloat64(units_sold), 0.0)) AS units_sold,
    sum(coalesce(toFloat64(sales_amount), 0.0)) AS sales_amount
  FROM actual_latest_rows GROUP BY company_id, inventory_id, forecast_period
),
t_base AS (
  SELECT
    toUInt64(pil.company_id) AS company_id, pil.company_name,
    toUInt64(pil.inventory_id) AS inventory_id, coalesce(pil.sku, pil.merchant_sku) AS sku,
    pil.country_code, pil.country, pil.child_asin, pil.parent_asin, pil.brand, pil.product_family,
    pil.sales_last_30_days, pil.units_sold_last_30_days, pil.revenue_30d, pil.units_30d,
    concat(toString(pil.year), '-', leftPad(toString(pil.month), 2, '0'), '-', leftPad(toString(pil.day), 2, '0')) AS snapshot_date
  FROM etl.inventory_planning_snapshot AS pil
  CROSS JOIN params AS p CROSS JOIN latest_snapshot AS s
  WHERE has(p.company_ids, pil.company_id)
    AND pil.year = s.year AND pil.month = s.month AND pil.day = s.day
    AND (empty(p.skus) OR has(p.skus, coalesce(pil.sku, pil.merchant_sku)) OR has(p.skus_lower, lower(coalesce(pil.sku, pil.merchant_sku))))
    AND (empty(p.asins) OR has(p.asins, pil.child_asin))
    AND (empty(p.parent_asins) OR has(p.parent_asins, pil.parent_asin))
    AND (empty(p.brands) OR has(p.brands, pil.brand))
    AND (empty(p.product_families) OR has(p.product_families, pil.product_family))
    AND (empty(p.marketplaces) OR has(p.marketplaces, lower(trim(pil.country_code))))
    AND (empty(p.revenue_abcd_classes) OR has(p.revenue_abcd_classes, pil.revenue_abcd_class))
),
t_grouped AS (
  SELECT {{group_select_base}},
    uniqExact(t.inventory_id) AS inventory_count, uniqExact(t.sku) AS sku_count,
    sum(coalesce(toFloat64(t.sales_last_30_days), 0.0)) AS sales_last_30_days,
    sum(coalesce(toFloat64(t.units_sold_last_30_days), 0.0)) AS units_sold_last_30_days,
    sum(coalesce(toFloat64(t.revenue_30d), 0.0)) AS revenue_30d,
    sum(coalesce(toFloat64(t.units_30d), 0.0)) AS units_30d,
    min(t.snapshot_date) AS snapshot_date, any(p.horizon_months) AS forecast_horizon_months
  FROM t_base AS t CROSS JOIN params AS p
  GROUP BY {{group_by_clause_base}}
),
t_grouped_limited AS (
  SELECT * FROM t_grouped ORDER BY sales_last_30_days DESC, units_sold_last_30_days DESC LIMIT {{limit_top_n}}
),
t_group_plan_periods AS (
  SELECT {{group_select_base}}, toString(fp.forecast_period) AS period,
    sum(fp.units_sold) AS units_sold, sum(fp.sales_amount) AS sales_amount
  FROM t_base AS t
  INNER JOIN forecast_item_periods AS fp ON fp.company_id = t.company_id AND fp.inventory_id = t.inventory_id
  WHERE fp.period_rank <= fp.horizon_months
  GROUP BY {{group_by_clause_base}}, fp.forecast_period
),
t_group_actual_periods AS (
  SELECT {{group_select_base}}, toString(ap.forecast_period) AS period,
    sum(ap.units_sold) AS units_sold, sum(ap.sales_amount) AS sales_amount
  FROM t_base AS t
  INNER JOIN actual_item_periods AS ap ON ap.company_id = t.company_id AND ap.inventory_id = t.inventory_id
  GROUP BY {{group_by_clause_base}}, ap.forecast_period
)
SELECT g.*, 'forecast' AS series_type, pe.period,
  toInt64(round(pe.units_sold, 0)) AS units_sold, round(pe.sales_amount, 2) AS sales_amount,
  if(pe.units_sold > 0, round(pe.sales_amount / pe.units_sold, 3), CAST(NULL, 'Nullable(Float64)')) AS unit_price
FROM t_grouped_limited AS g
INNER JOIN t_group_plan_periods AS pe ON {{group_plan_join_condition}}
CROSS JOIN params AS p WHERE p.include_plan_series
UNION ALL
SELECT g.*, 'actual' AS series_type, ae.period,
  toInt64(round(ae.units_sold, 0)) AS units_sold, round(ae.sales_amount, 2) AS sales_amount,
  if(ae.units_sold > 0, round(ae.sales_amount / ae.units_sold, 3), CAST(NULL, 'Nullable(Float64)')) AS unit_price
FROM t_grouped_limited AS g
INNER JOIN t_group_actual_periods AS ae ON {{group_actuals_join_condition}}
CROSS JOIN params AS p WHERE p.include_actuals
UNION ALL
SELECT g.*, CAST(NULL, 'Nullable(String)') AS series_type, CAST(NULL, 'Nullable(String)') AS period,
  CAST(NULL, 'Nullable(Int64)') AS units_sold, CAST(NULL, 'Nullable(Float64)') AS sales_amount,
  CAST(NULL, 'Nullable(Float64)') AS unit_price
FROM t_grouped_limited AS g CROSS JOIN params AS p
WHERE NOT p.include_plan_series AND NOT p.include_actuals
ORDER BY company_id, company_name, series_type, period
