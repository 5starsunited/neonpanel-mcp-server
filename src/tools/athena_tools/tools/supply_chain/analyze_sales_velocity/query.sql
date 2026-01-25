-- Tool: supply_chain_analyze_sales_velocity
-- Purpose: analyze sales velocity across realized signals and sales plan, compute derived metrics,
--          detect inconsistencies, and recommend velocities for replenishment + PO placement.
-- Notes:
-- - company_id filtering is REQUIRED for authorization + partition pruning.
-- - This query filters to the latest (year,month,day) partition for the permitted company_ids.

WITH params AS (
  SELECT
    {{company_ids_array}} AS company_ids,

    -- OPTIONAL filters (empty array => no filter)
    {{skus_array}} AS skus,
    {{asins_array}} AS asins,
    {{parent_asins_array}} AS parent_asins,
    {{brands_array}} AS brands,
    {{product_families_array}} AS product_families,
    {{marketplaces_array}} AS marketplaces,
    {{revenue_abcd_classes_array}} AS revenue_abcd_classes,

    -- knobs
    CAST({{traffic_weight_3d}} AS DOUBLE) AS traffic_weight_3d,
    CAST({{traffic_weight_7d}} AS DOUBLE) AS traffic_weight_7d,
    CAST({{traffic_weight_30d}} AS DOUBLE) AS traffic_weight_30d,
    {{coverage_days_override_sql}} AS coverage_days_override
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
    pil.company_id,
    pil.inventory_id,
    pil.sku,
    pil.country_code,
    pil.child_asin,
    pil.parent_asin,
    pil.brand,
    pil.product_family,
    pil.asin_img_path,
    pil.product_name,

    pil.year,
    pil.month,
    pil.day,

    pil.lead_time_days,
    pil.safety_stock_days,

    -- realized sales signals (units/day)
    COALESCE(CAST(pil.avg_units_3d AS DOUBLE), 0.0) AS traffic_3d,
    COALESCE(CAST(pil.avg_units_7d AS DOUBLE), 0.0) AS traffic_7d,
    COALESCE(
      CAST(pil.avg_units_30d AS DOUBLE),
      (COALESCE(pil.units_sold_last_30_days, 0) * 1.0 / 30.0),
      0.0
    ) AS traffic_30d,

    -- restock_30d: fallback realized velocity derived from 30d unit totals.
    COALESCE(
      (COALESCE(pil.units_sold_last_30_days, 0) * 1.0 / 30.0),
      CAST(pil.avg_units_30d AS DOUBLE),
      0.0
    ) AS restock_30d,

    COALESCE(CAST(pil.units_sold_last_30_days AS DOUBLE), 0.0) AS units_sold_last_30_days,

    -- Revenue proxy used for ABCD classification.
    COALESCE(CAST(pil.sales_last_30_days AS DOUBLE), 0.0) AS revenue_30d,

    -- Parse monthly sales plan into an array of monthly units (doubles).
    transform(
      COALESCE(
        TRY(CAST(json_parse(pil.next_12_month_sales_plan_units) AS ARRAY(JSON))),
        CAST(ARRAY[] AS ARRAY(JSON))
      ),
      m -> COALESCE(TRY(CAST(json_extract_scalar(m, '$.units_sold') AS DOUBLE)), 0.0)
    ) AS plan_monthly_units

  FROM "{{catalog}}"."{{database}}"."{{table}}" pil

  CROSS JOIN params p
  CROSS JOIN latest_snapshot s

  WHERE
    contains(p.company_ids, pil.company_id)

    AND pil.year = s.year
    AND pil.month = s.month
    AND pil.day = s.day

    AND (cardinality(p.skus) = 0 OR contains(p.skus, pil.sku))
    AND (cardinality(p.asins) = 0 OR contains(p.asins, pil.child_asin))
    AND (cardinality(p.parent_asins) = 0 OR contains(p.parent_asins, pil.parent_asin))
    AND (cardinality(p.brands) = 0 OR contains(p.brands, pil.brand))
    AND (cardinality(p.product_families) = 0 OR contains(p.product_families, pil.product_family))
    AND (cardinality(p.marketplaces) = 0 OR contains(p.marketplaces, pil.country_code))
),

