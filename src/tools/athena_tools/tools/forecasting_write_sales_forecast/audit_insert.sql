-- Tool: forecasting_write_sales_forecast
-- Purpose: persist audit metadata for each submitted write item (immutable log).

-- Removed (scope rollback to list-tool-only change). File retained empty to avoid accidental use.
-- Intentionally left blank.


WITH params AS (
  SELECT
    CAST({{company_id}} AS BIGINT) AS company_id,
    {{reason_sql}} AS reason,
    {{author_type_sql}} AS author_type,
    {{author_name_sql}} AS author_name,
    {{author_id_sql}} AS author_id,
    {{idempotency_key_sql}} AS idempotency_key,
    {{write_mode_sql}} AS write_mode,
    {{dry_run_sql}} AS dry_run,
    current_timestamp AS created_at,
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
    w.inventory_id,
    NULLIF(TRIM(w.sku), '') AS sku,
    COALESCE(m.amazon_marketplace_id, NULLIF(TRIM(w.marketplace), '')) AS amazon_marketplace_id,
    NULLIF(TRIM(w.marketplace), '') AS marketplace,

    NULLIF(TRIM(w.forecast_period), '') AS forecast_period,
    COALESCE(NULLIF(TRIM(w.scenario_uuid), ''), 'manual') AS scenario_uuid,
    NULLIF(TRIM(w.scenario_name), '') AS scenario_name,

    w.units_sold,
    w.sales_amount,
    NULLIF(TRIM(w.currency), '') AS currency,
    NULLIF(TRIM(w.note), '') AS note,

    p.reason,
    p.author_type,
    p.author_name,
    p.author_id,
    p.idempotency_key,
    p.write_mode,
    p.dry_run,
    p.created_at,
    p.updated_at

  FROM writes_input w
  CROSS JOIN params p
  LEFT JOIN "{{forecast_catalog}}"."{{forecast_database}}"."marketplaces" m
    ON m.code = w.marketplace OR m.amazon_marketplace_id = w.marketplace
)

SELECT
  company_id,
  inventory_id,
  sku,
  amazon_marketplace_id,
  marketplace,
  forecast_period,
  scenario_uuid,
  scenario_name,
  units_sold,
  sales_amount,
  currency,
  note,
  reason,
  author_type,
  author_name,
  author_id,
  idempotency_key,
  write_mode,
  dry_run,
  created_at,
  updated_at
FROM normalized
WHERE
  forecast_period IS NOT NULL
  AND (sku IS NOT NULL OR inventory_id IS NOT NULL)
  AND amazon_marketplace_id IS NOT NULL;
