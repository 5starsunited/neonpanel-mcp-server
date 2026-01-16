-- Tool: supply_chain_list_stock_replenishment_risk_items
-- Identifies items at stockout or days-of-supply risk using probabilistic inbound arrival (p50/p80/p95).
-- Key data sources: inventory snapshot, FBA inbound shipments (JSON), warehouse stock, sales velocity.
-- Notes:
-- - company_id filtering is REQUIRED for authorization + partition pruning.
-- - Weighted velocity calculated from precalculated 30d, 7d, 3d windows.
-- - Inbound JSON contains p50_days, p80_days, p95_days, units_shipped for each shipment.

WITH params AS (
  SELECT
    {{company_ids_array}} AS company_ids,
    {{skus_array}} AS skus,
    {{inventory_ids_array}} AS inventory_ids,
    {{asins_array}} AS asins,
    {{parent_asins_array}} AS parent_asins,
    {{brands_array}} AS brands,
    {{product_families_array}} AS product_families,
    {{countries_array}} AS countries,
    {{revenue_abcd_classes_array}} AS revenue_abcd_classes,
    
    -- Risk analysis parameters
    CAST({{min_days_of_supply}} AS INTEGER) AS min_days_of_supply,
    CAST({{p80_arrival_buffer_days}} AS INTEGER) AS p80_arrival_buffer_days,
    CAST({{include_warehouse_stock}} AS BOOLEAN) AS include_warehouse_stock,
    CAST({{include_inbound_details}} AS BOOLEAN) AS include_inbound_details,
    {{stockout_risk_filter_array}} AS stockout_risk_filter,
    {{supply_buffer_risk_filter_array}} AS supply_buffer_risk_filter,
    
    -- Velocity weighting (mode or individual weights)
    CAST(ROW({{weight_30d}}, {{weight_7d}}, {{weight_3d}}) AS ROW(w30d DOUBLE, w7d DOUBLE, w3d DOUBLE)) AS velocity_weights,
    
    CAST({{limit_top_n}} AS INTEGER) AS limit_results,
    {{sort_field}} AS sort_field,
    {{sort_direction}} AS sort_direction
),

latest_snapshot AS (
  -- Get latest snapshot partition for authorized companies.
  SELECT year, month, day
  FROM "{{catalog}}"."{{database}}"."inventory_planning_snapshot"
  WHERE company_id IN (SELECT DISTINCT company_id FROM "{{catalog}}"."{{database}}"."inventory_planning_snapshot" WHERE company_id > 0)
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
    
  FROM "{{catalog}}"."{{database}}"."inventory_planning_snapshot_iceberg" s
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
),

inbound_analysis AS (
  -- Parse inbound shipments JSON and aggregate by percentile.
  SELECT
    company_id,
    inventory_id,
    COALESCE(SUM(CAST(json_extract_scalar(shipment, '$.units_shipped') AS INTEGER)), 0) AS inbound_units,
    -- p50, p80, p95 are max of all shipments' likelihood days (conservative: use worst case).
    CAST(MAX(COALESCE(CAST(json_extract_scalar(shipment, '$.p50_days') AS DOUBLE), 0)) AS DOUBLE) AS inbound_p50_days_raw,
    CAST(MAX(COALESCE(CAST(json_extract_scalar(shipment, '$.p80_days') AS DOUBLE), 0)) AS DOUBLE) AS inbound_p80_days_raw,
    CAST(MAX(COALESCE(CAST(json_extract_scalar(shipment, '$.p95_days') AS DOUBLE), 0)) AS DOUBLE) AS inbound_p95_days_raw,
    COUNT(DISTINCT json_extract_scalar(shipment, '$.shipment_id')) AS inbound_shipment_count
  FROM inventory_base ib
  CROSS JOIN UNNEST(CAST(JSON_PARSE(ib.fba_shipments_json) AS ARRAY(JSON))) AS t(shipment)
  GROUP BY 1, 2
),

inbound_with_buffer AS (
  -- Apply safety buffer to inbound arrival estimates.
  SELECT
    company_id,
    inventory_id,
    inbound_units,
    GREATEST(0.0, inbound_p50_days_raw - {{p80_arrival_buffer_days}}) AS inbound_p50_days,
    GREATEST(0.0, inbound_p80_days_raw - {{p80_arrival_buffer_days}}) AS inbound_p80_days,
    GREATEST(0.0, inbound_p95_days_raw - {{p80_arrival_buffer_days}}) AS inbound_p95_days,
    inbound_shipment_count
  FROM inbound_analysis
),

