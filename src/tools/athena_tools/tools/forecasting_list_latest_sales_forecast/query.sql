-- Tool: forecasting_list_latest_sales_forecast
-- Purpose: portfolio/list view of the latest/current forecast plan per item.
-- Notes:
-- - company_id filtering is REQUIRED for authorization + partition pruning.
-- - "Latest" forecast is derived from the Iceberg forecast table: per inventory_id, take the row with
--   the greatest period, then (within that) the greatest updated_at.
-- - Inventory attributes are joined from the inventory snapshot for *yesterday* in America/Los_Angeles.

WITH params AS (
  SELECT
    {{limit_top_n}} AS top_results,
    CAST({{horizon_months}} AS INTEGER) AS horizon_months,
    {{include_plan_series_sql}} AS include_plan_series,
    {{include_sales_history_signals_sql}} AS include_sales_history_signals,
    {{aggregate_sql}} AS aggregate,
    {{aggregate_by_sql}} AS aggregate_by,
    {{include_item_sales_share_sql}} AS include_item_sales_share,
    {{sales_share_basis_sql}} AS sales_share_basis,

    -- REQUIRED (authorization + partition pruning)
    {{company_ids_array}} AS company_ids,

    -- OPTIONAL filters (empty array => no filter)
    {{skus_array}} AS skus,
    {{asins_array}} AS asins,
    {{parent_asins_array}} AS parent_asins,
    {{brands_array}} AS brands,
    {{product_families_array}} AS product_families,
    {{marketplaces_array}} AS marketplaces,
    {{revenue_abcd_classes_array}} AS revenue_abcd_classes
),

snapshot_yesterday AS (
  SELECT
    date_add('day', -1, CAST(at_timezone(current_timestamp, 'America/Los_Angeles') AS DATE)) AS snapshot_date
),

snapshot_parts AS (
  SELECT
    CAST(year(snapshot_date) AS VARCHAR) AS year,
    CAST(month(snapshot_date) AS VARCHAR) AS month,
    CAST(day(snapshot_date) AS VARCHAR) AS day
  FROM snapshot_yesterday
),

forecast_latest_key AS (
  SELECT
    company_id,
    inventory_id,
    period,
    updated_at

  FROM (
    SELECT
      f.company_id,
      f.inventory_id,
      f.period,
      f.updated_at,
      row_number() OVER (
        PARTITION BY f.company_id, f.inventory_id
        ORDER BY f.period DESC, f.updated_at DESC
      ) AS rn
    FROM "{{catalog}}"."{{forecasting_database}}"."{{sales_forecast_table}}" f
    CROSS JOIN params p
    WHERE contains(p.company_ids, f.company_id)
  ) ranked
  WHERE rn = 1
),

forecast_latest_rows AS (
  SELECT
    f.company_id,
    f.inventory_id,
    f.period AS run_period,
    f.updated_at AS run_updated_at,
    f.forecast_period,
    f.units_sold,
    f.sales_amount,
    f.dataset,
    f.scenario_uuid,
    f.currency,
    f.marketplace_id,
    f.sku

  FROM "{{catalog}}"."{{forecasting_database}}"."{{sales_forecast_table}}" f
  INNER JOIN forecast_latest_key k
    ON k.company_id = f.company_id
    AND k.inventory_id = f.inventory_id
    AND k.period = f.period
    AND k.updated_at = f.updated_at
),

forecast_item_plan AS (
  SELECT
    fr.company_id,
    fr.inventory_id,
    MAX(fr.run_period) AS run_period,
    MAX(fr.run_updated_at) AS run_updated_at,
    MAX(fr.dataset) AS dataset,
    MAX(fr.scenario_uuid) AS scenario_uuid,
    MAX(fr.currency) AS currency,
    MAX(fr.marketplace_id) AS marketplace_id,
    MAX(fr.sku) AS sku,

    slice(
      array_agg(COALESCE(CAST(fr.units_sold AS DOUBLE), 0.0) ORDER BY fr.forecast_period),
      1,
      MAX(p.horizon_months)
    ) AS forecast_plan_units_array

  FROM forecast_latest_rows fr
  CROSS JOIN params p
  GROUP BY 1, 2
),

