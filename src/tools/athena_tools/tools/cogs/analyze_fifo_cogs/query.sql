-- Tool: cogs_analyze_fifo_cogs
-- Purpose: Analyze FIFO Cost of Goods Sold from invoice transactions
-- Data source: neonpanel_iceberg.fifo_transactions_snapshot
-- Transaction filter: document_type = 'Invoice' (sales only)
-- COGS calculation: ABS(transaction_amount) to convert negative invoice amounts

WITH params AS (
  SELECT
    -- REQUIRED: company_id array for partition pruning
    {{company_ids_array}} AS company_ids,
    
    -- OPTIONAL filters (empty array => no filter)
    {{skus_array}} AS skus,
    {{brands_array}} AS brands,
    {{product_families_array}} AS product_families,
    {{child_asins_array}} AS child_asins,
    {{parent_asins_array}} AS parent_asins,
    {{marketplaces_array}} AS marketplaces,
    {{countries_array}} AS countries,
    {{marketplace_currencies_array}} AS marketplace_currencies,
    {{revenue_abcd_classes_array}} AS revenue_abcd_classes,
    {{pareto_abc_classes_array}} AS pareto_abc_classes,
    {{inventory_ids_array}} AS inventory_ids,
    {{vendors_array}} AS vendors,
    {{document_ids_array}} AS document_ids,
    {{document_ref_numbers_array}} AS document_ref_numbers,
    {{transaction_ids_array}} AS transaction_ids,
    
    -- Source batch filters (IO/AO batch - where inventory originated)
    {{source_batch_ids_array}} AS source_batch_ids,
    
    -- Final batch filters (batch document with added costs)
    {{batch_ids_array}} AS batch_ids,
    
    -- Warehouse filters
    {{origin_warehouses_array}} AS origin_warehouses,
    {{destination_warehouses_array}} AS destination_warehouses,
    
    -- Analysis mode: 'normal', 'lost_batches', 'lost_cogs'
    {{analysis_mode_sql}} AS analysis_mode,
    
    -- Date range filters (nullable)
    {{start_date}} AS start_date,
    {{end_date}} AS end_date,
    
    -- Aggregation config
    {{periodicity_sql}} AS periodicity,
    {{group_by_fields}} AS group_by_fields,
    
    -- Sort and limit
    {{sort_field_sql}} AS sort_field,
    {{sort_direction_sql}} AS sort_direction,
    {{limit_rows}} AS limit_rows,
    
    -- Detail level: 'aggregated' or 'transactions'
    {{detail_level}} AS detail_level
),

