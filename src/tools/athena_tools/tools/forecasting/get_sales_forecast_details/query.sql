-- Tool: forecasting_get_sales_forecast_details (detail mode)
-- Purpose: portfolio/list view of forecast plan per item (SKU-level).
-- Notes:
-- - company_id filtering is REQUIRED for authorization + partition pruning.
-- - When scenario_uuid + calc_period are provided, returns that specific forecast run.
-- - Otherwise picks the latest forecast run: per inventory_id, greatest calc_period then updated_at.
-- - "actual" dataset is explicitly EXCLUDED from forecast evaluation.
-- - Inventory attributes are joined from the latest (year,month,day) snapshot partition available.

WITH params AS (
  SELECT
    {{limit_top_n}} AS top_results,
    CAST({{horizon_months}} AS INTEGER) AS horizon_months,
    {{include_plan_series_sql}} AS include_plan_series,
    {{include_sales_history_signals_sql}} AS include_sales_history_signals,
    {{include_actuals_sql}} AS include_actuals,

    -- REQUIRED (authorization + partition pruning)
    {{company_ids_array}} AS company_ids,

    -- OPTIONAL: pin to a specific forecast run (NULL = auto-latest)
    {{run_scenario_uuid_sql}} AS run_scenario_uuid,
    {{run_calc_period_sql}} AS run_calc_period,

    -- OPTIONAL filters (empty array => no filter)
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
  SELECT pil.year, pil.month, pil.day
  FROM "{{catalog}}"."{{database}}"."{{table}}" pil
  CROSS JOIN params p
  WHERE contains(p.company_ids, pil.company_id)
  GROUP BY 1, 2, 3
  ORDER BY CAST(pil.year AS INTEGER) DESC, CAST(pil.month AS INTEGER) DESC, CAST(pil.day AS INTEGER) DESC
  LIMIT 1
),

-- Forecast run selection: if scenario_uuid + calc_period provided, use those; else auto-latest.
forecast_latest_key AS (
  SELECT
    company_id,
    inventory_id,
    calc_period,
    updated_at
  FROM (
    SELECT
      f.company_id,
      f.inventory_id,
      f.calc_period,
      f.updated_at,
      row_number() OVER (
        PARTITION BY f.company_id, f.inventory_id
        ORDER BY f.calc_period DESC, f.updated_at DESC
      ) AS rn
    FROM "{{catalog}}"."{{forecasting_database}}"."{{sales_forecast_table}}" f
    CROSS JOIN params p
    WHERE contains(p.company_ids, f.company_id)
      AND f.dataset <> 'actual'
      AND (p.run_scenario_uuid IS NULL OR f.scenario_uuid = p.run_scenario_uuid)
      AND (p.run_calc_period IS NULL OR f.calc_period = p.run_calc_period)
      AND (cardinality(p.sales_channels) = 0 OR contains(p.sales_channels, lower(trim(COALESCE(f.sales_channel, '')))))
      AND (cardinality(p.country_codes) = 0 OR contains(p.country_codes, lower(trim(COALESCE(f.country_code, '')))))
  ) ranked
  WHERE rn = 1
),

forecast_latest_rows AS (
  SELECT
    f.company_id,
    f.inventory_id,
    f.calc_period AS run_calc_period,
    f.updated_at AS run_updated_at,
    f.forecast_period,
    f.units_sold,
    f.sales_amount,
    f.dataset,
    f.scenario_uuid,
    f.currency,
    f.amazon_marketplace_id,
    f.sku
  FROM "{{catalog}}"."{{forecasting_database}}"."{{sales_forecast_table}}" f
  INNER JOIN forecast_latest_key k
    ON k.company_id = f.company_id
    AND k.inventory_id = f.inventory_id
    AND k.calc_period = f.calc_period
    AND k.updated_at = f.updated_at
),

forecast_item_plan AS (
  SELECT
    fr.company_id,
    fr.inventory_id,
    MAX(fr.run_calc_period) AS run_calc_period,
    MAX(fr.run_updated_at) AS run_updated_at,
    MAX(fr.dataset) AS dataset,
    MAX(fr.scenario_uuid) AS scenario_uuid,
    MAX(fr.currency) AS currency,
    MAX(fr.amazon_marketplace_id) AS marketplace_id,
    MAX(fr.sku) AS sku,

    slice(
      array_agg(CAST(fr.forecast_period AS VARCHAR) ORDER BY fr.forecast_period),
      1, MAX(p.horizon_months)
    ) AS forecast_plan_periods_array,
    slice(
      array_agg(COALESCE(CAST(fr.units_sold AS DOUBLE), 0.0) ORDER BY fr.forecast_period),
      1, MAX(p.horizon_months)
    ) AS forecast_plan_units_array,
    slice(
      array_agg(COALESCE(CAST(fr.sales_amount AS DOUBLE), 0.0) ORDER BY fr.forecast_period),
      1, MAX(p.horizon_months)
    ) AS forecast_plan_sales_array,
    slice(
      array_agg(COALESCE(CAST(fr.currency AS VARCHAR), '') ORDER BY fr.forecast_period),
      1, MAX(p.horizon_months)
    ) AS forecast_plan_currency_array

  FROM forecast_latest_rows fr
  CROSS JOIN params p
  GROUP BY 1, 2
),

