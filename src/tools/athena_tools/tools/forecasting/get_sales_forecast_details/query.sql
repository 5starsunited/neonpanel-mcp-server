-- Tool: forecasting_get_sales_forecast_details (detail mode)
-- Sources: ClickHouse analytics.sales_forecast and etl.inventory_planning_snapshot.

WITH params AS (
  SELECT
    toUInt32({{limit_top_n}}) AS top_results,
    toUInt32({{horizon_months}}) AS horizon_months,
    {{include_plan_series_sql}} AS include_plan_series,
    {{include_sales_history_signals_sql}} AS include_sales_history_signals,
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
  FROM analytics.sales_forecast AS f FINAL
  CROSS JOIN params AS p
  WHERE has(p.company_ids, f.company_id)
    AND f.dataset != 'actual'
    AND (p.run_scenario_uuid IS NULL OR f.scenario_uuid = p.run_scenario_uuid)
    AND (p.run_calc_period IS NULL OR f.calc_period = p.run_calc_period)
    AND (empty(p.sales_channels) OR has(p.sales_channels, lower(trim(coalesce(f.sales_channel, '')))))
    AND (empty(p.country_codes) OR has(p.country_codes, lower(trim(coalesce(f.country_code, '')))))
  GROUP BY f.company_id, f.inventory_id, f.scenario_uuid, f.calc_period
),
item_selected_run AS (
  SELECT ranked_runs.company_id, ranked_runs.inventory_id, ranked_runs.scenario_uuid, ranked_runs.calc_period
  FROM (
    SELECT *, row_number() OVER (
      PARTITION BY company_id, inventory_id ORDER BY calc_period DESC, run_updated_at DESC
    ) AS run_rank
    FROM item_run_candidates
  ) AS ranked_runs
  WHERE ranked_runs.run_rank = 1
),
forecast_latest_rows AS (
  SELECT
    f.company_id AS company_id, f.inventory_id AS inventory_id,
    f.calc_period AS run_calc_period, f.updated_at AS run_updated_at,
    f.forecast_period AS forecast_period, f.units_sold AS units_sold,
    f.sales_amount AS sales_amount, f.dataset AS dataset, f.scenario_uuid AS scenario_uuid,
    f.currency AS currency, f.amazon_marketplace_id AS amazon_marketplace_id, f.sku AS sku
  FROM analytics.sales_forecast AS f FINAL
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
  SELECT
    rows.company_id, rows.inventory_id, max(rows.run_calc_period) AS run_calc_period,
    max(rows.run_updated_at) AS run_updated_at, max(rows.dataset) AS dataset,
    max(rows.scenario_uuid) AS selected_scenario_uuid, max(rows.currency) AS currency,
    max(rows.amazon_marketplace_id) AS marketplace_id, max(rows.sku) AS sku,
    rows.forecast_period,
    sum(coalesce(toFloat64(rows.units_sold), 0.0)) AS units_sold,
    sum(coalesce(toFloat64(rows.sales_amount), 0.0)) AS sales_amount
  FROM forecast_latest_rows AS rows
  GROUP BY rows.company_id, rows.inventory_id, rows.forecast_period
),
forecast_item_plan AS (
  SELECT
    periods.company_id, periods.inventory_id, max(periods.run_calc_period) AS run_calc_period,
    max(periods.run_updated_at) AS run_updated_at, max(periods.dataset) AS dataset,
    max(periods.selected_scenario_uuid) AS scenario_uuid, max(periods.currency) AS currency,
    max(periods.marketplace_id) AS marketplace_id, max(periods.sku) AS sku,
    arraySlice(
      arraySort(x -> x.1, groupArray((toString(periods.forecast_period), periods.units_sold, periods.sales_amount, coalesce(periods.currency, '')))),
      1, toUInt64(any(p.horizon_months))
    ) AS forecast_plan
  FROM forecast_item_periods AS periods
  CROSS JOIN params AS p
  GROUP BY periods.company_id, periods.inventory_id
),
actual_latest_rows AS (
  SELECT
    f.company_id AS company_id, f.inventory_id AS inventory_id, f.forecast_period AS forecast_period,
    f.units_sold AS units_sold, f.sales_amount AS sales_amount, f.currency AS currency
  FROM analytics.sales_forecast AS f FINAL
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
actual_item_series AS (
  SELECT company_id, inventory_id,
    arraySort(x -> x.1, groupArray((
      toString(forecast_period), coalesce(toFloat64(units_sold), 0.0), coalesce(toFloat64(sales_amount), 0.0)
    ))) AS actual_series
  FROM actual_latest_rows
  GROUP BY company_id, inventory_id
),
t_base AS (
  SELECT
    toUInt64(pil.company_id) AS company_id, pil.company_name, pil.company_short_name, pil.company_uuid,
    toUInt64(pil.inventory_id) AS inventory_id, coalesce(pil.sku, pil.merchant_sku, fp.sku) AS sku, pil.country, pil.country_code,
    pil.child_asin, pil.parent_asin, pil.asin, pil.fnsku, pil.merchant_sku, pil.brand, pil.product_family,
    pil.revenue_abcd_class, pil.revenue_abcd_class_description, pil.pareto_abc_class,
    pil.revenue_share, pil.cumulative_revenue_share,
    pil.sales_last_30_days, pil.units_sold_last_30_days, pil.revenue_30d, pil.units_30d,
    CAST(NULL, 'Nullable(UInt64)') AS sales_forecast_scenario_id,
    fp.dataset AS sales_forecast_scenario_name, fp.scenario_uuid AS sales_forecast_scenario_uuid,
    pil.seasonality_pattern, pil.asin_img_path, pil.product_name,
    pil.avg_units_30d, pil.avg_units_7d, pil.avg_units_3d,
    concat(toString(pil.year), '-', leftPad(toString(pil.month), 2, '0'), '-', leftPad(toString(pil.day), 2, '0')) AS snapshot_date,
    toString(fp.run_calc_period) AS forecast_run_period, fp.run_updated_at AS forecast_run_updated_at,
    fp.forecast_plan, ap.actual_series
  FROM etl.inventory_planning_snapshot AS pil
  CROSS JOIN params AS p
  CROSS JOIN latest_snapshot AS s
  LEFT JOIN forecast_item_plan AS fp ON fp.company_id = toUInt64(pil.company_id) AND fp.inventory_id = toUInt64(pil.inventory_id)
  LEFT JOIN actual_item_series AS ap ON ap.company_id = toUInt64(pil.company_id) AND ap.inventory_id = toUInt64(pil.inventory_id)
  WHERE has(p.company_ids, pil.company_id)
    AND pil.year = s.year AND pil.month = s.month AND pil.day = s.day
    AND (empty(p.skus) OR has(p.skus, coalesce(pil.sku, pil.merchant_sku, fp.sku))
      OR has(p.skus_lower, lower(coalesce(pil.sku, pil.merchant_sku, fp.sku))))
    AND (empty(p.asins) OR has(p.asins, pil.child_asin))
    AND (empty(p.parent_asins) OR has(p.parent_asins, pil.parent_asin))
    AND (empty(p.brands) OR has(p.brands, pil.brand))
    AND (empty(p.product_families) OR has(p.product_families, pil.product_family))
    AND (empty(p.marketplaces) OR has(p.marketplaces, lower(trim(pil.country_code))))
    AND (empty(p.revenue_abcd_classes) OR has(p.revenue_abcd_classes, pil.revenue_abcd_class))
)
SELECT
  t.* EXCEPT (forecast_plan, actual_series),
  if(p.include_plan_series,
    toJSONString(arrayMap(x -> CAST((
      x.1, toInt64(round(x.2, 0)), round(x.3, 2),
      if(x.2 > 0, round(x.3 / x.2, 3), CAST(NULL, 'Nullable(Float64)')),
      coalesce(toFloat64OrNull(arrayElement(splitByChar(';', coalesce(t.seasonality_pattern, '')), toUInt8(substring(x.1, 6, 2)))), 1.0)
    ), 'Tuple(period String, units_sold Int64, sales_amount Float64, unit_price Nullable(Float64), seasonality_index Float64)'), t.forecast_plan)),
    CAST(NULL, 'Nullable(String)')) AS forecast_series_json,
  if(p.include_actuals AND notEmpty(t.actual_series),
    toJSONString(arrayMap(x -> CAST((
      x.1, toInt64(round(x.2, 0)), round(x.3, 2),
      if(x.2 > 0, round(x.3 / x.2, 3), CAST(NULL, 'Nullable(Float64)'))
    ), 'Tuple(period String, units_sold Int64, sales_amount Float64, unit_price Nullable(Float64))'), t.actual_series)),
    CAST(NULL, 'Nullable(String)')) AS actuals_series_json,
  toUInt32(p.horizon_months) AS forecast_horizon_months
FROM t_base AS t
CROSS JOIN params AS p
ORDER BY coalesce(toFloat64(t.sales_last_30_days), 0.0) DESC, coalesce(toFloat64(t.units_sold_last_30_days), 0.0) DESC
LIMIT {{limit_top_n}}