base_transactions AS (
  SELECT
    ft.transaction_id,
    ft.company_id,
    ft.sku,
    ft.brand,
    ft.product_family,
    ft.child_asin,
    ft.parent_asin,
    ft.marketplace,
    ft.country,
    ft.marketplace_currency,
    ft.revenue_abcd_class,
    ft.revenue_abcd_class_description,
    ft.pareto_abc_class,
    ft.inventory_id,
    -- Source batch (where inventory originated - IO or AO)
    COALESCE(ft.io_batch_id, ft.ao_batch_id) AS source_batch_id,
    COALESCE(ft.io_batch_name, ft.ao_batch_name) AS source_batch,
    COALESCE(ft.io_batch_ref_number, ft.ao_batch_ref_number) AS source_batch_ref_number,
    -- Final batch (batch document with added costs)
    ft.batch_document_id AS batch_id,
    ft.batch_document_name AS batch,
    ft.batch_document_ref_number AS batch_ref_number,
    ft.vendor,
    -- Warehouse
    ft.origin_warehouse,
    ft.destination_warehouse,
    ft.document_date,
    ft.document_id,
    ft.document_name,
    ft.document_ref_number,
    -- COGS calculations: negate to convert outbound (negative) to positive for aggregation
    -- Selling transactions have negative qty/amounts, returns have opposite signs
    -1 * ft.quantity AS units_sold,
    -1 * ft.transaction_amount AS cogs_amount,
    -1 * (ft.item_purchase_price * ft.quantity) AS purchase_price_amount,
    -1 * (ft.item_landed_cost * ft.quantity) AS landed_cost_amount,
    
    -- Quality tracking: separate units with/without cost data
    CASE WHEN COALESCE(ft.item_landed_cost, 0) > 0 THEN -1 * ft.quantity ELSE 0 END AS units_with_cost,
    CASE WHEN COALESCE(ft.item_landed_cost, 0) = 0 THEN -1 * ft.quantity ELSE 0 END AS units_missing_cost,
    CASE WHEN COALESCE(ft.item_landed_cost, 0) > 0 THEN -1 * ft.transaction_amount ELSE 0 END AS cogs_with_cost,
    
    1 AS transaction_count
    
  FROM awsdatacatalog.neonpanel_iceberg.fifo_transactions_snapshot ft
  CROSS JOIN params p
  WHERE 1=1
    -- REQUIRED: company filter (partition pruning)
    AND contains(p.company_ids, ft.company_id)
    
    -- REQUIRED: invoice transactions only
    AND ft.document_type = 'Invoice'
    
    -- REQUIRED: only outbound transactions (sales/returns have quantity != 0)
    AND ft.quantity IS NOT NULL
    AND ft.quantity != 0
    
    -- REQUIRED: must have transaction amount
    AND ft.transaction_amount IS NOT NULL
    
    -- OPTIONAL: date range filters
    AND (p.start_date IS NULL OR ft.document_date >= CAST(p.start_date AS DATE))
    AND (p.end_date IS NULL OR ft.document_date <= CAST(p.end_date AS DATE))
    
    -- OPTIONAL: dimension filters (only apply if array is non-empty)
    AND (cardinality(p.skus) = 0 OR contains(p.skus, ft.sku))
    AND (cardinality(p.brands) = 0 OR contains(p.brands, ft.brand))
    AND (cardinality(p.product_families) = 0 OR contains(p.product_families, ft.product_family))
    AND (cardinality(p.child_asins) = 0 OR contains(p.child_asins, ft.child_asin))
    AND (cardinality(p.parent_asins) = 0 OR contains(p.parent_asins, ft.parent_asin))
    AND (cardinality(p.marketplaces) = 0 OR contains(p.marketplaces, ft.marketplace))
    AND (cardinality(p.countries) = 0 OR contains(p.countries, ft.country))
    AND (cardinality(p.marketplace_currencies) = 0 OR contains(p.marketplace_currencies, ft.marketplace_currency))
    AND (cardinality(p.revenue_abcd_classes) = 0 OR contains(p.revenue_abcd_classes, ft.revenue_abcd_class))
    AND (cardinality(p.pareto_abc_classes) = 0 OR contains(p.pareto_abc_classes, ft.pareto_abc_class))
    AND (cardinality(p.inventory_ids) = 0 OR contains(p.inventory_ids, ft.inventory_id))
    AND (cardinality(p.vendors) = 0 OR contains(p.vendors, ft.vendor))
    AND (cardinality(p.document_ids) = 0 OR contains(p.document_ids, ft.document_id))
    AND (cardinality(p.document_ref_numbers) = 0 OR contains(p.document_ref_numbers, ft.document_ref_number))
    
    -- NEW: Transaction ID filter
    AND (cardinality(p.transaction_ids) = 0 OR contains(p.transaction_ids, ft.transaction_id))
    
    -- NEW: Source batch filters (IO/AO batch - where inventory originated)
    AND (cardinality(p.source_batch_ids) = 0 OR contains(p.source_batch_ids, ft.io_batch_id) OR contains(p.source_batch_ids, ft.ao_batch_id))
    
    -- NEW: Final batch filters (batch document with added costs)
    AND (cardinality(p.batch_ids) = 0 OR contains(p.batch_ids, ft.batch_document_id))
    
    -- NEW: Warehouse filters
    AND (cardinality(p.origin_warehouses) = 0 OR contains(p.origin_warehouses, ft.origin_warehouse))
    AND (cardinality(p.destination_warehouses) = 0 OR contains(p.destination_warehouses, ft.destination_warehouse))
    
    -- NEW: Search filter (searches across names and ref_numbers)
    AND {{search_filter}}
    
    -- ANALYSIS MODE FILTER:
    -- 'normal' = all transactions (no filter)
    -- 'lost_batches' = batch_document_id IS NULL (transactions without batch assignment)
    -- 'lost_cogs' = batch_document_id IS NOT NULL AND item_landed_cost = 0 (batches without costs)
    AND {{analysis_mode_filter}}
),

