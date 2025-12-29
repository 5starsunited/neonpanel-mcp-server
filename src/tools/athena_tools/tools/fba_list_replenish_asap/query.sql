-- Tool: amazon_supply_chain.fba_list_replenish_asap
-- Base SQL tested in Athena UI, templated for MCP runtime.
-- Notes:
-- - company_id filtering is REQUIRED for authorization + partition pruning.
-- - Placeholder values are rendered by the server (for example: catalog/database/table and filter params).

WITH params AS (
  SELECT
    {{sales_velocity_sql}} AS sales_velocity,
    {{planning_base_sql}} AS planning_base,
    {{override_default_sql}} AS override_default,
    {{use_seasonality_sql}} AS use_seasonality,
    {{fba_lead_time_days_override}} AS fba_lead_time_days_override,
    {{fba_safety_stock_days_override}} AS fba_safety_stock_days_override,
    CAST({{active_sold_min_units_per_day}} AS DOUBLE) AS active_sold_min_units_per_day,
    {{limit_top_n}} AS top_results,

    -- REQUIRED (authorization + partition pruning)
    {{company_ids_array}} AS company_ids,

    -- OPTIONAL filters (empty array => no filter)
    {{skus_array}} AS skus,
    {{inventory_ids_array}} AS inventory_ids,
    {{countries_array}} AS countries
),

latest_snapshot AS (
  -- inventory_planning_snapshot is partitioned by: company_id, year, month, day (all strings).
  -- This CTE selects the latest available (year,month,day) for the permitted company_ids.
  -- Because we select only partition columns, Athena can satisfy this from metastore metadata (fast).
  SELECT pil.year, pil.month, pil.day
  FROM "{{catalog}}"."{{database}}"."{{table}}" pil
  CROSS JOIN params p
  WHERE contains(p.company_ids, pil.company_id)
  GROUP BY 1, 2, 3
  ORDER BY CAST(pil.year AS INTEGER) DESC, CAST(pil.month AS INTEGER) DESC, CAST(pil.day AS INTEGER) DESC
  LIMIT 1
),

t AS (
  SELECT
    pil.company_id,
    pil.inventory_id,
    pil.sku,
    pil.country,
    pil.country_code,
    pil.asin_img_path,
    pil.product_name,
    pil.recommended_replenishment_qty AS recommended_by_amazon_replenishment_quantity,

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

  CROSS JOIN params p
  CROSS JOIN latest_snapshot s

  WHERE
    -- REQUIRED company filter
    contains(p.company_ids, pil.company_id)

    -- REQUIRED snapshot filter (partition pruning)
    AND pil.year = s.year
    AND pil.month = s.month
    AND pil.day = s.day

    -- OPTIONAL filters
    AND (cardinality(p.skus) = 0 OR contains(p.skus, pil.sku))
    AND (cardinality(p.inventory_ids) = 0 OR contains(p.inventory_ids, pil.inventory_id))
    AND (
      cardinality(p.countries) = 0
      OR contains(p.countries, pil.country)
      OR contains(p.countries, pil.country_code)
    )

    -- planning_base behavior
    AND CASE
      WHEN p.planning_base = 'all' THEN TRUE
      WHEN p.planning_base = 'targeted only' AND pil.daily_unit_sales_target > 0 THEN TRUE
      WHEN p.planning_base = 'actively sold only' AND COALESCE(pil.avg_units_30d, (COALESCE(pil.units_sold_last_30_days, 0) * 1.0 / 30.0), 0.0) >= p.active_sold_min_units_per_day THEN TRUE
      WHEN p.planning_base = 'planned only' AND pil.next_12_month_sales_plan_units IS NOT NULL THEN TRUE
      ELSE FALSE
    END
)

SELECT
  -- item_ref
  t.inventory_id AS item_ref_inventory_id,
  t.sku AS item_ref_sku,
  CAST(NULL AS VARCHAR) AS item_ref_asin,
  t.country_code AS item_ref_marketplace,
  t.product_name AS item_ref_item_name,
  t.asin_img_path AS item_ref_item_icon_url,

  -- metrics
  CASE
    WHEN t.sales_velocity > 0 THEN CAST(ROUND(t.total_fba_available_units * 1.0 / t.sales_velocity) AS BIGINT)
    ELSE NULL
  END AS fba_days_of_supply,

  -- shipment_due_in_days: when you should ship/replenish next to maintain lead_time+safety_stock buffer.
  -- negative => overdue, positive => due in future.
  CASE
    WHEN t.sales_velocity > 0 THEN (
      CAST(ROUND(t.total_fba_available_units * 1.0 / t.sales_velocity) AS BIGINT)
      - CAST(t.target_coverage_days AS BIGINT)
    )
    ELSE NULL
  END AS shipment_due_in_days,

  -- shipment_overdue_days: positive days overdue, else 0.
  CASE
    WHEN t.sales_velocity > 0 THEN GREATEST(
      CAST(0 AS BIGINT),
      -(
        CAST(ROUND(t.total_fba_available_units * 1.0 / t.sales_velocity) AS BIGINT)
        - CAST(t.target_coverage_days AS BIGINT)
      )
    )
    ELSE NULL
  END AS shipment_overdue_days,

  -- shipment_due_date: clamped to today if overdue.
  CASE
    WHEN t.sales_velocity > 0 THEN date_add(
      'day',
      GREATEST(
        CAST(0 AS BIGINT),
        (
          CAST(ROUND(t.total_fba_available_units * 1.0 / t.sales_velocity) AS BIGINT)
          - CAST(t.target_coverage_days AS BIGINT)
        )
      ),
      CURRENT_DATE
    )
    ELSE NULL
  END AS shipment_due_date,

  CAST(t.total_fba_available_units AS BIGINT) AS fba_on_hand,
  CAST(NULL AS BIGINT) AS fba_inbound,

  -- recommended_ship_units: our recommendation (not Amazon's), based on target coverage (lead_time + safety_stock).
  CASE
    WHEN t.sales_velocity > 0 THEN GREATEST(
      CAST(0 AS BIGINT),
      CAST(
        CEIL(
          (CAST(t.target_coverage_days AS DOUBLE) * t.sales_velocity)
          - CAST(t.total_fba_available_units AS DOUBLE)
        )
      AS BIGINT)
    )
    ELSE CAST(0 AS BIGINT)
  END AS recommended_ship_units,

  -- recommended_by_amazon_replenishment_quantity: raw field from the snapshot (Amazon recommendation).
  CAST(t.recommended_by_amazon_replenishment_quantity AS BIGINT) AS recommended_by_amazon_replenishment_quantity,

  -- priority/reason (draft)
  CASE
    WHEN t.sales_velocity <= 0 THEN 'low'
    WHEN (
      CAST(ROUND(t.total_fba_available_units * 1.0 / t.sales_velocity) AS BIGINT)
      - CAST(t.target_coverage_days AS BIGINT)
    ) <= CAST({{stockout_threshold_days}} AS BIGINT) THEN 'critical'
    ELSE 'high'
  END AS priority,
  CAST('Based on buffer coverage: days_of_supply vs lead_time+safety_stock. shipment_overdue_days > 0 means replenishment was due in the past. recommended_ship_units is computed from our planning params (not Amazon). If you need Amazon\'s recommendation, use recommended_by_amazon_replenishment_quantity.' AS VARCHAR) AS reason

FROM t

ORDER BY shipment_overdue_days DESC
LIMIT {{limit_top_n}};
