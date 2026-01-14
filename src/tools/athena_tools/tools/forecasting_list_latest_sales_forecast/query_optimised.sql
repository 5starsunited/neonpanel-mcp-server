-- Tool: forecasting_list_latest_sales_forecast
-- Optimized (detail-first):
-- - Single-pass latest forecast run selection (dense_rank), avoids key-join back to forecast table.
-- - Late join of heavy strings (product_name / asin_img_path) to reduce shuffle.
-- - No GROUPING SETS / UNION ALL: this variant is for aggregate=false (details) only.

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

    -- REQUIRED (authorization + pruning)
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

-- STEP 1: Identify latest snapshot partition available for requested company_ids.
latest_snapshot AS (
  SELECT pil.year, pil.month, pil.day
  FROM "{{catalog}}"."{{database}}"."{{table}}" pil
  CROSS JOIN params p
  WHERE contains(p.company_ids, pil.company_id)
  GROUP BY 1, 2, 3
  ORDER BY CAST(pil.year AS INTEGER) DESC, CAST(pil.month AS INTEGER) DESC, CAST(pil.day AS INTEGER) DESC
  LIMIT 1
),

-- STEP 2: Keep only rows from the latest forecast run per (company_id, inventory_id).
-- This avoids scanning the forecast table twice (key selection + join back).
forecast_latest_rows AS (
  SELECT
    f.company_id,
    f.inventory_id,
    f.period,
    f.updated_at,
    f.forecast_period,
    f.units_sold,
    f.sales_amount,
    f.dataset,
    f.scenario_uuid,
    f.currency,
    f.amazon_marketplace_id,
    f.sku
  FROM (
    SELECT
      f.*,
      dense_rank() OVER (
        PARTITION BY f.company_id, f.inventory_id
        ORDER BY f.period DESC, f.updated_at DESC
      ) AS run_rank
    FROM "{{catalog}}"."{{forecasting_database}}"."{{sales_forecast_table}}" f
    CROSS JOIN params p
    WHERE contains(p.company_ids, f.company_id)
  ) f
  WHERE f.run_rank = 1
),

-- STEP 3: Summarize the latest forecast run per item (plan series + metadata).
forecast_item_plan AS (
  SELECT
    fr.company_id,
    fr.inventory_id,
    MAX(fr.period) AS run_period,
    MAX(fr.updated_at) AS run_updated_at,
    MAX(fr.dataset) AS dataset,
    MAX(fr.scenario_uuid) AS scenario_uuid,
    MAX(fr.currency) AS currency,
    MAX(fr.amazon_marketplace_id) AS marketplace_id,
    MAX(fr.sku) AS sku,

    slice(
      array_agg(COALESCE(try_cast(fr.units_sold AS DOUBLE), 0.0) ORDER BY fr.forecast_period),
      1,
      MAX(p.horizon_months)
    ) AS forecast_plan_units_array
  FROM forecast_latest_rows fr
  CROSS JOIN params p
  GROUP BY 1, 2
),