aggregated_cogs AS (
  SELECT
    p.periodicity,
    
    -- Time period grouping (if periodicity is not 'total')
    CASE 
      WHEN p.periodicity = 'month' THEN FORMAT('%d-%02d', YEAR(bt.document_date), MONTH(bt.document_date))
      WHEN p.periodicity = 'year' THEN CAST(YEAR(bt.document_date) AS VARCHAR)
      ELSE NULL
    END AS time_period,
    
    -- Dynamic dimension grouping (only include if in group_by_fields)
    {{group_by_select_clause}}
    
    -- Aggregated metrics
    SUM(bt.cogs_amount) AS cogs_amount,
    SUM(bt.units_sold) AS units_sold,
    SUM(bt.units_with_cost) AS units_with_cost,
    SUM(bt.units_missing_cost) AS units_missing_cost,
    SUM(bt.cogs_with_cost) AS cogs_with_cost,
    SUM(bt.transaction_count) AS transactions_count,
    SUM(bt.purchase_price_amount) AS purchase_price_amount,
    SUM(bt.landed_cost_amount) AS landed_cost_amount
    
  FROM base_transactions bt
  CROSS JOIN params p
  WHERE p.detail_level = 'aggregated'
  GROUP BY 
    {{group_by_clause}}
),

-- Transaction-level detail output (when detail_level = 'transactions')
transaction_details AS (
  SELECT
    bt.transaction_id,
    bt.document_date,
    bt.document_id,
    bt.document_name,
    bt.document_ref_number,
    bt.sku,
    bt.brand,
    bt.product_family,
    bt.child_asin,
    bt.parent_asin,
    bt.marketplace,
    bt.country,
    bt.marketplace_currency,
    bt.revenue_abcd_class,
    bt.revenue_abcd_class_description,
    bt.pareto_abc_class,
    bt.inventory_id,
    bt.source_batch_id,
    bt.source_batch,
    bt.source_batch_ref_number,
    bt.batch_id,
    bt.batch,
    bt.batch_ref_number,
    bt.vendor,
    bt.origin_warehouse,
    bt.destination_warehouse,
    bt.units_sold,
    bt.cogs_amount,
    bt.purchase_price_amount,
    bt.landed_cost_amount,
    -- Quality indicator for this transaction
    CASE WHEN bt.units_with_cost > 0 THEN 'has_cost' ELSE 'missing_cost' END AS cost_status
  FROM base_transactions bt
  CROSS JOIN params p
  WHERE p.detail_level = 'transactions'
)

