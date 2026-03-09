-- Tool: forecasting_list_latest_sales_forecast (grouped/aggregated mode)
-- Purpose: aggregated view of latest/current forecast plan, grouped by caller-specified dimensions.
-- Notes:
-- - Dimensions are injected via template variables (group_select_base, group_by_clause_base, etc.).
-- - company_id is always included in GROUP BY for authorization.
-- - "actual" dataset is explicitly EXCLUDED from latest-forecast evaluation.
-- - Forecast and actuals series are summed per period within each group, then re-serialised to JSON.

WITH params AS (
  SELECT
    {{limit_top_n}} AS top_results,
    CAST({{horizon_months}} AS INTEGER) AS horizon_months,
    {{include_plan_series_sql}} AS include_plan_series,
    {{include_actuals_sql}} AS include_actuals,

    -- REQUIRED (authorization + partition pruning)
    {{company_ids_array}} AS company_ids,

    -- OPTIONAL filters (empty array => no filter)
    {{skus_array}} AS skus,
    {{skus_lower_array}} AS skus_lower,
    {{asins_array}} AS asins,
    {{parent_asins_array}} AS parent_asins,
    {{brands_array}} AS brands,
    {{product_families_array}} AS product_families,
    {{marketplaces_array}} AS marketplaces,
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

-- Latest forecast run per item (excludes 'actual' dataset)
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

-- Base item rows: snapshot + forecast + actuals, with all filters applied.
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

    -- recent sales signals
    pil.sales_last_30_days,
    pil.units_sold_last_30_days,
    pil.revenue_30d,
    pil.units_30d,

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
    ) AS snapshot_date

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
),

-- ====================================================================
-- AGGREGATION SECTION
-- group_by dimensions are injected via template variables.
-- ====================================================================

-- Expand per-item forecast plan into (dimension, period, value) rows for GROUP BY summation.
t_plan_expanded AS (
  SELECT
    {{group_select_base}},
    period AS forecast_period,
    CAST(idx AS INTEGER) AS month_index,
    COALESCE(CAST(element_at(t.forecast_plan_units_array, CAST(idx AS INTEGER)) AS DOUBLE), 0.0) AS units,
    COALESCE(CAST(element_at(t.forecast_plan_sales_array, CAST(idx AS INTEGER)) AS DOUBLE), 0.0) AS sales_amount
  FROM t_base t
  CROSS JOIN UNNEST(t.forecast_plan_periods_array) WITH ORDINALITY AS e(period, idx)
  WHERE t.forecast_plan_periods_array IS NOT NULL
    AND cardinality(t.forecast_plan_periods_array) > 0
),