t_base AS (
  SELECT
    pil.company_id,
    pil.company_name,
    pil.company_short_name,
    pil.company_uuid,

    pil.inventory_id,
    COALESCE(pil.sku, fp.sku) AS sku,
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

    -- recent sales / net sales signals
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
    fp.forecast_plan_units_array,

    -- sales share basis (used for item_sales_share when aggregate=false)
    CASE
      WHEN p.sales_share_basis = 'units_sold_last_30_days' THEN COALESCE(CAST(pil.units_sold_last_30_days AS DOUBLE), 0.0)
      ELSE COALESCE(CAST(pil.sales_last_30_days AS DOUBLE), 0.0)
    END AS sales_share_basis_value,

    -- grouping key used both for aggregation and sales share partitioning
    CASE
      WHEN p.aggregate_by = 'product_family' THEN COALESCE(pil.product_family, 'UNKNOWN')
      ELSE COALESCE(pil.parent_asin, 'UNKNOWN')
    END AS group_key,

    pil.year AS snapshot_year,
    pil.month AS snapshot_month,
    pil.day AS snapshot_day,

    fp.run_period AS forecast_run_period,
    fp.run_updated_at AS forecast_run_updated_at

  FROM "{{catalog}}"."{{database}}"."{{table}}" pil
  CROSS JOIN params p
  CROSS JOIN snapshot_parts s
  INNER JOIN forecast_item_plan fp
    ON fp.company_id = pil.company_id
    AND fp.inventory_id = pil.inventory_id

  WHERE
    contains(p.company_ids, pil.company_id)

    AND pil.year = s.year
    AND pil.month = s.month
    AND pil.day = s.day

    AND (cardinality(p.skus) = 0 OR contains(p.skus, pil.sku))
    AND (cardinality(p.asins) = 0 OR contains(p.asins, pil.child_asin))
    AND (cardinality(p.parent_asins) = 0 OR contains(p.parent_asins, pil.parent_asin))
    AND (cardinality(p.brands) = 0 OR contains(p.brands, pil.brand))
    AND (cardinality(p.product_families) = 0 OR contains(p.product_families, pil.product_family))
    AND (cardinality(p.marketplaces) = 0 OR contains(p.marketplaces, pil.country_code))
    AND (cardinality(p.revenue_abcd_classes) = 0 OR contains(p.revenue_abcd_classes, pil.revenue_abcd_class))
),

-- Expand the per-item plan series into (group_key, month_index, value) for aggregation.
t_plan_expanded AS (
  SELECT
    t.company_id,
    t.company_name,
    t.company_short_name,
    t.company_uuid,
    t.group_key,
    idx AS month_index,
    COALESCE(CAST(u AS DOUBLE), 0.0) AS units
  FROM t_base t
  CROSS JOIN UNNEST(t.forecast_plan_units_array) WITH ORDINALITY AS e(u, idx)
),

t_group_plan AS (
  SELECT
    company_id,
    company_name,
    company_short_name,
    company_uuid,
    group_key,
    json_format(CAST(array_agg(sum_units ORDER BY month_index) AS JSON)) AS forecast_plan_months_json
  FROM (
    SELECT
      company_id,
      company_name,
      company_short_name,
      company_uuid,
      group_key,
      month_index,
      SUM(units) AS sum_units
    FROM t_plan_expanded
    GROUP BY 1,2,3,4,5,6
  ) x
  GROUP BY 1,2,3,4,5
),

t_grouped AS (
  SELECT
    t.company_id,
    t.company_name,
    t.company_short_name,
    t.company_uuid,
    (SELECT aggregate_by FROM params) AS aggregate_by,
    t.group_key,

    -- a couple of useful representative fields
    MIN(t.parent_asin) AS parent_asin,
    MIN(t.product_family) AS product_family,
    MIN(t.brand) AS brand,

    COUNT(DISTINCT t.inventory_id) AS inventory_count,
    COUNT(DISTINCT t.sku) AS sku_count,

    SUM(COALESCE(CAST(t.sales_last_30_days AS DOUBLE), 0.0)) AS sales_last_30_days,
    SUM(COALESCE(CAST(t.units_sold_last_30_days AS DOUBLE), 0.0)) AS units_sold_last_30_days,
    SUM(COALESCE(CAST(t.revenue_30d AS DOUBLE), 0.0)) AS revenue_30d,
    SUM(COALESCE(CAST(t.units_30d AS DOUBLE), 0.0)) AS units_30d,

    MIN(t.sales_forecast_scenario_id) AS sales_forecast_scenario_id,
    MIN(t.sales_forecast_scenario_name) known_scenario_name,
    MIN(t.sales_forecast_scenario_uuid) AS sales_forecast_scenario_uuid,

    MIN(t.snapshot_year) AS snapshot_year,
    MIN(t.snapshot_month) AS snapshot_month,
    MIN(t.snapshot_day) AS snapshot_day
  FROM t_base t
  GROUP BY 1,2,3,4,5,6
)

