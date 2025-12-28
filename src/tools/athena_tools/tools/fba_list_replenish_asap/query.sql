-- Tool: amazon_supply_chain.fba_list_replenish_asap
-- Base SQL tested in Athena UI, templated for MCP runtime.
-- Notes:
-- - company_id filtering is REQUIRED for authorization + partition pruning.
-- - Placeholder values are rendered by the server (for example: catalog/database/table and filter params).

WITH t AS (
  SELECT
    pil.company_id,
    pil.inventory_id,
    pil.sku,
    pil.country,
    pil.asin_img_path,
    pil.product_name,
    pil.recommended_replenishment_qty,

    CAST(
      CASE p.sales_velocity
        WHEN 'target' THEN COALESCE(pil.daily_unit_sales_target, 0)
        WHEN 'current' THEN COALESCE(pil.avg_units_30d, pil.units_sold_last_30_days, 0)
        WHEN 'planned' THEN COALESCE(
          CAST(json_extract_scalar(pil.next_12_month_sales_plan_units, '$[0].units_sold') AS DOUBLE),
          0.0
        )
        ELSE COALESCE(pil.avg_units_30d, pil.units_sold_last_30_days, 0)
      END
    AS DOUBLE) AS sales_velocity,

    (pil.inbound + pil.available + pil.fc_transfer + pil.fc_processing) AS total_fba_available_units,

    IF(p.override_default, p.fba_lead_time_days_override, pil.fba_lead_time_days) AS fba_lead_time_days,
    IF(p.override_default, p.fba_safety_stock_days_override, pil.fba_safety_stock_days) AS fba_safety_stock_days,

    CASE
      WHEN p.override_default THEN p.fba_lead_time_days_override + p.fba_safety_stock_days_override
      ELSE pil.fba_lead_time_days + pil.fba_safety_stock_days
    END AS target_coverage_days

  FROM "{{catalog}}"."{{database}}"."{{table}}" pil

  CROSS JOIN (
    SELECT
      {{sales_velocity_sql}} AS sales_velocity,
      {{planning_base_sql}} AS planning_base,
      {{override_default_sql}} AS override_default,
      {{use_seasonality_sql}} AS use_seasonality,
      {{fba_lead_time_days_override}} AS fba_lead_time_days_override,
      {{fba_safety_stock_days_override}} AS fba_safety_stock_days_override,
      {{limit_top_n}} AS top_results,

      -- REQUIRED (authorization + partition pruning)
      {{company_ids_array}} AS company_ids,

      -- OPTIONAL filters (empty array => no filter)
      {{skus_array}} AS skus,
      {{inventory_ids_array}} AS inventory_ids,
      {{countries_array}} AS countries
  ) p

  WHERE
    -- REQUIRED company filter
    contains(p.company_ids, pil.company_id)

    -- OPTIONAL filters
    AND (cardinality(p.skus) = 0 OR contains(p.skus, pil.sku))
    AND (cardinality(p.inventory_ids) = 0 OR contains(p.inventory_ids, pil.inventory_id))
    AND (cardinality(p.countries) = 0 OR contains(p.countries, pil.country))

    -- planning_base behavior
    AND CASE
      WHEN p.planning_base = 'all' THEN TRUE
      WHEN p.planning_base = 'targeted only' AND pil.daily_unit_sales_target > 0 THEN TRUE
      WHEN p.planning_base = 'actively sold only' AND pil.units_sold_last_30_days > 0 THEN TRUE
      WHEN p.planning_base = 'planned only' AND pil.next_12_month_sales_plan_units IS NOT NULL THEN TRUE
      ELSE FALSE
    END
)

SELECT
  -- item_ref
  t.inventory_id AS item_ref_inventory_id,
  t.sku AS item_ref_sku,
  CAST(NULL AS VARCHAR) AS item_ref_asin,
  t.country AS item_ref_marketplace,
  t.product_name AS item_ref_item_name,
  t.asin_img_path AS item_ref_item_icon_url,

  -- metrics
  CASE
    WHEN t.sales_velocity > 0 THEN ROUND(t.total_fba_available_units * 1.0 / t.sales_velocity)
    ELSE NULL
  END AS fba_days_of_supply,

  -- days_to_oos (draft): days_of_supply - (lead_time + safety_stock)
  CASE
    WHEN t.sales_velocity > 0 THEN (ROUND(t.total_fba_available_units * 1.0 / t.sales_velocity) - t.target_coverage_days)
    ELSE NULL
  END AS days_to_oos,

  CAST(t.total_fba_available_units AS BIGINT) AS fba_on_hand,
  CAST(NULL AS BIGINT) AS fba_inbound,
  CAST(t.recommended_replenishment_qty AS BIGINT) AS recommended_ship_units,

  -- priority/reason (draft)
  CASE
    WHEN t.sales_velocity <= 0 THEN 'low'
    WHEN (ROUND(t.total_fba_available_units * 1.0 / t.sales_velocity) - t.target_coverage_days) <= {{stockout_threshold_days}} THEN 'critical'
    ELSE 'high'
  END AS priority,
  CAST('Draft: based on days_of_supply vs lead_time+safety_stock.' AS VARCHAR) AS reason

FROM t

ORDER BY days_to_oos ASC
LIMIT {{limit_top_n}};