-- Actual (historical) data from the same forecast table where dataset='actual'
actual_latest_key AS (
  SELECT
    company_id,
    inventory_id,
    calc_period,
    updated_at
  FROM (
    SELECT
      f.company_id,
      f.inventory_id,
      f.calc_period,
      f.updated_at,
      row_number() OVER (
        PARTITION BY f.company_id, f.inventory_id
        ORDER BY f.calc_period DESC, f.updated_at DESC
      ) AS rn
    FROM "{{catalog}}"."{{forecasting_database}}"."{{sales_forecast_table}}" f
    CROSS JOIN params p
    WHERE contains(p.company_ids, f.company_id)
      AND f.dataset = 'actual'
      AND p.include_actuals
      AND (cardinality(p.sales_channels) = 0 OR contains(p.sales_channels, lower(trim(COALESCE(f.sales_channel, '')))))
      AND (cardinality(p.country_codes) = 0 OR contains(p.country_codes, lower(trim(COALESCE(f.country_code, '')))))
  ) ranked
  WHERE rn = 1
),

actual_latest_rows AS (
  SELECT
    f.company_id,
    f.inventory_id,
    f.forecast_period,
    f.units_sold,
    f.sales_amount,
    f.currency
  FROM "{{catalog}}"."{{forecasting_database}}"."{{sales_forecast_table}}" f
  INNER JOIN actual_latest_key ak
    ON ak.company_id = f.company_id
    AND ak.inventory_id = f.inventory_id
    AND ak.calc_period = f.calc_period
    AND ak.updated_at = f.updated_at
),

actual_item_series AS (
  SELECT
    ar.company_id,
    ar.inventory_id,
    array_agg(CAST(ar.forecast_period AS VARCHAR) ORDER BY ar.forecast_period) AS actual_periods_array,
    array_agg(COALESCE(CAST(ar.units_sold AS DOUBLE), 0.0) ORDER BY ar.forecast_period) AS actual_units_array,
    array_agg(COALESCE(CAST(ar.sales_amount AS DOUBLE), 0.0) ORDER BY ar.forecast_period) AS actual_sales_array
  FROM actual_latest_rows ar
  GROUP BY 1, 2
),

t_base AS (
  SELECT
    pil.company_id,
    pil.company_name,
    pil.company_short_name,
    pil.company_uuid,

    pil.inventory_id,
    COALESCE(pil.sku, pil.merchant_sku, fp.sku) AS sku,
    pil.country,
    pil.country_code,

    pil.child_asin,
    pil.parent_asin,
    pil.asin,
    pil.fnsku,
    pil.merchant_sku,

    pil.brand,
    pil.product_family,

    pil.revenue_abcd_class,
    pil.revenue_abcd_class_description,
    pil.pareto_abc_class,
    pil.revenue_share,
    pil.cumulative_revenue_share,

    -- recent sales signals
    pil.sales_last_30_days,
    pil.units_sold_last_30_days,
    pil.revenue_30d,
    pil.units_30d,

    -- scenario metadata for the latest forecast run
    CAST(NULL AS BIGINT) AS sales_forecast_scenario_id,
    fp.dataset AS sales_forecast_scenario_name,
    fp.scenario_uuid AS sales_forecast_scenario_uuid,
    CAST(NULL AS VARCHAR) AS seasonality_pattern,

    -- additional useful attributes
    pil.asin_img_path,
    pil.product_name,
    pil.avg_units_30d,
    pil.avg_units_7d,
    pil.avg_units_3d,

    -- plan series for latest forecast run
    fp.forecast_plan_periods_array,
    fp.forecast_plan_units_array,
    fp.forecast_plan_sales_array,
    fp.forecast_plan_currency_array,

    -- actual (historical) series
    ap.actual_periods_array,
    ap.actual_units_array,
    ap.actual_sales_array,

    concat(
      CAST(pil.year AS VARCHAR),
      '-',
      lpad(CAST(pil.month AS VARCHAR), 2, '0'),
      '-',
      lpad(CAST(pil.day AS VARCHAR), 2, '0')
    ) AS snapshot_date,

    CAST(fp.run_calc_period AS VARCHAR) AS forecast_run_period,
    fp.run_updated_at AS forecast_run_updated_at

  FROM "{{catalog}}"."{{database}}"."{{table}}" pil
  CROSS JOIN params p
  CROSS JOIN latest_snapshot s
  LEFT JOIN forecast_item_plan fp
    ON fp.company_id = pil.company_id
    AND fp.inventory_id = pil.inventory_id
  LEFT JOIN actual_item_series ap
    ON ap.company_id = pil.company_id
    AND ap.inventory_id = pil.inventory_id

  WHERE
    contains(p.company_ids, pil.company_id)
    AND pil.year = s.year
    AND pil.month = s.month
    AND pil.day = s.day

    AND (
      cardinality(p.skus) = 0
      OR contains(p.skus, COALESCE(pil.sku, pil.merchant_sku, fp.sku))
      OR contains(p.skus_lower, lower(COALESCE(pil.sku, pil.merchant_sku, fp.sku)))
    )
    AND (cardinality(p.asins) = 0 OR contains(p.asins, pil.child_asin))
    AND (cardinality(p.parent_asins) = 0 OR contains(p.parent_asins, pil.parent_asin))
    AND (cardinality(p.brands) = 0 OR contains(p.brands, pil.brand))
    AND (cardinality(p.product_families) = 0 OR contains(p.product_families, pil.product_family))
    AND (cardinality(p.marketplaces) = 0 OR contains(p.marketplaces, lower(trim(pil.country_code))))
    AND (cardinality(p.revenue_abcd_classes) = 0 OR contains(p.revenue_abcd_classes, pil.revenue_abcd_class))
)

