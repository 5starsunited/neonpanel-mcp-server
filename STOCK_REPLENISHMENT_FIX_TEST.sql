-- Test Stock Replenishment Risk Tool - Flattened Weights Version
-- Tests warehouse JSON parsing + flattened velocity weights
-- Company: 106, Marketplace: US, Limit: 50

WITH params AS (
  SELECT
    ARRAY[106] AS company_ids,
    ARRAY[] AS skus,
    ARRAY[] AS inventory_ids,
    ARRAY[] AS asins,
    ARRAY[] AS parent_asins,
    ARRAY[] AS brands,
    ARRAY[] AS product_families,
    ARRAY['US'] AS countries,
    ARRAY[] AS revenue_abcd_classes,
    
    28 AS min_days_of_supply,
    14 AS p80_arrival_buffer_days,
    TRUE AS include_warehouse_stock,
    TRUE AS include_inbound_details,
    ARRAY[] AS stockout_risk_filter,
    ARRAY[] AS supply_buffer_risk_filter,
    
    -- Velocity weighting (individual weights - Balanced: 0.5, 0.3, 0.2)
    0.5 AS weight_30d,
    0.3 AS weight_7d,
    0.2 AS weight_3d,
    
    50 AS limit_results,
    'days_of_supply' AS sort_field,
    'asc' AS sort_direction
),

latest_snapshot AS (
  SELECT year, month, day
  FROM "AwsDataCatalog"."inventory_planning"."inventory_planning_snapshot_iceberg"
  WHERE company_id IN (SELECT DISTINCT company_id FROM "AwsDataCatalog"."inventory_planning"."inventory_planning_snapshot_iceberg" WHERE company_id > 0)
  GROUP BY year, month, day
  ORDER BY CAST(year AS INTEGER) DESC, CAST(month AS INTEGER) DESC, CAST(day AS INTEGER) DESC
  LIMIT 1
),

inventory_base AS (
  SELECT
    s.company_id,
    s.inventory_id,
    s.sku,
    s.asin,
    s.parent_asin,
    s.brand,
    s.product_family,
    s.country_code,
    s.revenue_abcd_class,
    s.available AS current_fba_stock,
    COALESCE(SUM(CAST(json_extract_scalar(warehouse, '$.balance_quantity') AS BIGINT)), 0) AS warehouse_stock,
    s.avg_units_30d AS sales_velocity_30d,
    s.avg_units_7d AS sales_velocity_7d,
    s.avg_units_3d AS sales_velocity_3d,
    s.fba_shipments_json AS inbound_details_json,
    s.year,
    s.month,
    s.day
  FROM "AwsDataCatalog"."inventory_planning"."inventory_planning_snapshot_iceberg" s
  LEFT JOIN latest_snapshot ls ON s.year = ls.year AND s.month = ls.month AND s.day = ls.day
  LEFT JOIN UNNEST(CAST(JSON_PARSE(COALESCE(s.warehouse_balance_details_json, '[]')) AS ARRAY(JSON))) AS t(warehouse) ON TRUE
  CROSS JOIN params p
  WHERE s.company_id IN (106)
    AND s.country_code IN ('US')
  GROUP BY 
    s.company_id, s.inventory_id, s.sku, s.asin, s.parent_asin, s.brand, s.product_family,
    s.country_code, s.revenue_abcd_class, s.available, s.avg_units_30d,
    s.avg_units_7d, s.avg_units_3d, s.fba_shipments_json, s.year, s.month, s.day
),

inbound_analysis AS (
  SELECT
    ib.company_id,
    ib.inventory_id,
    COALESCE(SUM(CAST(json_extract_scalar(shipment, '$.units_shipped') AS BIGINT)), 0) AS inbound_units,
    COALESCE(MAX(CAST(json_extract_scalar(shipment, '$.p50_days') AS INTEGER)), 0) AS inbound_p50_days_raw,
    COALESCE(MAX(CAST(json_extract_scalar(shipment, '$.p80_days') AS INTEGER)), 0) AS inbound_p80_days_raw,
    COALESCE(MAX(CAST(json_extract_scalar(shipment, '$.p95_days') AS INTEGER)), 0) AS inbound_p95_days_raw,
    COUNT(DISTINCT json_extract_scalar(shipment, '$.shipment_id')) AS inbound_shipment_count
  FROM inventory_base ib
  LEFT JOIN UNNEST(CAST(JSON_PARSE(COALESCE(ib.inbound_details_json, '[]')) AS ARRAY(JSON))) AS t(shipment) ON TRUE
  GROUP BY ib.company_id, ib.inventory_id
),

