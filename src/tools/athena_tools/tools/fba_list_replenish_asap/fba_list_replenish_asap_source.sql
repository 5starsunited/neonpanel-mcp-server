SELECT
    t.inventory_id,
    t.company_name,
    t.company_short_name,
    t.company_uuid,
    t.sku,
    t.country,
    t.sales_velocity,
    t.total_fba_available_units,
    t.fba_lead_time_days,
    t.fba_safety_stock_days,
    t.asin_img_path,
    t.product_name,
    t.recommended_replenishment_qty,

    CASE
        WHEN t.sales_velocity > 0
        THEN ROUND(t.total_fba_available_units * 1.0 / t.sales_velocity)
        ELSE NULL
    END AS fba_days_of_supply,

    CASE
        WHEN t.sales_velocity > 0
        THEN date_add(
            'day',
            CAST(ROUND(t.total_fba_available_units * 1.0 / t.sales_velocity) AS INTEGER),
            CAST(now() AS DATE)  -- or current_date
        )
        ELSE NULL
    END AS fba_replenishment_due_date

FROM (
    SELECT
        pil.inventory_id,
        pil.company_name,
        pil.company_short_name,
        pil.company_uuid,
        pil.sku,
        pil.country,
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

        pil.asin_img_path,
        pil.product_name,
        pil.recommended_replenishment_qty

    FROM inventory_planning_snapshot pil

    -- Latest snapshot only: inventory_planning_snapshot is partitioned by (company_id, year, month, day).
    -- This picks the most recent (year,month,day) available for the requested company_ids.
    CROSS JOIN (
        SELECT year, month, day
        FROM inventory_planning_snapshot
        WHERE company_id IN ('106')
        GROUP BY 1, 2, 3
        ORDER BY CAST(year AS INTEGER) DESC, CAST(month AS INTEGER) DESC, CAST(day AS INTEGER) DESC
        LIMIT 1
    ) latest

    CROSS JOIN (
        SELECT
            'planned' AS sales_velocity,                 -- target | current | planned
            'actively sold only' AS planning_base,       -- all | targeted only | actively sold only | planned only
            TRUE  AS override_default,
            FALSE AS use_seasonality,
            12    AS fba_lead_time_days_override,
            60    AS fba_safety_stock_days_override,
            20 as top_results,
            -- REQUIRED (multi)
            CAST(ARRAY['106'] AS ARRAY(VARCHAR)) AS company_ids,

            -- OPTIONAL (empty => no filter)
            CAST(ARRAY[] AS ARRAY(VARCHAR)) AS skus,
            CAST(ARRAY[] AS ARRAY(BIGINT))  AS inventory_ids,
            CAST(ARRAY[] AS ARRAY(VARCHAR)) AS countries
    ) p

    WHERE
        -- REQUIRED company filter (no subquery)
        contains(p.company_ids, pil.company_id)

        AND pil.year = latest.year
        AND pil.month = latest.month
        AND pil.day = latest.day

        -- OPTIONAL filters (no subqueries)
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
) t

ORDER BY fba_replenishment_due_date ASC
LIMIT {{limit_top_n}};