t_classed AS (
  SELECT
    b.*,
    CASE
      WHEN SUM(b.revenue_30d) OVER (PARTITION BY b.company_id, b.country_code) <= 0 THEN 'D'
      WHEN (
        SUM(b.revenue_30d) OVER (
          PARTITION BY b.company_id, b.country_code
          ORDER BY b.revenue_30d DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )
        / NULLIF(SUM(b.revenue_30d) OVER (PARTITION BY b.company_id, b.country_code), 0)
      ) <= 0.80 THEN 'A'
      WHEN (
        SUM(b.revenue_30d) OVER (
          PARTITION BY b.company_id, b.country_code
          ORDER BY b.revenue_30d DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )
        / NULLIF(SUM(b.revenue_30d) OVER (PARTITION BY b.company_id, b.country_code), 0)
      ) <= 0.95 THEN 'B'
      WHEN (
        SUM(b.revenue_30d) OVER (
          PARTITION BY b.company_id, b.country_code
          ORDER BY b.revenue_30d DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )
        / NULLIF(SUM(b.revenue_30d) OVER (PARTITION BY b.company_id, b.country_code), 0)
      ) <= 0.99 THEN 'C'
      ELSE 'D'
    END AS revenue_abcd_class
  FROM t_base b
),

t AS (
  SELECT
    c.*,

    -- derived metric: weighted recent realized velocity
    (
      (c.traffic_3d * p.traffic_weight_3d)
      + (c.traffic_7d * p.traffic_weight_7d)
      + (c.traffic_30d * p.traffic_weight_30d)
    ) AS traffic_weighted_recent,

    -- planning horizon (days)
    CAST(
      CASE
        WHEN p.coverage_days_override IS NOT NULL THEN p.coverage_days_override
        ELSE COALESCE(c.lead_time_days, 0) + COALESCE(c.safety_stock_days, 0)
      END
    AS DOUBLE) AS planning_horizon_days,

    -- planned demand over the planning_horizon_days starting now.
    (
      COALESCE(
        reduce(
          slice(
            c.plan_monthly_units,
            1,
            CAST(FLOOR(
              CAST(
                CASE
                  WHEN p.coverage_days_override IS NOT NULL THEN p.coverage_days_override
                  ELSE COALESCE(c.lead_time_days, 0) + COALESCE(c.safety_stock_days, 0)
                END
              AS DOUBLE) / 30.0
            ) AS INTEGER)
          ),
          0.0,
          (s, x) -> s + x,
          s -> s
        ),
        0.0
      )
      + (
        (
          CAST(
            CASE
              WHEN p.coverage_days_override IS NOT NULL THEN p.coverage_days_override
              ELSE COALESCE(c.lead_time_days, 0) + COALESCE(c.safety_stock_days, 0)
            END
          AS DOUBLE)
          - (30.0 * CAST(FLOOR(
            CAST(
              CASE
                WHEN p.coverage_days_override IS NOT NULL THEN p.coverage_days_override
                ELSE COALESCE(c.lead_time_days, 0) + COALESCE(c.safety_stock_days, 0)
              END
            AS DOUBLE) / 30.0
          ) AS INTEGER))
        ) / 30.0
      )
      * COALESCE(
        element_at(
          c.plan_monthly_units,
          1 + CAST(FLOOR(
            CAST(
              CASE
                WHEN p.coverage_days_override IS NOT NULL THEN p.coverage_days_override
                ELSE COALESCE(c.lead_time_days, 0) + COALESCE(c.safety_stock_days, 0)
              END
            AS DOUBLE) / 30.0
          ) AS INTEGER)
        ),
        0.0
      )
    ) AS plan_horizon_total_units,

    CASE
      WHEN (
        CASE
          WHEN p.coverage_days_override IS NOT NULL THEN p.coverage_days_override
          ELSE COALESCE(c.lead_time_days, 0) + COALESCE(c.safety_stock_days, 0)
        END
      ) > 0 THEN (
        (
          COALESCE(
            reduce(
              slice(
                c.plan_monthly_units,
                1,
                CAST(FLOOR(
                  CAST(
                    CASE
                      WHEN p.coverage_days_override IS NOT NULL THEN p.coverage_days_override
                      ELSE COALESCE(c.lead_time_days, 0) + COALESCE(c.safety_stock_days, 0)
                    END
                  AS DOUBLE) / 30.0
                ) AS INTEGER)
              ),
              0.0,
              (s, x) -> s + x,
              s -> s
            ),
            0.0
          )
          + (
            (
              CAST(
                CASE
                  WHEN p.coverage_days_override IS NOT NULL THEN p.coverage_days_override
                  ELSE COALESCE(c.lead_time_days, 0) + COALESCE(c.safety_stock_days, 0)
                END
              AS DOUBLE)
              - (30.0 * CAST(FLOOR(
                CAST(
                  CASE
                    WHEN p.coverage_days_override IS NOT NULL THEN p.coverage_days_override
                    ELSE COALESCE(c.lead_time_days, 0) + COALESCE(c.safety_stock_days, 0)
                  END
                AS DOUBLE) / 30.0
              ) AS INTEGER))
            ) / 30.0
          )
          * COALESCE(
            element_at(
              c.plan_monthly_units,
              1 + CAST(FLOOR(
                CAST(
                  CASE
                    WHEN p.coverage_days_override IS NOT NULL THEN p.coverage_days_override
                    ELSE COALESCE(c.lead_time_days, 0) + COALESCE(c.safety_stock_days, 0)
                  END
                AS DOUBLE) / 30.0
              ) AS INTEGER)
            ),
            0.0
          )
        ) / CAST(
          CASE
            WHEN p.coverage_days_override IS NOT NULL THEN p.coverage_days_override
            ELSE COALESCE(c.lead_time_days, 0) + COALESCE(c.safety_stock_days, 0)
          END
        AS DOUBLE)
      )
      ELSE 0.0
    END AS plan_horizon_units_per_day,

    -- first 5 planned months (monthly units) + computed yyyy-mm labels
    COALESCE(element_at(c.plan_monthly_units, 1), 0.0) AS plan_month_1_units,
    COALESCE(element_at(c.plan_monthly_units, 2), 0.0) AS plan_month_2_units,
    COALESCE(element_at(c.plan_monthly_units, 3), 0.0) AS plan_month_3_units,
    COALESCE(element_at(c.plan_monthly_units, 4), 0.0) AS plan_month_4_units,
    COALESCE(element_at(c.plan_monthly_units, 5), 0.0) AS plan_month_5_units,

    date_format(date_add('month', 0, current_date), '%Y-%m') AS plan_month_1_yyyy_mm,
    date_format(date_add('month', 1, current_date), '%Y-%m') AS plan_month_2_yyyy_mm,
    date_format(date_add('month', 2, current_date), '%Y-%m') AS plan_month_3_yyyy_mm,
    date_format(date_add('month', 3, current_date), '%Y-%m') AS plan_month_4_yyyy_mm,
    date_format(date_add('month', 4, current_date), '%Y-%m') AS plan_month_5_yyyy_mm

  FROM t_classed c
  CROSS JOIN params p
)