-- Sum forecast values per (group, period), then re-aggregate into a JSON series per group.
t_group_plan AS (
  SELECT
    {{group_select_raw}},
    json_format(
      CAST(
        transform(
          sequence(1, cardinality(periods)),
          i -> CAST(ROW(
            element_at(periods, i),
            CAST(ROUND(element_at(units, i), 0) AS BIGINT),
            ROUND(element_at(sales, i), 2),
            ROUND(IF(element_at(units, i) > 0, element_at(sales, i) / element_at(units, i), CAST(NULL AS DOUBLE)), 3),
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
    ) AS forecast_series_json
  FROM (
    SELECT
      {{group_select_raw}},
      array_agg(forecast_period ORDER BY month_index) AS periods,
      array_agg(sum_units ORDER BY month_index) AS units,
      array_agg(sum_sales ORDER BY month_index) AS sales
    FROM (
      SELECT
        {{group_select_raw}},
        forecast_period,
        month_index,
        SUM(units) AS sum_units,
        SUM(sales_amount) AS sum_sales
      FROM t_plan_expanded
      GROUP BY {{group_by_clause_raw}}, forecast_period, month_index
    ) x
    GROUP BY {{group_by_clause_raw}}
  ) y
),

-- Expand per-item actuals into (dimension, period, value) rows.
t_actuals_expanded AS (
  SELECT
    {{group_select_base}},
    period AS actual_period,
    CAST(idx AS INTEGER) AS month_index,
    COALESCE(CAST(element_at(t.actual_units_array, CAST(idx AS INTEGER)) AS DOUBLE), 0.0) AS units,
    COALESCE(CAST(element_at(t.actual_sales_array, CAST(idx AS INTEGER)) AS DOUBLE), 0.0) AS sales_amount
  FROM t_base t
  CROSS JOIN UNNEST(t.actual_periods_array) WITH ORDINALITY AS e(period, idx)
  WHERE t.actual_periods_array IS NOT NULL
    AND cardinality(t.actual_periods_array) > 0
),

-- Sum actuals per (group, period), then re-aggregate into JSON series per group.
t_group_actuals AS (
  SELECT
    {{group_select_raw}},
    json_format(
      CAST(
        transform(
          sequence(1, cardinality(periods)),
          i -> CAST(ROW(
            element_at(periods, i),
            CAST(ROUND(element_at(units, i), 0) AS BIGINT),
            ROUND(element_at(sales, i), 2),
            ROUND(IF(element_at(units, i) > 0, element_at(sales, i) / element_at(units, i), CAST(NULL AS DOUBLE)), 3)
          ) AS ROW(
            period VARCHAR,
            units_sold BIGINT,
            sales_amount DOUBLE,
            unit_price DOUBLE
          ))
        )
      AS JSON)
    ) AS actuals_series_json
  FROM (
    SELECT
      {{group_select_raw}},
      array_agg(actual_period ORDER BY month_index) AS periods,
      array_agg(sum_units ORDER BY month_index) AS units,
      array_agg(sum_sales ORDER BY month_index) AS sales
    FROM (
      SELECT
        {{group_select_raw}},
        actual_period,
        month_index,
        SUM(units) AS sum_units,
        SUM(sales_amount) AS sum_sales
      FROM t_actuals_expanded
      GROUP BY {{group_by_clause_raw}}, actual_period, month_index
    ) x
    GROUP BY {{group_by_clause_raw}}
  ) y
),

-- Main grouping: aggregate KPIs per dimension combination.
t_grouped AS (
  SELECT
    {{group_select_base}},

    COUNT(DISTINCT t.inventory_id) AS inventory_count,
    COUNT(DISTINCT t.sku) AS sku_count,

    SUM(COALESCE(CAST(t.sales_last_30_days AS DOUBLE), 0.0)) AS sales_last_30_days,
    SUM(COALESCE(CAST(t.units_sold_last_30_days AS DOUBLE), 0.0)) AS units_sold_last_30_days,
    SUM(COALESCE(CAST(t.revenue_30d AS DOUBLE), 0.0)) AS revenue_30d,
    SUM(COALESCE(CAST(t.units_30d AS DOUBLE), 0.0)) AS units_30d,

    MIN(t.snapshot_date) AS snapshot_date,
    CAST(MAX((SELECT horizon_months FROM params)) AS INTEGER) AS forecast_horizon_months

  FROM t_base t
  GROUP BY {{group_by_clause_base}}
)

-- Final aggregated output
SELECT
  g.*,

  CASE
    WHEN (SELECT include_plan_series FROM params)
    THEN gp.forecast_series_json
    ELSE CAST(NULL AS VARCHAR)
  END AS forecast_series_json,

  CASE
    WHEN (SELECT include_actuals FROM params)
    THEN ga.actuals_series_json
    ELSE CAST(NULL AS VARCHAR)
  END AS actuals_series_json

FROM t_grouped g

LEFT JOIN t_group_plan gp
  ON {{group_plan_join_condition}}

LEFT JOIN t_group_actuals ga
  ON {{group_actuals_join_condition}}

ORDER BY
  g.sales_last_30_days DESC,
  g.units_sold_last_30_days DESC

LIMIT {{limit_top_n}}
