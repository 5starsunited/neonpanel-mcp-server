-- Tool: forecasting_write_sales_forecast
-- Purpose: produce a normalized, auditable write-set for forecast overrides.
-- Notes:
-- - This SQL is intended to support dry-run preview and server-side validation.
-- - The actual INSERT/MERGE into the target Iceberg table is implemented in the tool runtime.
--   (Athena executes one statement per query; multi-statement write+select is not assumed.)

WITH params AS (
  SELECT
    CAST({{company_id}} AS BIGINT) AS company_id,
    {{dry_run_sql}} AS dry_run,
    {{reason_sql}} AS reason,

    {{author_type_sql}} AS author_type,
    {{author_name_sql}} AS author_name,
    {{author_id_sql}} AS author_id,

    {{idempotency_key_sql}} AS idempotency_key,

    current_timestamp AS created_at
),

writes_input AS (
  -- The server renders {{writes_values_sql}} as an array of ROW(...) items.
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

  FROM UNNEST(
    ARRAY[
      {{writes_values_sql}}
    ]
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

    p.created_at,

    -- Interpret marketplace as either country_code (e.g., US) or amazon marketplace id.
    COALESCE(m.amazon_marketplace_id, NULLIF(TRIM(w.marketplace), '')) AS amazon_marketplace_id,
    NULLIF(TRIM(w.marketplace), '') AS marketplace,

    w.inventory_id,
    NULLIF(TRIM(w.sku), '') AS sku,

    w.scenario_id,
    NULLIF(TRIM(w.scenario_uuid), '') AS scenario_uuid,
    NULLIF(TRIM(w.scenario_name), '') AS scenario_name,

    NULLIF(TRIM(w.forecast_period), '') AS forecast_period,
    w.units_sold,
    w.sales_amount,
    NULLIF(TRIM(w.currency), '') AS currency,

    NULLIF(TRIM(w.note), '') AS note,

    -- derived join key used across forecasting tables
    CASE
      WHEN w.sku IS NOT NULL AND COALESCE(m.amazon_marketplace_id, NULLIF(TRIM(w.marketplace), '')) IS NOT NULL THEN concat(w.sku, '-', CAST(p.company_id AS VARCHAR), '-', COALESCE(m.amazon_marketplace_id, NULLIF(TRIM(w.marketplace), '')))
      ELSE CAST(NULL AS VARCHAR)
    END AS sku_key,

    p.reason,
    p.author_type,
    p.author_name,
    p.author_id,
    p.idempotency_key,
    p.dry_run

  FROM writes_input w
  CROSS JOIN params p
  LEFT JOIN "{{forecast_catalog}}"."{{forecast_database}}"."marketplaces" m
    ON m.code = w.marketplace OR m.amazon_marketplace_id = w.marketplace
)

SELECT
  -- audit envelope
  dry_run,
  created_at,
  company_id,
  author_type,
  author_name,
  author_id,
  reason,
  idempotency_key,

  -- identity
  inventory_id,
  sku,
  marketplace,
  sku_key,

  -- scenario + period
  scenario_id,
  scenario_uuid,
  scenario_name,
  forecast_period,

  -- values
  units_sold,
  sales_amount,
  currency,
  note,

  -- basic validation flags (server can hard-fail if any are false)
  (forecast_period IS NOT NULL) AS ok_forecast_period,
  (units_sold IS NOT NULL AND units_sold >= 0) AS ok_units_sold,
  (sales_amount IS NULL OR sales_amount >= 0) AS ok_sales_amount,
  (sku IS NOT NULL AND marketplace IS NOT NULL) AS ok_item_selector

FROM normalized
ORDER BY inventory_id ASC, sku ASC, marketplace ASC, forecast_period ASC
LIMIT 500;
