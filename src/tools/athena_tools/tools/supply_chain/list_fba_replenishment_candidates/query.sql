-- Tool: supply_chain_list_fba_replenishment_candidates
-- Base SQL tested in Athena UI, templated for MCP runtime.
-- Notes:
-- - company_id filtering is REQUIRED for authorization + partition pruning.
-- - Placeholder values are rendered by the server (for example: catalog/database/table and filter params).
-- - Plan data is sourced from the Iceberg forecast table so that writes via
--   forecasting_write_sales_forecast are reflected immediately.

WITH params AS (
  SELECT
    {{sales_velocity_sql}} AS sales_velocity,
    {{planning_base_sql}} AS planning_base,
    {{override_default_sql}} AS override_default,
    {{use_seasonality_sql}} AS use_seasonality,
    {{fba_lead_time_days_override}} AS fba_lead_time_days_override,
    {{fba_safety_stock_days_override}} AS fba_safety_stock_days_override,
    {{days_between_shipments}} AS days_between_shipments,
    CAST({{active_sold_min_units_per_day}} AS DOUBLE) AS active_sold_min_units_per_day,
    -- 'current' velocity blend weights over realized daily averages (30d/7d/3d)
    CAST({{weight_30d}} AS DOUBLE) AS weight_30d,
    CAST({{weight_7d}} AS DOUBLE) AS weight_7d,
    CAST({{weight_3d}} AS DOUBLE) AS weight_3d,
    {{limit_top_n}} AS top_results,

    -- REQUIRED (authorization + partition pruning)
    {{company_ids_array}} AS company_ids,

    -- OPTIONAL filters (empty array => no filter)
    {{skus_array}} AS skus,
    {{inventory_ids_array}} AS inventory_ids,
    {{asins_array}} AS asins,
    {{parent_asins_array}} AS parent_asins,
    {{brands_array}} AS brands,
    {{product_families_array}} AS product_families,
    {{countries_array}} AS countries,
    {{revenue_abcd_classes_array}} AS revenue_abcd_classes
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

-- ---- Forecast plan from Iceberg table ----
forecast_latest_key AS (
  SELECT
    company_id,
    inventory_id,
    calc_period,
    updated_at
  FROM (
    SELECT
      f.company_id,
      f.inventory_id,
      f.calc_period,
      f.updated_at,
      row_number() OVER (
        PARTITION BY f.company_id, f.inventory_id
        ORDER BY f.calc_period DESC, f.updated_at DESC
      ) AS rn
    FROM "{{catalog}}"."{{forecasting_database}}"."{{sales_forecast_table}}" f
    CROSS JOIN params p
    WHERE contains(p.company_ids, f.company_id)
      AND f.dataset <> 'actual'
  ) ranked
  WHERE rn = 1
),

forecast_latest_rows AS (
  SELECT
    f.company_id,
    f.inventory_id,
    f.forecast_period,
    f.units_sold
  FROM "{{catalog}}"."{{forecasting_database}}"."{{sales_forecast_table}}" f
  INNER JOIN forecast_latest_key k
    ON k.company_id = f.company_id
    AND k.inventory_id = f.inventory_id
    AND k.calc_period = f.calc_period
    AND k.updated_at = f.updated_at
),

forecast_item_plan AS (
  SELECT
    fr.company_id,
    fr.inventory_id,
    slice(
      array_agg(COALESCE(CAST(fr.units_sold AS DOUBLE), 0.0) ORDER BY fr.forecast_period),
      1, 12
    ) AS plan_monthly_units
  FROM forecast_latest_rows fr
  GROUP BY 1, 2
),

t_base AS (
  SELECT
    pil.company_id,
    pil.inventory_id,
    pil.sku,
    pil.country,
    pil.country_code,
    pil.child_asin,
    pil.parent_asin,
    pil.brand,
    pil.product_family,
    pil.asin_img_path,
    pil.product_name,
    pil.recommended_replenishment_qty AS recommended_by_amazon_replenishment_quantity,
    COALESCE(pil.fba_shipments_json, '[]') AS fba_shipments_json,

    -- Revenue proxy used for ABCD classification.
    COALESCE(CAST(pil.sales_last_30_days AS DOUBLE), 0.0) AS revenue_30d,

    p.sales_velocity AS selected_sales_velocity,
    COALESCE(pil.daily_unit_sales_target, 0) AS target_units_per_day,
    (
      p.weight_30d * COALESCE(pil.avg_units_30d, 0.0)
      + p.weight_7d * COALESCE(pil.avg_units_7d, 0.0)
      + p.weight_3d * COALESCE(pil.avg_units_3d, 0.0)
    ) AS current_units_per_day,
    COALESCE(fp.plan_monthly_units, CAST(ARRAY[] AS ARRAY(DOUBLE))) AS plan_monthly_units,

    (pil.inbound + pil.available + pil.fc_transfer + pil.fc_processing) AS total_fba_available_units,

    IF(p.override_default, p.fba_lead_time_days_override, pil.fba_lead_time_days) AS fba_lead_time_days,
    IF(p.override_default, p.fba_safety_stock_days_override, pil.fba_safety_stock_days) AS fba_safety_stock_days,

    CASE
      WHEN p.override_default THEN p.fba_lead_time_days_override + p.fba_safety_stock_days_override + p.days_between_shipments
      ELSE pil.fba_lead_time_days + pil.fba_safety_stock_days + p.days_between_shipments
    END AS target_coverage_days

  FROM "{{catalog}}"."{{database}}"."{{table}}" pil

  CROSS JOIN params p
  CROSS JOIN latest_snapshot s

  LEFT JOIN forecast_item_plan fp
    ON fp.company_id = pil.company_id
    AND fp.inventory_id = pil.inventory_id

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
    AND (cardinality(p.asins) = 0 OR contains(p.asins, pil.child_asin))
    AND (cardinality(p.parent_asins) = 0 OR contains(p.parent_asins, pil.parent_asin))
    AND (cardinality(p.brands) = 0 OR contains(p.brands, pil.brand))
    AND (cardinality(p.product_families) = 0 OR contains(p.product_families, pil.product_family))
    AND (
      cardinality(p.countries) = 0
      OR contains(p.countries, pil.country)
      OR contains(p.countries, pil.country_code)
    )

    -- planning_base behavior
    AND CASE
      WHEN p.planning_base = 'all' THEN TRUE
      WHEN p.planning_base = 'targeted only' AND pil.daily_unit_sales_target > 0 THEN TRUE
      WHEN p.planning_base = 'actively sold only' AND COALESCE(
        COALESCE(pil.avg_units_30d, 0.0),
        (COALESCE(pil.units_sold_last_30_days, 0) * 1.0 / 30.0),
        0.0
      ) >= p.active_sold_min_units_per_day THEN TRUE
      WHEN p.planning_base = 'planned only' AND fp.plan_monthly_units IS NOT NULL THEN TRUE
      ELSE FALSE
    END
),

-- Planned-velocity window, mirroring the QuickSight "60.0 Inventory Planning"
-- ArrivalMonthIndex / EffectiveCoverageMonths fields:
-- start the window at the month the replenishment arrives (FBA lead time), and
-- average over (fba_lead_time + fba_safety_stock) months, clamped to the plan length.
t_plan AS (
  SELECT
    b.*,
    LEAST(
      GREATEST(1, 1 + CAST(FLOOR((1.0 * b.fba_lead_time_days) / 30.0) AS INTEGER)),
      GREATEST(1, cardinality(b.plan_monthly_units))
    ) AS planned_arrival_month_index
  FROM t_base b
),

t_window AS (
  SELECT
    tp.*,
    GREATEST(
      1,
      LEAST(
        CAST(ROUND((1.0 * (tp.fba_lead_time_days + tp.fba_safety_stock_days)) / 30.41) AS INTEGER),
        cardinality(tp.plan_monthly_units) - tp.planned_arrival_month_index + 1
      )
    ) AS planned_window_months
  FROM t_plan tp
),

t AS (
  SELECT
    tw.*,
    -- sales_velocity semantics:
    -- - current: weighted blend of realized daily averages (defaults 0.5*30d + 0.3*7d + 0.2*3d,
    --   overridable via velocity_weighting)
    -- - target: daily_unit_sales_target (already units/day)
    -- - planned: avg units/day over the coverage window (fba lead+safety months)
    --   starting at the arrival month (1 + floor(fba_lead_time_days/30))
    CAST(
      CASE tw.selected_sales_velocity
        WHEN 'target' THEN tw.target_units_per_day
        WHEN 'current' THEN tw.current_units_per_day
        WHEN 'planned' THEN (
          COALESCE(
            reduce(
              slice(tw.plan_monthly_units, tw.planned_arrival_month_index, tw.planned_window_months),
              0.0,
              (s, x) -> s + COALESCE(x, 0.0),
              s -> s
            ),
            0.0
          ) / (tw.planned_window_months * 30.41)
        )
        ELSE tw.current_units_per_day
      END
    AS DOUBLE) AS sales_velocity
  FROM t_window tw
),

t_classed AS (
  SELECT
    t.*,
    CASE
      WHEN SUM(t.revenue_30d) OVER (PARTITION BY t.company_id, t.country_code) <= 0 THEN 'D'
      WHEN (
        SUM(t.revenue_30d) OVER (
          PARTITION BY t.company_id, t.country_code
          ORDER BY t.revenue_30d DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )
        / NULLIF(SUM(t.revenue_30d) OVER (PARTITION BY t.company_id, t.country_code), 0)
      ) <= 0.80 THEN 'A'
      WHEN (
        SUM(t.revenue_30d) OVER (
          PARTITION BY t.company_id, t.country_code
          ORDER BY t.revenue_30d DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )
        / NULLIF(SUM(t.revenue_30d) OVER (PARTITION BY t.company_id, t.country_code), 0)
      ) <= 0.95 THEN 'B'
      WHEN (
        SUM(t.revenue_30d) OVER (
          PARTITION BY t.company_id, t.country_code
          ORDER BY t.revenue_30d DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )
        / NULLIF(SUM(t.revenue_30d) OVER (PARTITION BY t.company_id, t.country_code), 0)
      ) <= 0.99 THEN 'C'
      ELSE 'D'
    END AS revenue_abcd_class
    ,
    CASE
      WHEN SUM(t.revenue_30d) OVER (PARTITION BY t.company_id, t.country_code) <= 0 THEN 'C'
      WHEN (
        SUM(t.revenue_30d) OVER (
          PARTITION BY t.company_id, t.country_code
          ORDER BY t.revenue_30d DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )
        / NULLIF(SUM(t.revenue_30d) OVER (PARTITION BY t.company_id, t.country_code), 0)
      ) <= 0.80 THEN 'A'
      WHEN (
        SUM(t.revenue_30d) OVER (
          PARTITION BY t.company_id, t.country_code
          ORDER BY t.revenue_30d DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )
        / NULLIF(SUM(t.revenue_30d) OVER (PARTITION BY t.company_id, t.country_code), 0)
      ) <= 0.95 THEN 'B'
      ELSE 'C'
    END AS pareto_abc_class
  FROM t
)

SELECT
  -- company
  t.company_id AS company_id,
  t.revenue_abcd_class AS revenue_abcd_class,
  CASE t.revenue_abcd_class
    WHEN 'A' THEN 'Top 80% of 30d revenue (cumulative)'
    WHEN 'B' THEN 'Next 15% of 30d revenue (80%–95% cumulative)'
    WHEN 'C' THEN 'Next 4% of 30d revenue (95%–99% cumulative)'
    ELSE 'Remaining / no revenue (bottom 1%+ or zero)'
  END AS revenue_abcd_class_description,
  t.pareto_abc_class AS pareto_abc_class,
  t.child_asin AS child_asin,
  t.parent_asin AS parent_asin,
  t.brand AS brand,
  t.product_family AS product_family,
  t.fba_shipments_json AS fba_shipments_json,

  -- item_ref
  t.inventory_id AS item_ref_inventory_id,
  t.sku AS item_ref_sku,
  t.child_asin AS item_ref_asin,
  t.country_code AS item_ref_marketplace,
  t.product_name AS item_ref_item_name,
  t.asin_img_path AS item_ref_item_icon_url,

  -- metrics
  t.sales_velocity AS sales_velocity,
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

  -- days_overdue: synonym for shipment_overdue_days.
  CASE
    WHEN t.sales_velocity > 0 THEN GREATEST(
      CAST(0 AS BIGINT),
      -(
        CAST(ROUND(t.total_fba_available_units * 1.0 / t.sales_velocity) AS BIGINT)
        - CAST(t.target_coverage_days AS BIGINT)
      )
    )
    ELSE NULL
  END AS days_overdue,

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
  CAST('Based on buffer coverage: days_of_supply vs (lead_time + safety_stock + reorder cadence). reorder cadence = days_between_shipments. shipment_overdue_days > 0 means replenishment was due in the past. recommended_ship_units is computed from our planning params (not Amazon). If you need Amazon''s recommendation, use recommended_by_amazon_replenishment_quantity. planned sales_velocity averages the sales plan over the coverage window (fba_lead_time+fba_safety_stock months of ~30.41 days) starting at the arrival month (1+floor(fba_lead_time_days/30)), matching the 60.0 Inventory Planning QuickSight analysis. current sales_velocity = weighted blend of realized daily averages: {{weight_30d}}*avg_30d + {{weight_7d}}*avg_7d + {{weight_3d}}*avg_3d (override via velocity_weighting; use 1/0/0 to match the QuickSight 30-day average).' AS VARCHAR) AS reason

FROM t_classed t
CROSS JOIN params p

WHERE
  (cardinality(p.revenue_abcd_classes) = 0 OR contains(p.revenue_abcd_classes, t.revenue_abcd_class))

ORDER BY shipment_overdue_days DESC
LIMIT {{limit_top_n}};
