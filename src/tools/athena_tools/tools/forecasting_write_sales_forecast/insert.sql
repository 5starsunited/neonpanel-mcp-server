INSERT INTO "{{forecast_catalog}}"."{{forecast_database}}"."{{forecast_table_sales_forecast_writes}}" (
  amazon_marketplace_id,
  currency,
  sku,
  company_id,
  inventory_id,
  forecast_period,
  units_sold,
  sales_amount,
  dataset,
  scenario_uuid,
  period,
  author_name,
  updated_at
)

WITH params AS (
  SELECT
    CAST({{company_id}} AS INTEGER) AS company_id,
    {{author_name_sql}} AS author_name,
    current_timestamp AS updated_at
),

writes_input AS (
  -- Columns (in order):
  -- inventory_id, sku, marketplace, scenario_id, scenario_uuid, scenario_name,
  -- forecast_period, units_sold, sales_amount, currency, note
  SELECT
    CAST(v.inventory_id AS BIGINT) AS inventory_id,
    CAST(v.sku AS VARCHAR) AS sku,
    CAST(v.marketplace AS VARCHAR) AS marketplace,

    CAST(v.scenario_id AS BIGINT) AS scenario_id,
    CAST(v.scenario_uuid AS VARCHAR) AS scenario_uuid,
    CAST(v.scenario_name AS VARCHAR) AS scenario_name,

    CAST(v.forecast_period AS VARCHAR) AS forecast_period,
    CAST(v.units_sold AS DOUBLE) AS units_sold,
    CAST(v.sales_amount AS DOUBLE) AS sales_amount,
    CAST(v.currency AS VARCHAR) AS currency,
    CAST(v.note AS VARCHAR) AS note

  FROM (
    VALUES
      {{writes_values_sql}}
  ) AS v(
    inventory_id,
    sku,
    marketplace,
    scenario_id,
    scenario_uuid,
    scenario_name,
    forecast_period,
    units_sold,
    sales_amount,
    currency,
    note
  )
),

normalized AS (
  SELECT
    p.company_id,

    -- Interpret marketplace as either country_code (e.g., US) or amazon marketplace id.
    COALESCE(m.amazon_marketplace_id, NULLIF(TRIM(w.marketplace), '')) AS amazon_marketplace_id,
    COALESCE(m.amazon_marketplace_id, NULLIF(TRIM(w.marketplace), '')) AS marketplace_id,
    NULLIF(TRIM(w.currency), '') AS currency,

    w.inventory_id,
    NULLIF(TRIM(w.sku), '') AS sku,

    NULLIF(TRIM(w.forecast_period), '') AS forecast_period,
    w.units_sold,
    w.sales_amount,

    -- In fc_sales_forecast_iceberg, this is the dataset/scenario label.
    COALESCE(NULLIF(TRIM(w.scenario_name), ''), 'override') AS dataset,
    NULLIF(TRIM(w.scenario_uuid), '') AS scenario_uuid,

    -- Partition key; use forecast_period by default.
    NULLIF(TRIM(w.forecast_period), '') AS period,

    p.author_name,
    p.updated_at

  FROM writes_input w
  CROSS JOIN params p
  LEFT JOIN "{{forecast_catalog}}"."{{forecast_database}}"."marketplaces" m
    ON m.code = w.marketplace OR m.amazon_marketplace_id = w.marketplace
),

valid AS (
  SELECT
    *,
    (forecast_period IS NOT NULL) AS ok_forecast_period,
    (units_sold IS NOT NULL AND units_sold >= 0) AS ok_units_sold,
    (sales_amount IS NULL OR sales_amount >= 0) AS ok_sales_amount,
    (sku IS NOT NULL AND amazon_marketplace_id IS NOT NULL) AS ok_item_selector
  FROM normalized
)

SELECT
  amazon_marketplace_id,
  currency,
  sku,
  company_id,
  inventory_id,
  forecast_period,
  units_sold,
  sales_amount,
  dataset,
  scenario_uuid,
  period,
  author_name,
  updated_at
FROM valid
WHERE ok_forecast_period AND ok_units_sold AND ok_sales_amount AND ok_item_selector;
