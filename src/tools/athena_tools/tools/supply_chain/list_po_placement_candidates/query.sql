-- Tool: supply_chain_list_po_placement_candidates
-- Purpose: decide when a purchase order (PO) is due to maintain coverage through
--          (lead_time + safety_stock + PO cadence), using the latest snapshot partition.
-- Notes:
-- - company_id filtering is REQUIRED for authorization + partition pruning.
-- - available inventory = total_balance_quantity + total_ordered_quantity + available
--   (do NOT count inbound; inbound is represented in warehouse balances as "In Transfer").

WITH params AS (
  SELECT
    {{sales_velocity_sql}} AS sales_velocity,
    {{planning_base_sql}} AS planning_base,
    {{override_default_sql}} AS override_default,
    {{use_seasonality_sql}} AS use_seasonality,
    {{lead_time_days_override}} AS lead_time_days_override,
    {{safety_stock_days_override}} AS safety_stock_days_override,
    {{days_between_pos}} AS days_between_pos,
    CAST({{active_sold_min_units_per_day}} AS DOUBLE) AS active_sold_min_units_per_day,
    {{limit_top_n}} AS top_results,
    {{include_work_in_progress}} AS include_work_in_progress,

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

t_base AS (
  SELECT
    p.sales_velocity AS selected_sales_velocity,
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

    -- Revenue proxy used for ABCD classification.
    COALESCE(CAST(pil.sales_last_30_days AS DOUBLE), 0.0) AS revenue_30d,

    COALESCE(pil.daily_unit_sales_target, 0) AS target_units_per_day,
    -- avg_units_30d is a daily average.
    -- units_sold_last_30_days is a 30-day total; convert to a daily rate.
    COALESCE(
      COALESCE(pil.avg_units_30d, 0.0),
      (COALESCE(pil.units_sold_last_30_days, 0) * 1.0 / 30.0),
      0.0
    ) AS current_units_per_day,

    -- Parse monthly sales plan into an array of monthly units (doubles).
    -- Notes:
    -- - next_12_month_sales_plan_units is a JSON string.
    -- - Each element contains units_sold for a month (monthly units, NOT daily).
    transform(
      COALESCE(
        TRY(CAST(json_parse(pil.next_12_month_sales_plan_units) AS ARRAY(JSON))),
        CAST(ARRAY[] AS ARRAY(JSON))
      ),
      m -> COALESCE(TRY(CAST(json_extract_scalar(m, '$.units_sold') AS DOUBLE)), 0.0)
    ) AS plan_monthly_units,

    (
      COALESCE(CAST(pil.total_balance_quantity AS DOUBLE), 0.0)
      + COALESCE(CAST(pil.total_ordered_quantity AS DOUBLE), 0.0)
      + COALESCE(CAST(pil.available AS DOUBLE), 0.0)
      + CASE WHEN p.include_work_in_progress THEN COALESCE(CAST(pil.wip_total_ordered_quantity AS DOUBLE), 0.0) ELSE 0.0 END
    ) AS total_available_inventory_units,

    IF(p.override_default, p.lead_time_days_override, pil.lead_time_days) AS lead_time_days,
    IF(p.override_default, p.safety_stock_days_override, pil.safety_stock_days) AS safety_stock_days,

    CASE
      WHEN p.override_default THEN p.lead_time_days_override + p.safety_stock_days_override + p.days_between_pos
      ELSE pil.lead_time_days + pil.safety_stock_days + p.days_between_pos
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
      WHEN p.planning_base = 'planned only' AND pil.next_12_month_sales_plan_units IS NOT NULL THEN TRUE
      ELSE FALSE
    END
),

t AS (
  SELECT
    b.company_id,
    b.inventory_id,
    b.sku,
    b.country,
    b.country_code,
    b.child_asin,
    b.parent_asin,
    b.brand,
    b.product_family,
    b.asin_img_path,
    b.product_name,
    b.revenue_30d,
    b.selected_sales_velocity,
    b.target_units_per_day,
    b.current_units_per_day,
    b.plan_monthly_units,
    b.total_available_inventory_units,
    b.lead_time_days,
    b.safety_stock_days,
    b.target_coverage_days,

    -- planned arrival month index (1-based for element_at), based on lead time.
    LEAST(
      GREATEST(
        1,
        1 + CAST(FLOOR((1.0 * b.lead_time_days) / 30.0) AS INTEGER)
      ),
      GREATEST(1, cardinality(b.plan_monthly_units))
    ) AS planned_arrival_month_index,

    -- planned daily velocity for the arrival month.
    (COALESCE(element_at(b.plan_monthly_units, LEAST(GREATEST(1, 1 + CAST(FLOOR((1.0 * b.lead_time_days) / 30.0) AS INTEGER)), GREATEST(1, cardinality(b.plan_monthly_units)))), 0.0) / 30.0)
      AS planned_arrival_daily_units,

    -- planned demand over the next target_coverage_days starting now.
    -- Approximation: full months + fractional remainder month.
    (
      COALESCE(
        reduce(
          slice(
            b.plan_monthly_units,
            1,
            CAST(FLOOR(CAST(b.target_coverage_days AS DOUBLE) / 30.0) AS INTEGER)
          ),
          0.0,
          (s, x) -> s + x,
          s -> s
        ),
        0.0
      )
      + (
        (
          CAST(b.target_coverage_days AS DOUBLE)
          - (30.0 * CAST(FLOOR(CAST(b.target_coverage_days AS DOUBLE) / 30.0) AS INTEGER))
        ) / 30.0
      )
      * COALESCE(
        element_at(
          b.plan_monthly_units,
          1 + CAST(FLOOR(CAST(b.target_coverage_days AS DOUBLE) / 30.0) AS INTEGER)
        ),
        0.0
      )
    ) AS planned_window_units,

    -- sales_velocity semantics:
    -- - current: avg units/day over the last 30 days
    -- - target: daily_unit_sales_target (already units/day)
    -- - planned: arrival-month units/day (arrival month = floor(lead_time_days/30))
    CAST(
      CASE b.selected_sales_velocity
        WHEN 'target' THEN b.target_units_per_day
        WHEN 'current' THEN b.current_units_per_day
        WHEN 'planned' THEN (COALESCE(element_at(b.plan_monthly_units, LEAST(GREATEST(1, 1 + CAST(FLOOR((1.0 * b.lead_time_days) / 30.0) AS INTEGER)), GREATEST(1, cardinality(b.plan_monthly_units)))), 0.0) / 30.0)
        ELSE b.current_units_per_day
      END
    AS DOUBLE) AS sales_velocity,

    -- Diagnostic fields for velocity calculation transparency
    b.selected_sales_velocity AS velocity_calculation_method,
    
    -- For 'planned' mode: show which forecast month was used
    CASE 
      WHEN b.selected_sales_velocity = 'planned' THEN 
        1 + CAST(FLOOR((1.0 * b.lead_time_days) / 30.0) AS INTEGER)
      ELSE NULL
    END AS forecast_month_index,
    
    -- For 'planned' mode: show raw forecast units extracted before dividing by 30
    CASE 
      WHEN b.selected_sales_velocity = 'planned' THEN 
        COALESCE(
          element_at(
            b.plan_monthly_units, 
            LEAST(
              GREATEST(1, 1 + CAST(FLOOR((1.0 * b.lead_time_days) / 30.0) AS INTEGER)), 
              GREATEST(1, cardinality(b.plan_monthly_units))
            )
          ), 
          0.0
        )
      ELSE NULL
    END AS forecast_units_extracted

  FROM t_base b
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
    WHEN t.sales_velocity > 0 THEN CAST(ROUND(t.total_available_inventory_units * 1.0 / t.sales_velocity) AS BIGINT)
    ELSE NULL
  END AS po_days_of_supply,

  CAST(ROUND(t.total_available_inventory_units) AS BIGINT) AS available_inventory_units,

  CAST(t.lead_time_days AS BIGINT) AS lead_time_days,
  CAST(t.safety_stock_days AS BIGINT) AS safety_stock_days,
  CAST(t.target_coverage_days AS BIGINT) AS target_coverage_days,

  -- Velocity calculation transparency fields
  CAST(t.velocity_calculation_method AS VARCHAR) AS velocity_calculation_method,
  CAST(t.sales_velocity AS DOUBLE) AS velocity_units_per_day,
  CAST(t.forecast_month_index AS BIGINT) AS forecast_month_index,
  CAST(t.forecast_units_extracted AS DOUBLE) AS forecast_units_extracted,

  -- po_due_in_days: when you should place a PO next to maintain lead_time+safety_stock buffer + PO cadence.
  -- negative => overdue, positive => due in future.
  CASE
    WHEN t.sales_velocity > 0 THEN (
      CAST(ROUND(t.total_available_inventory_units * 1.0 / t.sales_velocity) AS BIGINT)
      - CAST(t.target_coverage_days AS BIGINT)
    )
    ELSE NULL
  END AS po_due_in_days,

  -- po_overdue_days: positive days overdue, else 0.
  CASE
    WHEN t.sales_velocity > 0 THEN GREATEST(
      CAST(0 AS BIGINT),
      -(
        CAST(ROUND(t.total_available_inventory_units * 1.0 / t.sales_velocity) AS BIGINT)
        - CAST(t.target_coverage_days AS BIGINT)
      )
    )
    ELSE NULL
  END AS po_overdue_days,

  -- po_due_date: clamped to today if overdue.
  CASE
    WHEN t.sales_velocity > 0 THEN date_add(
      'day',
      GREATEST(
        CAST(0 AS BIGINT),
        (
          CAST(ROUND(t.total_available_inventory_units * 1.0 / t.sales_velocity) AS BIGINT)
          - CAST(t.target_coverage_days AS BIGINT)
        )
      ),
      CURRENT_DATE
    )
    ELSE NULL
  END AS po_due_date,

  -- recommended_order_units semantics:
  -- - planned: size the order to cover the full coverage window starting now, using summed monthly plan units
  -- - other modes: size using daily velocity approximation
  CASE
    WHEN t.sales_velocity <= 0 THEN CAST(0 AS BIGINT)
    WHEN t.selected_sales_velocity = 'planned' THEN (
      CAST(
        CEIL(
          GREATEST(
            0.0,
            t.planned_window_units - CAST(t.total_available_inventory_units AS DOUBLE)
          )
        )
      AS BIGINT)
    )
    ELSE (
      CAST(
        GREATEST(
          0.0,
          CEIL(
            (CAST(t.target_coverage_days AS DOUBLE) * t.sales_velocity)
            - CAST(t.total_available_inventory_units AS DOUBLE)
          )
        )
      AS BIGINT)
    )
  END AS recommended_order_units,

  -- priority/reason (draft)
  CASE
    WHEN t.sales_velocity <= 0 THEN 'low'
    WHEN (
      CAST(ROUND(t.total_available_inventory_units * 1.0 / t.sales_velocity) AS BIGINT)
      - CAST(t.target_coverage_days AS BIGINT)
    ) <= CAST({{stockout_threshold_days}} AS BIGINT) THEN 'critical'
    ELSE 'high'
  END AS priority,
  CAST(
    'Based on PO buffer coverage: days_of_supply vs (lead_time + safety_stock + PO cadence). PO cadence = days_between_pos. po_overdue_days > 0 means the PO was due in the past. available_inventory_units = total_balance_quantity + total_ordered_quantity + available + (conditionally) wip_total_ordered_quantity. WIP orders are included by default (include_work_in_progress=true) to prevent double-ordering. Amazon FBA warehouses are excluded from warehouse_balance_details_json to prevent double-counting with available field (from Amazon Restock Report). planned sales_velocity uses the arrival-month rate (month index=floor(lead_time_days/30)); planned recommended_order_units sums the sales plan across the full coverage window starting now.'
  AS VARCHAR) AS reason

FROM t_classed t
CROSS JOIN params p

WHERE
  (cardinality(p.revenue_abcd_classes) = 0 OR contains(p.revenue_abcd_classes, t.revenue_abcd_class))

ORDER BY po_overdue_days DESC
LIMIT {{limit_top_n}};