-- Output: Aggregated data when detail_level = 'aggregated'
SELECT
  ac.time_period,
  {{select_dimensions}}
  ac.cogs_amount,
  ac.units_sold,
  ac.units_with_cost,
  ac.units_missing_cost,
  
  -- Quality percentage
  CASE 
    WHEN ac.units_sold > 0 THEN ROUND(100.0 * ac.units_with_cost / ac.units_sold, 2)
    ELSE 100.0 
  END AS cogs_quality_pct,
  
  -- Quality status indicator
  CASE 
    WHEN ac.units_sold = 0 THEN '🟢'
    WHEN 100.0 * ac.units_with_cost / ac.units_sold < 90.0 THEN '🔴'
    WHEN 100.0 * ac.units_with_cost / ac.units_sold < 99.0 THEN '🟡'
    ELSE '🟢'
  END AS cogs_quality_status,
  
  -- Estimated lost COGS = avg_cost × missing_units
  CASE 
    WHEN ac.units_with_cost > 0 AND ac.units_missing_cost > 0
    THEN ROUND((ac.cogs_with_cost / ac.units_with_cost) * ac.units_missing_cost, 2)
    ELSE 0.0
  END AS estimated_lost_cogs,
  
  ac.transactions_count,
  ac.purchase_price_amount,
  CASE 
    WHEN ac.units_sold > 0 THEN ROUND(ac.cogs_amount / ac.units_sold, 2)
    ELSE 0.0 
  END AS avg_unit_cogs,
  -- Placeholder columns for UNION compatibility
  NULL AS transaction_id,
  NULL AS document_date,
  NULL AS document_id,
  NULL AS document_name,
  NULL AS document_ref_number_detail,
  NULL AS sku_detail,
  NULL AS brand_detail,
  NULL AS product_family_detail,
  NULL AS child_asin_detail,
  NULL AS parent_asin_detail,
  NULL AS marketplace_detail,
  NULL AS country_detail,
  NULL AS marketplace_currency_detail,
  NULL AS revenue_abcd_class_detail,
  NULL AS inventory_id_detail,
  NULL AS source_batch_id_detail,
  NULL AS source_batch_detail,
  NULL AS source_batch_ref_number_detail,
  NULL AS batch_id_detail,
  NULL AS batch_detail,
  NULL AS batch_ref_number_detail,
  NULL AS vendor_detail,
  NULL AS origin_warehouse_detail,
  NULL AS destination_warehouse_detail,
  NULL AS cost_status,
  'aggregated' AS output_type
FROM aggregated_cogs ac
WHERE EXISTS (SELECT 1 FROM params p WHERE p.detail_level = 'aggregated')

UNION ALL

-- Output: Transaction-level detail when detail_level = 'transactions'
SELECT
  CAST(td.document_date AS VARCHAR) AS time_period,
  {{select_dimensions_transactions}}
  td.cogs_amount,
  td.units_sold,
  CASE WHEN td.cost_status = 'has_cost' THEN td.units_sold ELSE 0 END AS units_with_cost,
  CASE WHEN td.cost_status = 'missing_cost' THEN td.units_sold ELSE 0 END AS units_missing_cost,
  -- Quality percentage (100% or 0% for individual transaction)
  CASE WHEN td.cost_status = 'has_cost' THEN 100.0 ELSE 0.0 END AS cogs_quality_pct,
  -- Quality status
  CASE WHEN td.cost_status = 'has_cost' THEN '🟢' ELSE '🔴' END AS cogs_quality_status,
  -- Estimated lost COGS (0 for has_cost, full amount for missing)
  CASE WHEN td.cost_status = 'missing_cost' THEN td.cogs_amount ELSE 0.0 END AS estimated_lost_cogs,
  1 AS transactions_count,
  td.purchase_price_amount,
  CASE WHEN td.units_sold > 0 THEN ROUND(td.cogs_amount / td.units_sold, 2) ELSE 0.0 END AS avg_unit_cogs,
  -- Transaction-level detail columns
  td.transaction_id,
  td.document_date,
  td.document_id,
  td.document_name,
  td.document_ref_number AS document_ref_number_detail,
  td.sku AS sku_detail,
  td.brand AS brand_detail,
  td.product_family AS product_family_detail,
  td.child_asin AS child_asin_detail,
  td.parent_asin AS parent_asin_detail,
  td.marketplace AS marketplace_detail,
  td.country AS country_detail,
  td.marketplace_currency AS marketplace_currency_detail,
  td.revenue_abcd_class AS revenue_abcd_class_detail,
  td.inventory_id AS inventory_id_detail,
  td.source_batch_id AS source_batch_id_detail,
  td.source_batch AS source_batch_detail,
  td.source_batch_ref_number AS source_batch_ref_number_detail,
  td.batch_id AS batch_id_detail,
  td.batch AS batch_detail,
  td.batch_ref_number AS batch_ref_number_detail,
  td.vendor AS vendor_detail,
  td.origin_warehouse AS origin_warehouse_detail,
  td.destination_warehouse AS destination_warehouse_detail,
  td.cost_status,
  'transactions' AS output_type
FROM transaction_details td
WHERE EXISTS (SELECT 1 FROM params p WHERE p.detail_level = 'transactions')

{{order_by_clause}}
LIMIT {{limit_rows}}
