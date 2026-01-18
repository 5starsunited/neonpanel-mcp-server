-- Tool: forecasting_compare_sales_forecast_scenarios
-- Purpose: multi-item comparison with optional aggregation.

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

    {{scenario_names_array}} AS scenario_names,

    {{compare_mode_sql}} AS compare_mode,
    {{aggregate_mode_sql}} AS aggregate_mode,
    {{include_breakdown_sql}} AS include_breakdown,
    {{detail_needed_sql}} AS detail_needed,
    {{aggregate_needed_sql}} AS aggregate_needed,

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
      pil.sales_forecast_scenario_id,
      pil.sales_forecast_scenario_name,
      pil.sales_forecast_scenario_uuid,
      pil.ii_sku_key,
      lower(trim(COALESCE(pil.sku, pil.merchant_sku, pil.ii_sku_key))) AS normalized_sku,
      lower(trim(pil.country_code)) AS normalized_marketplace_key,
      concat(
        CAST(s.year AS VARCHAR),
        '-',
        lpad(CAST(s.month AS VARCHAR), 2, '0'),
        '-',
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
      AND pil.year = s.year
      AND pil.month = s.month
      AND pil.day = s.day

      AND (
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
          AND (
            contains(p.parent_asins, pil.parent_asin)
            OR contains(p.parent_asins_lower, lower(pil.parent_asin))
          )
        )
        OR (
          p.apply_product_family_filter
          AND (
            contains(p.product_families, pil.product_family)
            OR contains(p.product_families_lower, lower(pil.product_family))
          )
        )
      )
  )
  , deduped AS (
    SELECT * FROM filtered WHERE dedup_rn = 1
  )
  SELECT * FROM (
    SELECT
      d.*,
      row_number() OVER (ORDER BY d.inventory_id ASC NULLS LAST) AS rn
    FROM deduped d
  ) ranked_items
  CROSS JOIN params p
  WHERE ranked_items.rn <= p.max_items
),

run_candidates AS (
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
      INNER JOIN items i
        ON f.company_id = i.company_id
        AND f.sku = i.sku
        AND m.code = i.marketplace_key
      CROSS JOIN params p
      WHERE
        (cardinality(p.scenario_names) = 0 OR contains(p.scenario_names, f.dataset))
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
    i.company_id,
    i.inventory_id,
    i.sku,
    i.marketplace_key,
    i.child_asin,
    i.parent_asin,
    i.asin,
    i.product_name,
    i.product_family,
    i.snapshot_date,
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
  INNER JOIN items i
    ON f.company_id = i.company_id
    AND lower(f.sku) = i.normalized_sku
    AND lower(trim(m.code)) = i.normalized_marketplace_key
  CROSS JOIN params p
  WHERE
    (cardinality(p.scenario_names) = 0 OR contains(p.scenario_names, f.dataset))
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
    i.company_id,
    i.inventory_id,
    i.sku,
    i.marketplace_key,
    i.child_asin,
    i.parent_asin,
    i.asin,
    i.product_name,
    i.product_family,
    i.snapshot_date,
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
  INNER JOIN items i
    ON CAST(h.company_id AS VARCHAR) = CAST(i.company_id AS VARCHAR)
    AND lower(h.sku) = i.normalized_sku
    AND lower(trim(m.code)) = i.normalized_marketplace_key
  CROSS JOIN params p
  WHERE
    p.include_actuals
    AND (p.period_start IS NULL OR h.period >= p.period_start)
    AND (p.period_end IS NULL OR h.period <= p.period_end)
),

base_rows AS (
  SELECT * FROM actual_rows
  UNION ALL
  SELECT * FROM forecast_rows
),

aggregate_rows AS (
  SELECT
    CASE WHEN p.aggregate_mode IN ('product_family', 'all') THEN b.product_family ELSE CAST(NULL AS VARCHAR) END AS group_product_family,
    CASE WHEN p.aggregate_mode IN ('parent_asin', 'all') THEN b.parent_asin ELSE CAST(NULL AS VARCHAR) END AS group_parent_asin,
    b.series_type,
    b.scenario_name,
    b.run_updated_at,
    b.period,
    CAST(SUM(CAST(b.units_sold AS DOUBLE)) AS BIGINT) AS units_sold,
    ROUND(SUM(CAST(b.sales_amount AS DOUBLE)), 2) AS sales_amount,
    ROUND(
      CASE WHEN SUM(CAST(b.units_sold AS DOUBLE)) > 0 THEN SUM(CAST(b.sales_amount AS DOUBLE)) / SUM(CAST(b.units_sold AS DOUBLE)) ELSE CAST(NULL AS DOUBLE) END,
      3
    ) AS unit_price,
    MIN(b.currency) AS currency,
    CAST(1.0 AS DOUBLE) AS seasonality_index
  FROM base_rows b
  CROSS JOIN params p
  WHERE p.aggregate_needed
  GROUP BY 1, 2, 3, 4, 5, 6
)

SELECT
  'detail' AS row_type,
  CAST(NULL AS VARCHAR) AS group_product_family,
  CAST(NULL AS VARCHAR) AS group_parent_asin,
  b.company_id,
  b.inventory_id,
  b.sku,
  b.marketplace_key AS marketplace,
  b.child_asin,
  b.parent_asin,
  b.asin,
  b.product_name,
  b.product_family,
  b.snapshot_date,
  b.series_type,
  b.scenario_name,
  b.run_updated_at,
  b.period,
  b.units_sold,
  b.sales_amount,
  b.unit_price,
  b.currency,
  b.seasonality_index
FROM base_rows b
CROSS JOIN params p
WHERE p.detail_needed

UNION ALL

SELECT
  'aggregate' AS row_type,
  a.group_product_family,
  a.group_parent_asin,
  CAST(NULL AS BIGINT) AS company_id,
  CAST(NULL AS BIGINT) AS inventory_id,
  CAST(NULL AS VARCHAR) AS sku,
  CAST(NULL AS VARCHAR) AS marketplace,
  CAST(NULL AS VARCHAR) AS child_asin,
  CAST(NULL AS VARCHAR) AS parent_asin,
  CAST(NULL AS VARCHAR) AS asin,
  CAST(NULL AS VARCHAR) AS product_name,
  CAST(NULL AS VARCHAR) AS product_family,
  CAST(NULL AS VARCHAR) AS snapshot_date,
  a.series_type,
  a.scenario_name,
  a.run_updated_at,
  a.period,
  a.units_sold,
  a.sales_amount,
  a.unit_price,
  a.currency,
  a.seasonality_index
FROM aggregate_rows a

ORDER BY
  period ASC,
  scenario_name ASC,
  series_type ASC,
  run_updated_at DESC

LIMIT {{limit_top_n}};
