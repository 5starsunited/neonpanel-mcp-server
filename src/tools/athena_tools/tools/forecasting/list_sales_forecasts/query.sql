-- Tool: forecasting_list_sales_forecasts
-- Purpose: Catalog/index of all forecast runs available for a company.
--   Each row = one distinct forecast run (company_id, calc_period, updated_at, dataset).
--   Use this to discover what forecasts exist before comparing or reviewing them.
-- Source: ClickHouse analytics.sales_forecast.

WITH params AS (
  SELECT
    {{company_ids_array}} AS company_ids,
    {{datasets_array}} AS datasets,
    {{marketplaces_array}} AS marketplaces,
    {{sales_channels_array}} AS sales_channels,
    {{country_codes_array}} AS country_codes,
    {{calc_periods_array}} AS calc_periods,
    toUInt32({{limit_top_n}}) AS top_results
),

-- Aggregate each forecast run into a summary row
forecast_runs AS (
  SELECT
    f.company_id,
    f.calc_period,
    f.updated_at,
    f.dataset,
    f.scenario_uuid,

    uniqExact(f.inventory_id) AS item_count,
    uniqExact(f.forecast_period) AS period_count,
    MIN(f.forecast_period) AS period_start,
    MAX(f.forecast_period) AS period_end,
    COUNT(*) AS total_rows,

    sum(coalesce(f.units_sold, 0.0)) AS total_units,
    sum(coalesce(f.sales_amount, 0.0)) AS total_sales_amount,

    groupUniqArray(coalesce(f.amazon_marketplace_id, 'UNKNOWN')) AS marketplace_ids,
    groupUniqArray(coalesce(f.currency, 'UNKNOWN')) AS currencies,
    groupUniqArray(coalesce(f.sales_channel, 'UNKNOWN')) AS sales_channels,
    groupUniqArray(coalesce(f.country_code, 'UNKNOWN')) AS country_codes,
    uniqExact(f.sku) AS sku_count

  FROM analytics.sales_forecast AS f FINAL
  CROSS JOIN params p
  WHERE
    has(p.company_ids, f.company_id)
    AND (empty(p.datasets) OR has(p.datasets, f.dataset))
    AND (empty(p.calc_periods) OR has(p.calc_periods, f.calc_period))
    AND (
      empty(p.marketplaces)
      OR has(p.marketplaces, lower(trim(coalesce(f.amazon_marketplace_id, ''))))
    )
    AND (
      empty(p.sales_channels)
      OR has(p.sales_channels, lower(trim(coalesce(f.sales_channel, ''))))
    )
    AND (
      empty(p.country_codes)
      OR has(p.country_codes, lower(trim(coalesce(f.country_code, ''))))
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
  fr.calc_period,
  fr.updated_at,
  fr.dataset,
  fr.scenario_uuid,

  fr.item_count,
  fr.period_count,
  fr.period_start,
  fr.period_end,
  fr.total_rows,

  round(fr.total_units, 0) AS total_units,
  round(fr.total_sales_amount, 2) AS total_sales_amount,

  fr.marketplace_ids,
  fr.currencies,
  fr.sales_channels,
  fr.country_codes,
  fr.sku_count

FROM forecast_runs fr
CROSS JOIN params p

ORDER BY fr.calc_period DESC, fr.updated_at DESC

LIMIT {{limit_top_n}}
