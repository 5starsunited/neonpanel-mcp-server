-- Stock Replenishment Risk Analysis Tool - Test Query
-- Company: 106, Marketplace: US, Limit: 50
-- Rendered parameters for direct testing in Athena UI

WITH params AS (
  SELECT
    CAST(ARRAY[106] AS ARRAY(BIGINT)) AS company_ids,
    CAST(ARRAY[] AS ARRAY(VARCHAR)) AS skus,
    CAST(ARRAY[] AS ARRAY(VARCHAR)) AS inventory_ids,
    CAST(ARRAY[] AS ARRAY(VARCHAR)) AS asins,
    CAST(ARRAY[] AS ARRAY(VARCHAR)) AS parent_asins,
    CAST(ARRAY[] AS ARRAY(VARCHAR)) AS brands,
    CAST(ARRAY[] AS ARRAY(VARCHAR)) AS product_families,
    CAST(ARRAY['US'] AS ARRAY(VARCHAR)) AS countries,
    CAST(ARRAY[] AS ARRAY(VARCHAR)) AS revenue_abcd_classes,
    
    -- Risk analysis parameters
    CAST(28 AS INTEGER) AS min_days_of_supply,
    CAST(0 AS INTEGER) AS p80_arrival_buffer_days,
    CAST(TRUE AS BOOLEAN) AS include_warehouse_stock,
    CAST(TRUE AS BOOLEAN) AS include_inbound_details,
    CAST(ARRAY[] AS ARRAY(VARCHAR)) AS stockout_risk_filter,
    CAST(ARRAY[] AS ARRAY(VARCHAR)) AS supply_buffer_risk_filter,
    
    -- Velocity weighting (balanced mode: 0.5/0.3/0.2) - storing as separate columns for test
    0.5 AS w30d,
    0.3 AS w7d,
    0.2 AS w3d,
    
    CAST(50 AS INTEGER) AS limit_results,
    CAST(NULL AS VARCHAR) AS sort_field,
    CAST('asc' AS VARCHAR) AS sort_direction
),

latest_snapshot AS (
  -- Get latest snapshot partition for authorized companies.
  SELECT year, month, day
  FROM "inventory_planning"."inventory_planning_snapshot_iceberg"
  WHERE company_id IN (SELECT DISTINCT company_id FROM "inventory_planning"."inventory_planning_snapshot_iceberg" WHERE company_id > 0)
  GROUP BY year, month, day
  ORDER BY CAST(year AS INTEGER) DESC, CAST(month AS INTEGER) DESC, CAST(day AS INTEGER) DESC
  LIMIT 1
),

inventory_base AS (
  -- Join snapshot with warehouse stock and apply filters.
  SELECT
    s.company_id,
    s.inventory_id,
    s.sku,
    s.country_code,
    s.child_asin,
    s.parent_asin,
    s.brand,
    s.product_family,
    s.product_name,
    
    -- FBA stock components
    COALESCE(s.inbound, 0) AS fba_inbound,
    COALESCE(s.available, 0) AS fba_available,
    COALESCE(s.fc_transfer, 0) AS fba_fc_transfer,
    COALESCE(s.fc_processing, 0) AS fba_fc_processing,
    (COALESCE(s.available, 0) + COALESCE(s.fc_transfer, 0) + COALESCE(s.fc_processing, 0)) AS current_fba_stock,
    
    -- Warehouse stock (aggregated from warehouse_balance_details_json)
    COALESCE(SUM(CAST(json_extract_scalar(warehouse, '$.balance_quantity') AS BIGINT)), 0) AS warehouse_stock,
    
    -- Sales velocity (precalculated windows)
    COALESCE(CAST(s.avg_units_30d AS DOUBLE), 0.0) AS sales_velocity_30d,
    COALESCE(CAST(s.avg_units_7d AS DOUBLE), 0.0) AS sales_velocity_7d,
    COALESCE(CAST(s.avg_units_3d AS DOUBLE), 0.0) AS sales_velocity_3d,
    
    -- Revenue for ABCD classification
    COALESCE(CAST(s.sales_last_30_days AS DOUBLE), 0.0) AS revenue_30d,
    s.revenue_abcd_class,
    
    -- Inbound shipments (JSON array of {p50_days, p80_days, p95_days, units_shipped, shipped_at})
    COALESCE(s.fba_shipments_json, '[]') AS fba_shipments_json
    
  FROM "inventory_planning"."inventory_planning_snapshot_iceberg" s
  CROSS JOIN latest_snapshot ls
  CROSS JOIN params p
  LEFT JOIN UNNEST(CAST(JSON_PARSE(COALESCE(s.warehouse_balance_details_json, '[]')) AS ARRAY(JSON))) AS t(warehouse) ON TRUE
  
  WHERE s.year = ls.year 
    AND s.month = ls.month 
    AND s.day = ls.day
    AND contains(p.company_ids, s.company_id)
    -- Apply optional filters
    AND (CARDINALITY(p.skus) = 0 OR contains(p.skus, s.sku))
    AND (CARDINALITY(p.inventory_ids) = 0 OR contains(p.inventory_ids, CAST(s.inventory_id AS VARCHAR)))
    AND (CARDINALITY(p.asins) = 0 OR contains(p.asins, s.child_asin))
    AND (CARDINALITY(p.parent_asins) = 0 OR contains(p.parent_asins, s.parent_asin))
    AND (CARDINALITY(p.brands) = 0 OR contains(p.brands, s.brand))
    AND (CARDINALITY(p.product_families) = 0 OR contains(p.product_families, s.product_family))
    AND (CARDINALITY(p.countries) = 0 OR contains(p.countries, s.country_code))
    AND (CARDINALITY(p.revenue_abcd_classes) = 0 OR contains(p.revenue_abcd_classes, s.revenue_abcd_class))
  
  GROUP BY s.company_id, s.inventory_id, s.sku, s.country_code, s.child_asin, s.parent_asin, s.brand, s.product_family, s.product_name,
           s.inbound, s.available, s.fc_transfer, s.fc_processing, s.avg_units_30d, s.avg_units_7d, s.avg_units_3d,
           s.sales_last_30_days, s.revenue_abcd_class, s.fba_shipments_json
)

-- Simple test: just return count and sample from inventory_base
SELECT 
  COUNT(*) AS total_items,
  company_id,
  country_code,
  COUNT(DISTINCT sku) AS distinct_skus
FROM inventory_base
GROUP BY company_id, country_code
