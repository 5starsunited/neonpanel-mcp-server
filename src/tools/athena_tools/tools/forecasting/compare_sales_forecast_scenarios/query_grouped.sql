-- Tool: forecasting_compare_sales_forecast_scenarios (grouped/aggregated mode)
-- Purpose: aggregated comparison of forecast scenarios/runs, with optional actuals overlay.
-- Notes:
-- - Dimensions injected via template variables (group_select_base, group_by_clause_base, etc.).
-- - company_id is always in GROUP BY.
-- - "actual" dataset excluded from forecast; included separately via include_actuals flag.

WITH params AS (
  SELECT
    {{company_ids_array}} AS company_ids,

    {{inventory_ids_array}} AS inventory_ids,
    {{sku_array}} AS skus,
    {{sku_lower_array}} AS skus_lower,
    {{sku_normalized_array}} AS skus_normalized,
    {{marketplace_sql}} AS marketplace,
    {{marketplace_lower_sql}} AS marketplace_lower,
    {{parent_asins_array}} AS parent_asins,
    {{parent_asins_lower_array}} AS parent_asins_lower,
    {{product_families_array}} AS product_families,
    {{product_families_lower_array}} AS product_families_lower,

    {{apply_inventory_id_filter_sql}} AS apply_inventory_id_filter,
    {{apply_sku_filter_sql}} AS apply_sku_filter,
    {{apply_parent_asin_filter_sql}} AS apply_parent_asin_filter,
    {{apply_product_family_filter_sql}} AS apply_product_family_filter,
    {{apply_all_items_filter_sql}} AS apply_all_items_filter,

    {{scenario_names_array}} AS scenario_names,
    {{sales_channels_array}} AS sales_channels,

    {{compare_mode_sql}} AS compare_mode,

    {{run_selector_type_sql}} AS run_selector_type,
    CAST({{run_latest_n}} AS INTEGER) AS run_latest_n,
    {{updated_at_from_sql}} AS updated_at_from,
    {{updated_at_to_sql}} AS updated_at_to,

    {{include_actuals_sql}} AS include_actuals,

    {{period_start_sql}} AS period_start,
    {{period_end_sql}} AS period_end,

    CAST({{max_items}} AS INTEGER) AS max_items
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

items AS (
  WITH filtered AS (
    SELECT
      pil.company_id,
      TRY_CAST(pil.inventory_id AS BIGINT) AS inventory_id,
      COALESCE(pil.sku, pil.merchant_sku, pil.ii_sku_key) AS sku,
      pil.country_code AS marketplace_key,
      pil.child_asin,
      pil.parent_asin,
      pil.asin,
      pil.product_name,
      pil.product_family,
      pil.brand,
      pil.ii_sku_key,
      lower(trim(COALESCE(pil.sku, pil.merchant_sku, pil.ii_sku_key))) AS normalized_sku,
      lower(trim(pil.country_code)) AS normalized_marketplace_key,
      concat(
        CAST(s.year AS VARCHAR), '-',
        lpad(CAST(s.month AS VARCHAR), 2, '0'), '-',
        lpad(CAST(s.day AS VARCHAR), 2, '0')
      ) AS snapshot_date,
      row_number() OVER (
        PARTITION BY COALESCE(pil.sku, pil.merchant_sku, pil.ii_sku_key), pil.country_code
        ORDER BY pil.inventory_id ASC NULLS LAST
      ) AS dedup_rn
    FROM "{{catalog}}"."{{database}}"."{{table}}" pil
    CROSS JOIN params p
    CROSS JOIN latest_snapshot s
    WHERE
      contains(p.company_ids, pil.company_id)
      AND pil.year = s.year AND pil.month = s.month AND pil.day = s.day
      AND (
        p.apply_all_items_filter
        OR
        (p.apply_inventory_id_filter AND contains(p.inventory_ids, TRY_CAST(pil.inventory_id AS BIGINT)))
        OR (
          p.apply_sku_filter
          AND (
            contains(p.skus, COALESCE(pil.sku, pil.merchant_sku, pil.ii_sku_key))
            OR contains(p.skus_lower, lower(COALESCE(pil.sku, pil.merchant_sku, pil.ii_sku_key)))
            OR contains(p.skus_normalized, lower(trim(COALESCE(pil.sku, pil.merchant_sku, pil.ii_sku_key))))
          )
          AND (p.marketplace IS NULL OR p.marketplace_lower IS NULL OR lower(trim(pil.country_code)) = p.marketplace_lower)
        )
        OR (
          p.apply_parent_asin_filter
          AND (contains(p.parent_asins, pil.parent_asin) OR contains(p.parent_asins_lower, lower(pil.parent_asin)))
        )
        OR (
          p.apply_product_family_filter
          AND (contains(p.product_families, pil.product_family) OR contains(p.product_families_lower, lower(pil.product_family)))
        )
      )
  )
  , deduped AS (
    SELECT * FROM filtered WHERE dedup_rn = 1
  )
  SELECT * FROM (
    SELECT d.*, row_number() OVER (ORDER BY d.inventory_id ASC NULLS LAST) AS rn
    FROM deduped d
  ) ranked_items
  CROSS JOIN params p
  WHERE p.max_items <= 0 OR ranked_items.rn <= p.max_items
),

run_candidates AS (
  SELECT scenario_name, updated_at
  FROM (
    SELECT
      scenario_name,
      updated_at,
      row_number() OVER (PARTITION BY scenario_name ORDER BY updated_at DESC) AS rn
    FROM (
      SELECT DISTINCT COALESCE(f.dataset, 'unknown') AS scenario_name, f.updated_at
      FROM "{{forecast_catalog}}"."{{forecast_database}}"."{{forecast_table_sales_forecast}}" f
      INNER JOIN items i
        ON CAST(f.company_id AS VARCHAR) = CAST(i.company_id AS VARCHAR)
        AND TRY_CAST(f.inventory_id AS BIGINT) = i.inventory_id
      CROSS JOIN params p
      WHERE
        f.dataset <> 'actual'
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

forecast_latest_rows AS (
  SELECT
    ranked.company_id,
    ranked.inventory_id,
    ranked.sku,
    ranked.marketplace_key,
    ranked.child_asin,
    ranked.parent_asin,
    ranked.asin,
    ranked.product_name,
    ranked.product_family,
    ranked.brand,
    ranked.snapshot_date,
    ranked.series_type,
    ranked.scenario_name,
    ranked.run_updated_at,
    ranked.period,
    ranked.units_sold,
    ranked.sales_amount,
    ranked.currency
  FROM (
    SELECT
      i.company_id,
      i.inventory_id,
      i.sku,
      i.marketplace_key,
      i.child_asin,
      i.parent_asin,
      i.asin,
      i.product_name,
      i.product_family,
      i.brand,
      i.snapshot_date,
      'forecast' AS series_type,
      COALESCE(f.dataset, 'unknown') AS scenario_name,
      f.updated_at AS run_updated_at,
      f.forecast_period AS period,
      f.units_sold,
      f.sales_amount,
      f.currency,
      row_number() OVER (
        PARTITION BY
          i.company_id,
          i.inventory_id,
          f.forecast_period,
          COALESCE(f.dataset, ''),
          COALESCE(f.scenario_uuid, ''),
          COALESCE(f.amazon_marketplace_id, ''),
          COALESCE(f.sales_channel, ''),
          COALESCE(f.country_code, ''),
          f.updated_at
        ORDER BY f.calc_period DESC, f.updated_at DESC
      ) AS rn
    FROM "{{forecast_catalog}}"."{{forecast_database}}"."{{forecast_table_sales_forecast}}" f
    INNER JOIN items i
      ON CAST(f.company_id AS VARCHAR) = CAST(i.company_id AS VARCHAR)
      AND TRY_CAST(f.inventory_id AS BIGINT) = i.inventory_id
    CROSS JOIN params p
    WHERE
      f.dataset <> 'actual'
      AND (cardinality(p.scenario_names) = 0 OR contains(p.scenario_names, f.dataset))
      AND (p.compare_mode <> 'runs' OR cardinality(p.scenario_names) > 0)
      AND (
        (p.run_selector_type = 'latest_n' AND EXISTS (
          SELECT 1
          FROM run_candidates rc
          WHERE rc.scenario_name = COALESCE(f.dataset, 'unknown')
            AND rc.updated_at = f.updated_at
        ))
        OR (
          p.run_selector_type = 'date_range'
          AND (p.updated_at_from IS NULL OR f.updated_at >= p.updated_at_from)
          AND (p.updated_at_to IS NULL OR f.updated_at < p.updated_at_to)
        )
      )
      AND (p.period_start IS NULL OR f.forecast_period >= p.period_start)
      AND (p.period_end IS NULL OR f.forecast_period <= p.period_end)
      AND (cardinality(p.sales_channels) = 0 OR contains(p.sales_channels, lower(trim(COALESCE(f.sales_channel, '')))))
  ) ranked
  WHERE rn = 1
),

forecast_item_periods AS (
  SELECT
    fr.company_id,
    fr.inventory_id,
    fr.sku,
    fr.marketplace_key,
    fr.child_asin,
    fr.parent_asin,
    fr.asin,
    fr.product_name,
    fr.product_family,
    fr.brand,
    fr.snapshot_date,
    fr.series_type,
    fr.scenario_name,
    fr.run_updated_at,
    fr.period,
    SUM(COALESCE(CAST(fr.units_sold AS DOUBLE), 0.0)) AS units_sold,
    SUM(COALESCE(CAST(fr.sales_amount AS DOUBLE), 0.0)) AS sales_amount,
    MIN(fr.currency) AS currency
  FROM forecast_latest_rows fr
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15
),

forecast_rows AS (
  SELECT
    fp.company_id,
    fp.inventory_id,
    fp.sku,
    fp.marketplace_key,
    fp.child_asin,
    fp.parent_asin,
    fp.asin,
    fp.product_name,
    fp.product_family,
    fp.brand,
    fp.snapshot_date,
    fp.series_type,
    fp.scenario_name,
    fp.run_updated_at,
    fp.period,
    CAST(ROUND(fp.units_sold, 0) AS BIGINT) AS units_sold,
    ROUND(fp.sales_amount, 2) AS sales_amount,
    ROUND(
      CASE WHEN fp.units_sold > 0
           THEN fp.sales_amount / fp.units_sold
           ELSE CAST(NULL AS DOUBLE) END, 3
    ) AS unit_price,
    fp.currency
  FROM forecast_item_periods fp
),

actual_latest_rows AS (
  SELECT
    ranked.company_id,
    ranked.inventory_id,
    ranked.sku,
    ranked.marketplace_key,
    ranked.child_asin,
    ranked.parent_asin,
    ranked.asin,
    ranked.product_name,
    ranked.product_family,
    ranked.brand,
    ranked.snapshot_date,
    ranked.series_type,
    ranked.scenario_name,
    ranked.run_updated_at,
    ranked.period,
    ranked.units_sold,
    ranked.sales_amount,
    ranked.currency
  FROM (
    SELECT
      i.company_id,
      i.inventory_id,
      i.sku,
      i.marketplace_key,
      i.child_asin,
      i.parent_asin,
      i.asin,
      i.product_name,
      i.product_family,
      i.brand,
      i.snapshot_date,
      'actual' AS series_type,
      'actual' AS scenario_name,
      CAST(NULL AS TIMESTAMP) AS run_updated_at,
      f.forecast_period AS period,
      f.units_sold,
      f.sales_amount,
      f.currency,
      row_number() OVER (
        PARTITION BY
          i.company_id,
          i.inventory_id,
          f.forecast_period,
          COALESCE(f.dataset, ''),
          COALESCE(f.scenario_uuid, ''),
          COALESCE(f.amazon_marketplace_id, ''),
          COALESCE(f.sales_channel, ''),
          COALESCE(f.country_code, '')
        ORDER BY f.calc_period DESC, f.updated_at DESC
      ) AS rn
    FROM "{{forecast_catalog}}"."{{forecast_database}}"."{{forecast_table_sales_forecast}}" f
    INNER JOIN items i
      ON CAST(f.company_id AS VARCHAR) = CAST(i.company_id AS VARCHAR)
      AND TRY_CAST(f.inventory_id AS BIGINT) = i.inventory_id
    CROSS JOIN params p
    WHERE
      p.include_actuals
      AND f.dataset = 'actual'
      AND (p.period_start IS NULL OR f.forecast_period >= p.period_start)
      AND (p.period_end IS NULL OR f.forecast_period <= p.period_end)
      AND (cardinality(p.sales_channels) = 0 OR contains(p.sales_channels, lower(trim(COALESCE(f.sales_channel, '')))))
  ) ranked
  WHERE rn = 1
),

actual_item_periods AS (
  SELECT
    ar.company_id,
    ar.inventory_id,
    ar.sku,
    ar.marketplace_key,
    ar.child_asin,
    ar.parent_asin,
    ar.asin,
    ar.product_name,
    ar.product_family,
    ar.brand,
    ar.snapshot_date,
    ar.series_type,
    ar.scenario_name,
    ar.run_updated_at,
    ar.period,
    SUM(COALESCE(CAST(ar.units_sold AS DOUBLE), 0.0)) AS units_sold,
    SUM(COALESCE(CAST(ar.sales_amount AS DOUBLE), 0.0)) AS sales_amount,
    MIN(ar.currency) AS currency
  FROM actual_latest_rows ar
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15
),

actual_rows AS (
  SELECT
    ap.company_id,
    ap.inventory_id,
    ap.sku,
    ap.marketplace_key,
    ap.child_asin,
    ap.parent_asin,
    ap.asin,
    ap.product_name,
    ap.product_family,
    ap.brand,
    ap.snapshot_date,
    ap.series_type,
    ap.scenario_name,
    ap.run_updated_at,
    ap.period,
    CAST(ROUND(ap.units_sold, 0) AS BIGINT) AS units_sold,
    ROUND(ap.sales_amount, 2) AS sales_amount,
    ROUND(
      CASE WHEN ap.units_sold > 0
           THEN ap.sales_amount / ap.units_sold
           ELSE CAST(NULL AS DOUBLE) END, 3
    ) AS unit_price,
    ap.currency
  FROM actual_item_periods ap
),

base_rows AS (
  SELECT * FROM forecast_rows
  UNION ALL
  SELECT * FROM actual_rows
)

-- Aggregated output: sum per (group dimensions, series_type, scenario_name, run_updated_at, period).
SELECT
  {{group_select_base}},
  b.series_type,
  b.scenario_name,
  b.run_updated_at,
  b.period,
  CAST(SUM(CAST(b.units_sold AS DOUBLE)) AS BIGINT) AS units_sold,
  ROUND(SUM(CAST(b.sales_amount AS DOUBLE)), 2) AS sales_amount,
  ROUND(
    CASE WHEN SUM(CAST(b.units_sold AS DOUBLE)) > 0
         THEN SUM(CAST(b.sales_amount AS DOUBLE)) / SUM(CAST(b.units_sold AS DOUBLE))
         ELSE CAST(NULL AS DOUBLE) END, 3
  ) AS unit_price,
  MIN(b.currency) AS currency,
  COUNT(DISTINCT b.inventory_id) AS inventory_count,
  COUNT(DISTINCT b.sku) AS sku_count
FROM base_rows b
GROUP BY {{group_by_clause_base}}, b.series_type, b.scenario_name, b.run_updated_at, b.period

ORDER BY
  period ASC,
  scenario_name ASC,
  series_type ASC,
  run_updated_at DESC

LIMIT {{limit_top_n}}