-- STEP 4: Snapshot core (IDs + numerics + filter columns; intentionally excludes heavy strings).
snapshot_core AS (
  SELECT
    pil.company_id,
    pil.company_name,
    pil.company_short_name,
    pil.company_uuid,

    pil.inventory_id,
    pil.sku,
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

    pil.sales_last_30_days,
    pil.units_sold_last_30_days,
    pil.revenue_30d,
    pil.units_30d,

    pil.avg_units_30d,
    pil.avg_units_7d,
    pil.avg_units_3d,

    pil.asin_img_path,
    pil.product_name,

    pil.year AS snapshot_year,
    pil.month AS snapshot_month,
    pil.day AS snapshot_day

  FROM "{{catalog}}"."{{database}}"."{{table}}" pil
  CROSS JOIN params p
  CROSS JOIN latest_snapshot s
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

-- STEP 5: Join forecast plan + compute group_key and (optional) sales share.
t_core AS (
  SELECT
    sc.company_id,
    sc.company_name,
    sc.company_short_name,
    sc.company_uuid,

    sc.inventory_id,
    COALESCE(sc.sku, fp.sku) AS sku,
    sc.country,
    sc.country_code,

    sc.child_asin,
    sc.parent_asin,
    sc.asin,
    sc.fnsku,
    sc.merchant_sku,

    sc.brand,
    sc.product_family,

    sc.revenue_abcd_class,
    sc.revenue_abcd_class_description,
    sc.pareto_abc_class,
    sc.revenue_share,
    sc.cumulative_revenue_share,

    sc.sales_last_30_days,
    sc.units_sold_last_30_days,
    sc.revenue_30d,
    sc.units_30d,

    CAST(NULL AS BIGINT) AS sales_forecast_scenario_id,
    fp.dataset AS sales_forecast_scenario_name,
    fp.scenario_uuid AS sales_forecast_scenario_uuid,
    CAST(NULL AS VARCHAR) AS seasonality_pattern,

    sc.avg_units_30d,
    sc.avg_units_7d,
    sc.avg_units_3d,

    sc.asin_img_path,
    sc.product_name,

    fp.forecast_plan_units_array,

    CASE
      WHEN p.sales_share_basis = 'units_sold_last_30_days' THEN COALESCE(try_cast(sc.units_sold_last_30_days AS DOUBLE), 0.0)
      ELSE COALESCE(try_cast(sc.sales_last_30_days AS DOUBLE), 0.0)
    END AS sales_share_basis_value,

    CASE
      WHEN p.aggregate_by = 'product_family' THEN COALESCE(sc.product_family, 'UNKNOWN')
      ELSE COALESCE(sc.parent_asin, 'UNKNOWN')
    END AS group_key,

    sc.snapshot_year,
    sc.snapshot_month,
    sc.snapshot_day,

    CAST(fp.run_period AS VARCHAR) AS forecast_run_period,
    fp.run_updated_at AS forecast_run_updated_at

  FROM snapshot_core sc
  CROSS JOIN params p
  LEFT JOIN forecast_item_plan fp
    ON fp.company_id = sc.company_id
    AND fp.inventory_id = sc.inventory_id
),

-- Compute any expensive window fields on the ID/numeric-only row set,
-- then apply ORDER/LIMIT before joining back heavy strings.
t_ranked AS (
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
    p.horizon_months AS forecast_horizon_months,
    COALESCE(try_cast(t.sales_last_30_days AS DOUBLE), 0.0) AS sort_sales_last_30_days,
    COALESCE(try_cast(t.units_sold_last_30_days AS DOUBLE), 0.0) AS sort_units_sold_last_30_days
  FROM t_core t
  CROSS JOIN params p
  WHERE NOT p.aggregate
),

t_limited AS (
  SELECT
    company_id,
    company_name,
    company_short_name,
    company_uuid,

    inventory_id,
    sku,
    country,
    country_code,

    child_asin,
    parent_asin,
    asin,
    fnsku,
    merchant_sku,

    brand,
    product_family,

    revenue_abcd_class,
    revenue_abcd_class_description,
    pareto_abc_class,
    revenue_share,
    cumulative_revenue_share,

    sales_last_30_days,
    units_sold_last_30_days,
    revenue_30d,
    units_30d,

    sales_forecast_scenario_id,
    sales_forecast_scenario_name,
    sales_forecast_scenario_uuid,
    seasonality_pattern,

    avg_units_30d,
    avg_units_7d,
    avg_units_3d,

    asin_img_path,
    product_name,

    sales_share_basis_value,
    group_key,

    snapshot_year,
    snapshot_month,
    snapshot_day,

    forecast_run_period,
    forecast_run_updated_at,

    item_sales_share,
    forecast_plan_months_json,
    forecast_horizon_months
  FROM t_ranked
  ORDER BY
    sort_sales_last_30_days DESC,
    sort_units_sold_last_30_days DESC
  LIMIT {{limit_top_n}}
)

-- STEP 6: Final projection.
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

  CASE WHEN p.include_sales_history_signals THEN try_cast(t.sales_last_30_days AS DOUBLE) ELSE CAST(NULL AS DOUBLE) END AS sales_last_30_days,
  CASE WHEN p.include_sales_history_signals THEN try_cast(t.units_sold_last_30_days AS DOUBLE) ELSE CAST(NULL AS DOUBLE) END AS units_sold_last_30_days,
  CASE WHEN p.include_sales_history_signals THEN try_cast(t.revenue_30d AS DOUBLE) ELSE CAST(NULL AS DOUBLE) END AS revenue_30d,
  CASE WHEN p.include_sales_history_signals THEN try_cast(t.units_30d AS DOUBLE) ELSE CAST(NULL AS DOUBLE) END AS units_30d,

  t.sales_forecast_scenario_id,
  t.sales_forecast_scenario_name,
  t.sales_forecast_scenario_uuid,
  t.seasonality_pattern,

  t.asin_img_path,
  t.product_name,
  t.avg_units_30d,
  t.avg_units_7d,
  t.avg_units_3d,

  t.sales_share_basis_value,
  t.group_key,

  t.snapshot_year,
  t.snapshot_month,
  t.snapshot_day,

  t.forecast_run_period,
  t.forecast_run_updated_at,
  t.item_sales_share,
  t.forecast_plan_months_json,
  t.forecast_horizon_months

FROM t_limited t
CROSS JOIN params p
;
