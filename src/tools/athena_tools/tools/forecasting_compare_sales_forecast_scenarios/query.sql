-- Tool: forecasting_compare_sales_forecast_scenarios
-- Purpose: deep-dive comparison for a single item.
-- Compares:
-- - scenarios (dataset) for the same run window
-- - runs (updated_at history) for the same scenario
-- - and optionally overlays actual sales history (enabled by default in tool.json)
-- Notes:
-- - company_id filtering is REQUIRED for authorization.
-- - This query expects the caller to provide either inventory_id OR (company_id + sku + marketplace).

WITH params AS (
  SELECT
    {{company_ids_array}} AS company_ids,

    {{inventory_id_sql}} AS inventory_id,
    {{sku_sql}} AS sku,
    {{marketplace_sql}} AS marketplace,

    {{apply_inventory_id_filter_sql}} AS apply_inventory_id_filter,
    {{apply_sku_filter_sql}} AS apply_sku_filter,
    {{apply_marketplace_filter_sql}} AS apply_marketplace_filter,

    {{scenario_names_array}} AS scenario_names,

    {{compare_mode_sql}} AS compare_mode,

    {{run_selector_type_sql}} AS run_selector_type,
    CAST({{run_latest_n}} AS INTEGER) AS run_latest_n,
    {{updated_at_from_sql}} AS updated_at_from,
    {{updated_at_to_sql}} AS updated_at_to,

    {{include_actuals_sql}} AS include_actuals,

    {{period_start_sql}} AS period_start,
    {{period_end_sql}} AS period_end,

    {{limit_top_n}} AS top_results
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

item AS (
  -- Resolve the item identity from the latest snapshot partition.
  SELECT
    pil.company_id,
    pil.inventory_id,
    pil.sku,
    pil.country_code,
    pil.child_asin,
    pil.parent_asin,
    pil.asin,
    pil.product_name,
    pil.sales_forecast_scenario_id,
    pil.sales_forecast_scenario_name,
    pil.sales_forecast_scenario_uuid,
    pil.ii_sku_key,
    concat(
      CAST(s.year AS VARCHAR),
      '-',
      lpad(CAST(s.month AS VARCHAR), 2, '0'),
      '-',
      lpad(CAST(s.day AS VARCHAR), 2, '0')
    ) AS snapshot_date
  FROM "{{catalog}}"."{{database}}"."{{table}}" pil
  CROSS JOIN params p
  CROSS JOIN latest_snapshot s
  WHERE
    contains(p.company_ids, pil.company_id)
    AND pil.year = s.year
    AND pil.month = s.month
    AND pil.day = s.day

    AND (p.apply_inventory_id_filter = false OR TRY_CAST(pil.inventory_id AS BIGINT) = p.inventory_id)
    AND (p.apply_sku_filter = false OR pil.sku = p.sku)
    AND (p.apply_marketplace_filter = false OR pil.country_code = p.marketplace)

  ORDER BY pil.inventory_id ASC
  LIMIT 1
),

resolved AS (
  SELECT
    i.*,
    -- Prefer explicit marketplace param if provided; else use snapshot country_code.
    COALESCE(NULLIF(p.marketplace, ''), i.country_code) AS marketplace_key,
    concat(i.sku, '-', CAST(i.company_id AS VARCHAR), '-', COALESCE(NULLIF(p.marketplace, ''), i.country_code)) AS sku_key
  FROM item i
  CROSS JOIN params p
),

run_candidates AS (
  -- Select which updated_at values (runs) to include.
  SELECT updated_at
  FROM (
    SELECT
      updated_at,
      row_number() OVER (ORDER BY updated_at DESC) AS rn
    FROM (
      SELECT DISTINCT f.updated_at
      FROM "{{forecast_catalog}}"."{{forecast_database}}"."{{forecast_table_sales_forecast}}" f
      INNER JOIN "{{forecast_catalog}}"."{{forecast_database}}"."marketplaces" m
        ON m.amazon_marketplace_id = f.amazon_marketplace_id
      CROSS JOIN params p
      CROSS JOIN resolved r
      WHERE
        f.company_id = r.company_id
        AND f.sku = r.sku
        AND m.code = r.marketplace_key

        AND (cardinality(p.scenario_names) = 0 OR contains(p.scenario_names, f.dataset))

        AND (
          p.run_selector_type = 'latest_n'
          OR (
            p.run_selector_type = 'date_range'
            AND (p.updated_at_from IS NULL OR f.updated_at >= p.updated_at_from)
            AND (p.updated_at_to IS NULL OR f.updated_at < p.updated_at_to)
          )
        )
    ) d
  ) ranked
  CROSS JOIN params p
  WHERE
    (p.run_selector_type = 'latest_n' AND ranked.rn <= p.run_latest_n)
    OR (p.run_selector_type <> 'latest_n' AND ranked.rn <= 1000)
),

forecast_rows AS (
  SELECT
    'forecast' AS series_type,
    COALESCE(f.dataset, 'unknown') AS scenario_name,
    f.updated_at AS run_updated_at,
    f.forecast_period AS period,
    CAST(ROUND(CAST(f.units_sold AS DOUBLE), 0) AS BIGINT) AS units_sold,
    ROUND(CAST(f.sales_amount AS DOUBLE), 2) AS sales_amount,
    ROUND(
      CASE WHEN CAST(f.units_sold AS DOUBLE) > 0 THEN CAST(f.sales_amount AS DOUBLE) / CAST(f.units_sold AS DOUBLE) ELSE CAST(NULL AS DOUBLE) END,
      3
    ) AS unit_price,
    f.currency AS currency,
    CAST(1.0 AS DOUBLE) AS seasonality_index
  FROM "{{forecast_catalog}}"."{{forecast_database}}"."{{forecast_table_sales_forecast}}" f
  INNER JOIN "{{forecast_catalog}}"."{{forecast_database}}"."marketplaces" m
    ON m.amazon_marketplace_id = f.amazon_marketplace_id
  CROSS JOIN params p
  CROSS JOIN resolved r

  WHERE
    f.company_id = r.company_id
    AND f.sku = r.sku
    AND m.code = r.marketplace_key

    AND (cardinality(p.scenario_names) = 0 OR contains(p.scenario_names, f.dataset))
    AND (p.compare_mode <> 'runs' OR cardinality(p.scenario_names) > 0)

    AND (
      p.run_selector_type = 'latest_n'
      AND f.updated_at IN (SELECT updated_at FROM run_candidates)
      OR (
        p.run_selector_type = 'date_range'
        AND (p.updated_at_from IS NULL OR f.updated_at >= p.updated_at_from)
        AND (p.updated_at_to IS NULL OR f.updated_at < p.updated_at_to)
      )
    )

    AND (p.period_start IS NULL OR f.forecast_period >= p.period_start)
    AND (p.period_end IS NULL OR f.forecast_period <= p.period_end)
),

actual_rows AS (
  SELECT
    'actual' AS series_type,
    'sales_history' AS scenario_name,
    CAST(NULL AS TIMESTAMP) AS run_updated_at,
    h.period AS period,
    CAST(ROUND(CAST(h.units_sold AS DOUBLE), 0) AS BIGINT) AS units_sold,
    ROUND(CAST(h.sales_amount AS DOUBLE), 2) AS sales_amount,
    ROUND(
      CASE WHEN CAST(h.units_sold AS DOUBLE) > 0 THEN CAST(h.sales_amount AS DOUBLE) / CAST(h.units_sold AS DOUBLE) ELSE CAST(NULL AS DOUBLE) END,
      3
    ) AS unit_price,
    h.currency AS currency,
    CAST(1.0 AS DOUBLE) AS seasonality_index
  FROM "{{forecast_catalog}}"."{{forecast_database}}"."{{forecast_table_sales_history}}" h
  INNER JOIN "{{forecast_catalog}}"."{{forecast_database}}"."marketplaces" m
    ON m.amazon_marketplace_id = h.amazon_marketplace_id
  CROSS JOIN params p
  CROSS JOIN resolved r

  WHERE
    p.include_actuals

    AND CAST(h.company_id AS VARCHAR) = CAST(r.company_id AS VARCHAR)
    AND h.sku = r.sku
    AND m.code = r.marketplace_key

    AND (p.period_start IS NULL OR h.period >= p.period_start)
    AND (p.period_end IS NULL OR h.period <= p.period_end)
)

SELECT
  -- identity
  r.company_id,
  r.inventory_id,
  r.sku,
  r.marketplace_key AS marketplace,
  r.child_asin,
  r.parent_asin,
  r.asin,
  r.product_name,
  r.snapshot_date,

  -- series
  x.series_type,
  x.scenario_name,
  x.run_updated_at,
  x.period,
  x.units_sold,
  x.sales_amount,
  x.unit_price,
  x.currency,
  x.seasonality_index

FROM resolved r
CROSS JOIN (
  SELECT * FROM actual_rows
  UNION ALL
  SELECT * FROM forecast_rows
) x

ORDER BY
  x.period ASC,
  x.series_type ASC,
  x.scenario_name ASC,
  x.run_updated_at DESC

LIMIT {{limit_top_n}};
