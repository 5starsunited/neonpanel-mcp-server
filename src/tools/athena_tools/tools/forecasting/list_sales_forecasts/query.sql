-- Tool: forecasting_list_sales_forecasts
-- Purpose: Catalog/index of all forecast runs available for a company.
--   Each row = one distinct forecast run (company_id, calc_period, updated_at, dataset).
--   Use this to discover what forecasts exist before comparing or reviewing them.
-- Notes:
-- - company_id is REQUIRED for authorization.
-- - Default sort: calc_period DESC, updated_at DESC (most recent first).
-- - Use limit=1 to get only the latest forecast run.

WITH params AS (
  SELECT
    {{company_ids_array}} AS company_ids,
    {{datasets_array}} AS datasets,
    {{marketplaces_array}} AS marketplaces,
    {{sales_channels_array}} AS sales_channels,
    {{country_codes_array}} AS country_codes,
    {{calc_periods_array}} AS calc_periods,
    CAST({{limit_top_n}} AS INTEGER) AS top_results
),

-- Aggregate each forecast run into a summary row
forecast_runs AS (
  SELECT
    f.company_id,
    f.calc_period,
    f.updated_at,
    f.dataset,
    f.scenario_uuid,

    COUNT(DISTINCT f.inventory_id) AS item_count,
    COUNT(DISTINCT f.forecast_period) AS period_count,
    MIN(f.forecast_period) AS period_start,
    MAX(f.forecast_period) AS period_end,
    COUNT(*) AS total_rows,

    SUM(COALESCE(f.units_sold, 0.0)) AS total_units,
    SUM(COALESCE(f.sales_amount, 0.0)) AS total_sales_amount,

    -- Collect distinct marketplaces and currencies
    array_distinct(array_agg(COALESCE(f.amazon_marketplace_id, 'UNKNOWN'))) AS marketplace_ids,
    array_distinct(array_agg(COALESCE(f.currency, 'UNKNOWN'))) AS currencies,
    array_distinct(array_agg(COALESCE(f.sales_channel, 'UNKNOWN'))) AS sales_channels,
    array_distinct(array_agg(COALESCE(f.country_code, 'UNKNOWN'))) AS country_codes,
    array_distinct(array_agg(COALESCE(f.sku, 'UNKNOWN'))) AS skus

  FROM "{{catalog}}"."{{forecasting_database}}"."{{sales_forecast_table}}" f
  CROSS JOIN params p
  WHERE
    contains(p.company_ids, f.company_id)
    AND (cardinality(p.datasets) = 0 OR contains(p.datasets, f.dataset))
    AND (cardinality(p.calc_periods) = 0 OR contains(p.calc_periods, f.calc_period))
    AND (
      cardinality(p.marketplaces) = 0
      OR contains(p.marketplaces, lower(trim(COALESCE(f.amazon_marketplace_id, ''))))
    )
    AND (
      cardinality(p.sales_channels) = 0
      OR contains(p.sales_channels, lower(trim(COALESCE(f.sales_channel, ''))))
    )
    AND (
      cardinality(p.country_codes) = 0
      OR contains(p.country_codes, lower(trim(COALESCE(f.country_code, ''))))
    )
  GROUP BY
    f.company_id,
    f.calc_period,
    f.updated_at,
    f.dataset,
    f.scenario_uuid
)

SELECT
  fr.company_id,
  CAST(fr.calc_period AS VARCHAR) AS calc_period,
  fr.updated_at,
  fr.dataset,
  fr.scenario_uuid,

  fr.item_count,
  fr.period_count,
  CAST(fr.period_start AS VARCHAR) AS period_start,
  CAST(fr.period_end AS VARCHAR) AS period_end,
  fr.total_rows,

  ROUND(fr.total_units, 0) AS total_units,
  ROUND(fr.total_sales_amount, 2) AS total_sales_amount,

  CAST(fr.marketplace_ids AS JSON) AS marketplace_ids,
  CAST(fr.currencies AS JSON) AS currencies,
  CAST(fr.sales_channels AS JSON) AS sales_channels,
  CAST(fr.country_codes AS JSON) AS country_codes,
  CAST(cardinality(fr.skus) AS INTEGER) AS sku_count

FROM forecast_runs fr
CROSS JOIN params p

ORDER BY fr.calc_period DESC, fr.updated_at DESC

LIMIT p.top_results