-- Return either item rows (default) or aggregated group rows (aggregate=true)

SELECT
  t.*,

  CASE
    WHEN p.include_item_sales_share AND NOT p.aggregate THEN
      (t.sales_share_basis_value / NULLIF(SUM(t.sales_share_basis_value) OVER (PARTITION BY t.group_key), 0.0))
    ELSE CAST(NULL AS DOUBLE)
  END AS item_sales_share,

  CASE
    WHEN p.include_plan_series THEN
      json_format(CAST(t.forecast_plan_units_array AS JSON))
    ELSE CAST(NULL AS VARCHAR)
  END AS forecast_plan_months_json,

  p.horizon_months AS forecast_horizon_months

FROM t_base t
CROSS JOIN params p
WHERE NOT p.aggregate

UNION ALL

SELECT
  g.company_id,
  g.company_name,
  g.company_short_name,
  g.company_uuid,

  CAST(NULL AS BIGINT) AS inventory_id,
  CAST(NULL AS VARCHAR) AS sku,
  CAST(NULL AS VARCHAR) AS country,
  CAST(NULL AS VARCHAR) AS country_code,

  CAST(NULL AS VARCHAR) AS child_asin,
  g.parent_asin,
  CAST(NULL AS VARCHAR) AS asin,
  CAST(NULL AS VARCHAR) AS fnsku,
  CAST(NULL AS VARCHAR) AS merchant_sku,

  g.brand,
  g.product_family,

  CAST(NULL AS VARCHAR) AS revenue_abcd_class,
  CAST(NULL AS VARCHAR) AS revenue_abcd_class_description,
  CAST(NULL AS VARCHAR) AS pareto_abc_class,
  CAST(NULL AS DOUBLE) AS revenue_share,
  CAST(NULL AS DOUBLE) AS cumulative_revenue_share,

  g.sales_last_30_days,
  g.units_sold_last_30_days,
  g.revenue_30d,
  g.units_30d,

  g.sales_forecast_scenario_id,
  g.known_scenario_name AS sales_forecast_scenario_name,
  g.sales_forecast_scenario_uuid,
  CAST(NULL AS VARCHAR) AS seasonality_pattern,

  CAST(NULL AS VARCHAR) AS asin_img_path,
  CAST(NULL AS VARCHAR) AS product_name,
  CAST(NULL AS DOUBLE) AS avg_units_30d,
  CAST(NULL AS DOUBLE) AS avg_units_7d,
  CAST(NULL AS DOUBLE) AS avg_units_3d,

  CAST(NULL AS VARCHAR) AS next_12_month_sales_plan_units,
  CAST(NULL AS DOUBLE) AS sales_share_basis_value,
  g.group_key,

  g.snapshot_year,
  g.snapshot_month,
  g.snapshot_day,

  CAST(NULL AS DATE) AS forecast_run_period,
  CAST(NULL AS TIMESTAMP) AS forecast_run_updated_at,

  CAST(NULL AS DOUBLE) AS item_sales_share,

  CASE
    WHEN p.include_plan_series THEN gp.forecast_plan_months_json
    ELSE CAST(NULL AS VARCHAR)
  END AS forecast_plan_months_json,

  p.horizon_months AS forecast_horizon_months

FROM t_grouped g
CROSS JOIN params p
LEFT JOIN t_group_plan gp
  ON gp.company_id = g.company_id
  AND gp.company_uuid = g.company_uuid
  AND gp.group_key = g.group_key
WHERE p.aggregate

ORDER BY
  COALESCE(CAST(sales_last_30_days AS DOUBLE), 0.0) DESC,
  COALESCE(CAST(units_sold_last_30_days AS DOUBLE), 0.0) DESC

LIMIT {{limit_top_n}};