velocity_calculations AS (
  -- Calculate weighted velocity and days-of-supply for three scenarios (p50, p80, p95).
  SELECT
    ib.*,
    p.velocity_weights,
    p.min_days_of_supply,
    p.include_warehouse_stock,
    
    -- Weighted velocity
    (p.velocity_weights.w30d * ib.sales_velocity_30d 
     + p.velocity_weights.w7d * ib.sales_velocity_7d 
     + p.velocity_weights.w3d * ib.sales_velocity_3d) AS weighted_velocity,
    
    -- Available supply for each scenario
    ib.current_fba_stock AS supply_fba_only,
    CASE WHEN p.include_warehouse_stock THEN ib.current_fba_stock + ib.warehouse_stock ELSE ib.current_fba_stock END AS total_available_stock,
    
    -- Days-of-supply scenarios (avoiding division by zero)
    IF(weighted_velocity > 0, 
       (ib.current_fba_stock + (inb.inbound_units / GREATEST(1.0, 1.0 + (inb.inbound_p50_days / GREATEST(1.0, inb.inbound_p50_days))))) / weighted_velocity,
       999.0) AS dos_p50_fba,
    IF(weighted_velocity > 0,
       (ib.current_fba_stock + (inb.inbound_units / GREATEST(1.0, 1.0 + (inb.inbound_p80_days / GREATEST(1.0, inb.inbound_p80_days))))) / weighted_velocity,
       999.0) AS dos_p80_fba,
    IF(weighted_velocity > 0,
       (ib.current_fba_stock + (inb.inbound_units / GREATEST(1.0, 1.0 + (inb.inbound_p95_days / GREATEST(1.0, inb.inbound_p95_days))))) / weighted_velocity,
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

risk_classification AS (
  -- Classify items by stockout risk and supply buffer risk.
  SELECT
    *,
    CASE
      WHEN dos_p50_fba < 0 THEN 'high'
      WHEN dos_p80_fba < 0 THEN 'moderate'
      WHEN dos_p95_fba < 0 THEN 'low'
      ELSE 'ok'
    END AS stockout_risk_tier,
    
    CASE
      WHEN dos_p50_fba < min_days_of_supply THEN 'high'
      WHEN dos_p80_fba < min_days_of_supply THEN 'moderate'
      WHEN dos_p95_fba < min_days_of_supply THEN 'low'
      ELSE 'ok'
    END AS supply_buffer_risk_tier,
    
    -- Velocity thresholds (units/day at which risk boundary is crossed)
    IF(current_fba_stock >= 0, current_fba_stock / GREATEST(0.1, inbound_p50_days), 999.0) AS stockout_critical_velocity_p50,
    IF(current_fba_stock >= 0, current_fba_stock / GREATEST(0.1, inbound_p80_days), 999.0) AS stockout_critical_velocity_p80,
    IF(current_fba_stock >= 0, current_fba_stock / GREATEST(0.1, inbound_p95_days), 999.0) AS stockout_critical_velocity_p95,
    
    IF(weighted_velocity > 0, (current_fba_stock + inbound_units) / GREATEST(0.1, CAST(min_days_of_supply AS DOUBLE)), 0.0) AS supply_buffer_critical_velocity_p50,
    IF(weighted_velocity > 0, (current_fba_stock + inbound_units) / GREATEST(0.1, CAST(min_days_of_supply AS DOUBLE)), 0.0) AS supply_buffer_critical_velocity_p80,
    IF(weighted_velocity > 0, (current_fba_stock + inbound_units) / GREATEST(0.1, CAST(min_days_of_supply AS DOUBLE)), 0.0) AS supply_buffer_critical_velocity_p95
    
  FROM velocity_calculations
),

filtered_results AS (
  -- Apply risk tier filters (stockout_risk_filter and supply_buffer_risk_filter use OR logic).
  SELECT * FROM risk_classification
  WHERE (
    (CARDINALITY(stockout_risk_filter) = 0 OR contains(stockout_risk_filter, stockout_risk_tier))
    OR
    (CARDINALITY(supply_buffer_risk_filter) = 0 OR contains(supply_buffer_risk_filter, supply_buffer_risk_tier))
  )
),

final_output AS (
  SELECT
    company_id,
    inventory_id,
    sku,
    country_code,
    child_asin,
    parent_asin,
    brand,
    product_family,
    product_name,
    
    current_fba_stock,
    warehouse_stock,
    (current_fba_stock + warehouse_stock) AS total_available_stock,
    
    sales_velocity_30d,
    sales_velocity_7d,
    sales_velocity_3d,
    weighted_velocity,
    
    inbound_units,
    inbound_p50_days,
    inbound_p80_days,
    inbound_p95_days,
    inbound_shipment_count,
    
    dos_p50_fba AS days_of_supply_p50,
    dos_p80_fba AS days_of_supply_p80,
    dos_p95_fba AS days_of_supply_p95,
    
    stockout_risk_tier,
    supply_buffer_risk_tier,
    
    -- Velocity thresholds (JSON structure for output)
    CAST(ROW(
      stockout_critical_velocity_p50,
      stockout_critical_velocity_p80,
      stockout_critical_velocity_p95
    ) AS ROW(p50_units_per_day DOUBLE, p80_units_per_day DOUBLE, p95_units_per_day DOUBLE)) AS stockout_critical_velocity,
    
    CAST(ROW(
      supply_buffer_critical_velocity_p50,
      supply_buffer_critical_velocity_p80,
      supply_buffer_critical_velocity_p95
    ) AS ROW(p50_units_per_day DOUBLE, p80_units_per_day DOUBLE, p95_units_per_day DOUBLE)) AS supply_buffer_critical_velocity,
    
    -- Placeholder for warehouse_replenishment_options and purchase_order_recommendation (filled by runtime).
    CAST(NULL AS VARCHAR) AS warehouse_replenishment_options_json,
    CAST(NULL AS VARCHAR) AS purchase_order_recommendation_json,
    
    -- Generic recommendation (to be enhanced by runtime logic).
    CONCAT(
      stockout_risk_tier, ' stockout risk / ',
      supply_buffer_risk_tier, ' buffer risk (', 
      CAST(ROUND(dos_p80_fba, 1) AS VARCHAR), 'd supply at p80)'
    ) AS recommendation
    
  FROM filtered_results
  -- Apply sorting (default: by stockout_risk_tier then supply_buffer_risk_tier, then by DOS ascending)
  ORDER BY 
    CASE stockout_risk_tier WHEN 'high' THEN 1 WHEN 'moderate' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
    CASE supply_buffer_risk_tier WHEN 'high' THEN 1 WHEN 'moderate' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
    dos_p80_fba ASC
  LIMIT (SELECT limit_results FROM params LIMIT 1)
)

SELECT * FROM final_output
