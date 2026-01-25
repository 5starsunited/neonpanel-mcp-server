DELETE FROM "{{forecast_catalog}}"."{{forecast_database}}"."{{forecast_table_sales_forecast_writes}}"
WHERE (company_id, sku, amazon_marketplace_id, forecast_period, scenario_uuid) IN (
  WITH params AS (
    SELECT CAST({{company_id}} AS INTEGER) AS company_id
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
      COALESCE(m.amazon_marketplace_id, NULLIF(TRIM(w.marketplace), '')) AS amazon_marketplace_id,
      NULLIF(TRIM(w.sku), '') AS sku,
      NULLIF(TRIM(w.forecast_period), '') AS forecast_period,
      COALESCE(NULLIF(TRIM(w.scenario_name), ''), NULLIF(TRIM(w.scenario_uuid), ''), 'manual') AS scenario_uuid
    FROM writes_input w
    CROSS JOIN params p
    LEFT JOIN "{{forecast_catalog}}"."{{forecast_database}}"."marketplaces" m
      ON m.code = w.marketplace OR m.amazon_marketplace_id = w.marketplace
  )
  SELECT company_id, sku, amazon_marketplace_id, forecast_period, scenario_uuid
  FROM normalized
  WHERE sku IS NOT NULL AND amazon_marketplace_id IS NOT NULL AND forecast_period IS NOT NULL
);