-- Detail (SKU-level) output
SELECT
  t.company_id,
  t.company_name,
  t.company_short_name,
  t.company_uuid,

  t.inventory_id,
  t.sku,
  t.country,
  t.country_code,

  t.child_asin,
  t.parent_asin,
  t.asin,
  t.fnsku,
  t.merchant_sku,

  t.brand,
  t.product_family,

  t.revenue_abcd_class,
  t.revenue_abcd_class_description,
  t.pareto_abc_class,
  t.revenue_share,
  t.cumulative_revenue_share,

  t.sales_last_30_days,
  t.units_sold_last_30_days,
  t.revenue_30d,
  t.units_30d,

  t.sales_forecast_scenario_id,
  t.sales_forecast_scenario_name,
  t.sales_forecast_scenario_uuid,
  t.seasonality_pattern,

  t.asin_img_path,
  t.product_name,
  t.avg_units_30d,
  t.avg_units_7d,
  t.avg_units_3d,

  t.snapshot_date,
  t.forecast_run_period,
  t.forecast_run_updated_at,

  CASE
    WHEN p.include_plan_series THEN
      json_format(
        CAST(
          transform(
            sequence(1, cardinality(t.forecast_plan_periods_array)),
            i -> CAST(ROW(
              element_at(t.forecast_plan_periods_array, i),
              CAST(ROUND(element_at(t.forecast_plan_units_array, i), 0) AS BIGINT),
              ROUND(element_at(t.forecast_plan_sales_array, i), 2),
              ROUND(IF(element_at(t.forecast_plan_units_array, i) > 0,
                element_at(t.forecast_plan_sales_array, i) / element_at(t.forecast_plan_units_array, i),
                CAST(NULL AS DOUBLE)
              ), 3),
              CAST(1.0 AS DOUBLE)
            ) AS ROW(
              period VARCHAR,
              units_sold BIGINT,
              sales_amount DOUBLE,
              unit_price DOUBLE,
              seasonality_index DOUBLE
            ))
          )
        AS JSON)
      )
    ELSE CAST(NULL AS VARCHAR)
  END AS forecast_series_json,

  CASE
    WHEN p.include_actuals AND t.actual_periods_array IS NOT NULL AND cardinality(t.actual_periods_array) > 0 THEN
      json_format(
        CAST(
          transform(
            sequence(1, cardinality(t.actual_periods_array)),
            i -> CAST(ROW(
              element_at(t.actual_periods_array, i),
              CAST(ROUND(element_at(t.actual_units_array, i), 0) AS BIGINT),
              ROUND(element_at(t.actual_sales_array, i), 2),
              ROUND(IF(element_at(t.actual_units_array, i) > 0,
                element_at(t.actual_sales_array, i) / element_at(t.actual_units_array, i),
                CAST(NULL AS DOUBLE)
              ), 3)
            ) AS ROW(
              period VARCHAR,
              units_sold BIGINT,
              sales_amount DOUBLE,
              unit_price DOUBLE
            ))
          )
        AS JSON)
      )
    ELSE CAST(NULL AS VARCHAR)
  END AS actuals_series_json,

  CAST(p.horizon_months AS INTEGER) AS forecast_horizon_months

FROM t_base t
CROSS JOIN params p

ORDER BY
  COALESCE(CAST(t.sales_last_30_days AS DOUBLE), 0.0) DESC,
  COALESCE(CAST(t.units_sold_last_30_days AS DOUBLE), 0.0) DESC

LIMIT {{limit_top_n}}