inbound_with_buffer AS (
  SELECT
    company_id,
    inventory_id,
    inbound_units,
    GREATEST(0, inbound_p50_days_raw) AS inbound_p50_days,
    GREATEST(0.0, inbound_p80_days_raw - 14) AS inbound_p80_days,
    GREATEST(0.0, inbound_p95_days_raw - 14) AS inbound_p95_days,
    inbound_shipment_count
  FROM inbound_analysis
),

velocity_calculations AS (
  SELECT
    ib.*,
    p.weight_30d,
    p.weight_7d,
    p.weight_3d,
    p.min_days_of_supply,
    p.include_warehouse_stock,
    
    -- Weighted velocity
    (p.weight_30d * ib.sales_velocity_30d 
     + p.weight_7d * ib.sales_velocity_7d 
     + p.weight_3d * ib.sales_velocity_3d) AS weighted_velocity,
    
    -- Available supply for each scenario
    ib.current_fba_stock AS supply_fba_only,
    CASE WHEN p.include_warehouse_stock THEN ib.current_fba_stock + ib.warehouse_stock ELSE ib.current_fba_stock END AS total_available_stock,
    
    -- Days-of-supply scenarios (avoiding division by zero)
    IF(((p.weight_30d * ib.sales_velocity_30d + p.weight_7d * ib.sales_velocity_7d + p.weight_3d * ib.sales_velocity_3d)) > 0, 
       (ib.current_fba_stock + (inb.inbound_units / GREATEST(1.0, 1.0 + (inb.inbound_p50_days / GREATEST(1.0, inb.inbound_p50_days))))) / (p.weight_30d * ib.sales_velocity_30d + p.weight_7d * ib.sales_velocity_7d + p.weight_3d * ib.sales_velocity_3d),
       999.0) AS dos_p50_fba,
    IF(((p.weight_30d * ib.sales_velocity_30d + p.weight_7d * ib.sales_velocity_7d + p.weight_3d * ib.sales_velocity_3d)) > 0,
       (ib.current_fba_stock + (inb.inbound_units / GREATEST(1.0, 1.0 + (inb.inbound_p80_days / GREATEST(1.0, inb.inbound_p80_days))))) / (p.weight_30d * ib.sales_velocity_30d + p.weight_7d * ib.sales_velocity_7d + p.weight_3d * ib.sales_velocity_3d),
       999.0) AS dos_p80_fba,
    IF(((p.weight_30d * ib.sales_velocity_30d + p.weight_7d * ib.sales_velocity_7d + p.weight_3d * ib.sales_velocity_3d)) > 0,
       (ib.current_fba_stock + (inb.inbound_units / GREATEST(1.0, 1.0 + (inb.inbound_p95_days / GREATEST(1.0, inb.inbound_p95_days))))) / (p.weight_30d * ib.sales_velocity_30d + p.weight_7d * ib.sales_velocity_7d + p.weight_3d * ib.sales_velocity_3d),
       999.0) AS dos_p95_fba,
       
    inb.inbound_p50_days,
    inb.inbound_p80_days,
    inb.inbound_p95_days,
    inb.inbound_units,
    inb.inbound_shipment_count
    
  FROM inventory_base ib
  LEFT JOIN inbound_with_buffer inb ON ib.company_id = inb.company_id AND ib.inventory_id = inb.inventory_id
  CROSS JOIN params p
),

test_output AS (
  SELECT
    COUNT(*) AS total_items,
    MAX(company_id) AS company_id,
    MAX(country_code) AS country_code,
    COUNT(DISTINCT sku) AS distinct_skus,
    ROUND(AVG(weighted_velocity), 2) AS avg_velocity,
    ROUND(AVG(dos_p80_fba), 2) AS avg_dos,
    COUNT(CASE WHEN weighted_velocity IS NULL THEN 1 END) AS null_velocity_count,
    COUNT(CASE WHEN dos_p80_fba = 999.0 THEN 1 END) AS high_dos_count
  FROM velocity_calculations
)

SELECT * FROM test_output;
