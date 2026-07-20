-- Tool: forecasting_compare_sales_forecast_scenarios (grouped mode)
-- Sources: ClickHouse etl.sales_forecast and etl.inventory_planning_snapshot.

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
    toUInt32({{run_latest_n}}) AS run_latest_n,
    {{updated_at_from_sql}} AS updated_at_from,
    {{updated_at_to_sql}} AS updated_at_to,
    {{include_actuals_sql}} AS include_actuals,
    {{period_start_sql}} AS period_start,
    {{period_end_sql}} AS period_end,
    toUInt32({{max_items}}) AS max_items
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
items AS (
  SELECT ranked_items.* EXCEPT (dedup_rank, item_rank)
  FROM (
    SELECT filtered_items.*, row_number() OVER (
      ORDER BY filtered_items.company_id ASC, filtered_items.inventory_id ASC
    ) AS item_rank
    FROM (
      SELECT
        toUInt64(pil.company_id) AS company_id, toUInt64(pil.inventory_id) AS inventory_id,
        coalesce(pil.sku, pil.merchant_sku, pil.ii_sku_key) AS sku,
        pil.country_code AS marketplace_key, pil.child_asin, pil.parent_asin, pil.asin,
        pil.product_name, pil.product_family, pil.brand,
        concat(toString(s.year), '-', leftPad(toString(s.month), 2, '0'), '-', leftPad(toString(s.day), 2, '0')) AS snapshot_date,
        row_number() OVER (
          PARTITION BY pil.company_id, coalesce(pil.sku, pil.merchant_sku, pil.ii_sku_key), pil.country_code
          ORDER BY pil.inventory_id ASC
        ) AS dedup_rank
      FROM etl.inventory_planning_snapshot AS pil
      CROSS JOIN params AS p
      CROSS JOIN latest_snapshot AS s
      WHERE has(p.company_ids, pil.company_id)
        AND pil.year = s.year AND pil.month = s.month AND pil.day = s.day
        AND (
          p.apply_all_items_filter
          OR (p.apply_inventory_id_filter AND has(p.inventory_ids, toUInt64(pil.inventory_id)))
          OR (p.apply_sku_filter
            AND (has(p.skus, coalesce(pil.sku, pil.merchant_sku, pil.ii_sku_key))
              OR has(p.skus_lower, lower(coalesce(pil.sku, pil.merchant_sku, pil.ii_sku_key)))
              OR has(p.skus_normalized, lower(trim(coalesce(pil.sku, pil.merchant_sku, pil.ii_sku_key)))))
            AND (p.marketplace IS NULL OR p.marketplace_lower IS NULL OR lower(trim(pil.country_code)) = p.marketplace_lower))
          OR (p.apply_parent_asin_filter
            AND (has(p.parent_asins, pil.parent_asin) OR has(p.parent_asins_lower, lower(pil.parent_asin))))
          OR (p.apply_product_family_filter
            AND (has(p.product_families, pil.product_family) OR has(p.product_families_lower, lower(pil.product_family))))
        )
    ) AS filtered_items
    WHERE filtered_items.dedup_rank = 1
  ) AS ranked_items
  CROSS JOIN params AS p
  WHERE p.max_items = 0 OR ranked_items.item_rank <= p.max_items
),
run_candidates AS (
  SELECT ranked_runs.scenario_name, ranked_runs.run_updated_at
  FROM (
    SELECT distinct_runs.scenario_name, distinct_runs.run_updated_at,
      dense_rank() OVER (
        PARTITION BY distinct_runs.scenario_name ORDER BY distinct_runs.run_updated_at DESC
      ) AS run_rank
    FROM (
      SELECT DISTINCT coalesce(f.dataset, 'unknown') AS scenario_name, f.updated_at AS run_updated_at
      FROM etl.sales_forecast AS f
      INNER JOIN items AS i ON f.company_id = i.company_id AND toUInt64(f.inventory_id) = i.inventory_id
      CROSS JOIN params AS p
      WHERE f.dataset != 'actual'
        AND (empty(p.scenario_names) OR has(p.scenario_names, f.dataset))
        AND (p.run_selector_type = 'latest_n' OR (
          p.run_selector_type = 'date_range'
          AND (p.updated_at_from IS NULL OR f.updated_at >= p.updated_at_from)
          AND (p.updated_at_to IS NULL OR f.updated_at < p.updated_at_to)
        ))
    ) AS distinct_runs
  ) AS ranked_runs
  CROSS JOIN params AS p
  WHERE (p.run_selector_type = 'latest_n' AND ranked_runs.run_rank <= p.run_latest_n)
    OR (p.run_selector_type != 'latest_n' AND ranked_runs.run_rank <= 1000)
),
forecast_latest_rows AS (
  SELECT
    i.company_id AS company_id, i.inventory_id AS inventory_id, i.sku AS sku,
    i.child_asin AS child_asin, i.parent_asin AS parent_asin,
    i.product_family AS product_family, i.brand AS brand,
    'forecast' AS series_type, coalesce(f.dataset, 'unknown') AS scenario_name,
    f.updated_at AS run_updated_at, f.forecast_period AS period, f.units_sold AS units_sold,
    f.sales_amount AS sales_amount, f.currency AS currency
  FROM etl.sales_forecast AS f
  INNER JOIN items AS i ON f.company_id = i.company_id AND toUInt64(f.inventory_id) = i.inventory_id
  INNER JOIN run_candidates AS rc ON rc.scenario_name = coalesce(f.dataset, 'unknown') AND rc.run_updated_at = f.updated_at
  CROSS JOIN params AS p
  WHERE f.dataset != 'actual'
    AND (empty(p.scenario_names) OR has(p.scenario_names, f.dataset))
    AND (p.compare_mode != 'runs' OR notEmpty(p.scenario_names))
    AND (p.period_start IS NULL OR f.forecast_period >= p.period_start)
    AND (p.period_end IS NULL OR f.forecast_period <= p.period_end)
    AND (empty(p.sales_channels) OR has(p.sales_channels, lower(trim(coalesce(f.sales_channel, '')))))
  QUALIFY row_number() OVER (
    PARTITION BY i.company_id, i.inventory_id, f.forecast_period, coalesce(f.dataset, ''),
      coalesce(f.scenario_uuid, ''), coalesce(f.amazon_marketplace_id, ''),
      coalesce(f.sales_channel, ''), coalesce(f.country_code, ''), f.updated_at
    ORDER BY f.calc_period DESC, f.updated_at DESC
  ) = 1
),
actual_latest_rows AS (
  SELECT
    i.company_id AS company_id, i.inventory_id AS inventory_id, i.sku AS sku,
    i.child_asin AS child_asin, i.parent_asin AS parent_asin,
    i.product_family AS product_family, i.brand AS brand,
    'actual' AS series_type, 'actual' AS scenario_name,
    CAST(NULL, 'Nullable(DateTime64(3))') AS run_updated_at, f.forecast_period AS period,
    f.units_sold AS units_sold, f.sales_amount AS sales_amount, f.currency AS currency
  FROM etl.sales_forecast AS f
  INNER JOIN items AS i ON f.company_id = i.company_id AND toUInt64(f.inventory_id) = i.inventory_id
  CROSS JOIN params AS p
  WHERE p.include_actuals AND f.dataset = 'actual'
    AND (p.period_start IS NULL OR f.forecast_period >= p.period_start)
    AND (p.period_end IS NULL OR f.forecast_period <= p.period_end)
    AND (empty(p.sales_channels) OR has(p.sales_channels, lower(trim(coalesce(f.sales_channel, '')))))
  QUALIFY row_number() OVER (
    PARTITION BY i.company_id, i.inventory_id, f.forecast_period, coalesce(f.dataset, ''),
      coalesce(f.scenario_uuid, ''), coalesce(f.amazon_marketplace_id, ''),
      coalesce(f.sales_channel, ''), coalesce(f.country_code, '')
    ORDER BY f.calc_period DESC, f.updated_at DESC
  ) = 1
),
base_rows AS (
  SELECT * FROM forecast_latest_rows
  UNION ALL
  SELECT * FROM actual_latest_rows
)
SELECT
  {{group_select_base}},
  b.series_type,
  b.scenario_name,
  b.run_updated_at,
  b.period,
  toInt64(round(sum(coalesce(toFloat64(b.units_sold), 0.0)), 0)) AS units_sold,
  round(sum(coalesce(toFloat64(b.sales_amount), 0.0)), 2) AS sales_amount,
  if(sum(coalesce(toFloat64(b.units_sold), 0.0)) > 0,
    round(sum(coalesce(toFloat64(b.sales_amount), 0.0)) / sum(coalesce(toFloat64(b.units_sold), 0.0)), 3),
    CAST(NULL, 'Nullable(Float64)')) AS unit_price,
  min(b.currency) AS currency,
  uniqExact(b.inventory_id) AS inventory_count,
  uniqExact(b.sku) AS sku_count
FROM base_rows AS b
GROUP BY {{group_by_clause_base}}, b.series_type, b.scenario_name, b.run_updated_at, b.period
ORDER BY period ASC, scenario_name ASC, series_type ASC, run_updated_at DESC
LIMIT {{limit_top_n}}