SELECT
  -- item identity
  t.company_id AS company_id,
  t.inventory_id AS item_ref_inventory_id,
  t.sku AS item_ref_sku,
  t.child_asin AS item_ref_asin,
  t.country_code AS item_ref_marketplace,
  t.product_name AS item_ref_item_name,
  t.asin_img_path AS item_ref_item_icon_url,

  -- filter fields
  t.child_asin AS child_asin,
  t.parent_asin AS parent_asin,
  t.brand AS brand,
  t.product_family AS product_family,
  t.revenue_abcd_class AS revenue_abcd_class,

  -- realized velocity signals
  t.traffic_3d AS traffic_3d,
  t.traffic_7d AS traffic_7d,
  t.traffic_30d AS traffic_30d,
  t.restock_30d AS restock_30d,
  t.traffic_weighted_recent AS traffic_weighted_recent,
  t.units_sold_last_30_days AS units_sold_last_30_days,

  -- plan time series (monthly units)
  t.plan_month_1_yyyy_mm AS plan_month_1_yyyy_mm,
  t.plan_month_1_units AS plan_month_1_units,
  t.plan_month_2_yyyy_mm AS plan_month_2_yyyy_mm,
  t.plan_month_2_units AS plan_month_2_units,
  t.plan_month_3_yyyy_mm AS plan_month_3_yyyy_mm,
  t.plan_month_3_units AS plan_month_3_units,
  t.plan_month_4_yyyy_mm AS plan_month_4_yyyy_mm,
  t.plan_month_4_units AS plan_month_4_units,
  t.plan_month_5_yyyy_mm AS plan_month_5_yyyy_mm,
  t.plan_month_5_units AS plan_month_5_units,

  -- plan-derived horizon metrics
  CAST(t.planning_horizon_days AS BIGINT) AS planning_horizon_days,
  t.plan_horizon_total_units AS plan_horizon_total_units,
  t.plan_horizon_units_per_day AS plan_horizon_units_per_day,

  -- raw parameters
  t.lead_time_days AS lead_time_days,
  t.safety_stock_days AS safety_stock_days,

  t.year AS snapshot_year,
  t.month AS snapshot_month,
  t.day AS snapshot_day

FROM t

WHERE
  (cardinality({{revenue_abcd_classes_array}}) = 0 OR contains({{revenue_abcd_classes_array}}, t.revenue_abcd_class))

ORDER BY t.company_id, t.country_code, t.revenue_30d DESC

LIMIT {{limit_top_n}};
