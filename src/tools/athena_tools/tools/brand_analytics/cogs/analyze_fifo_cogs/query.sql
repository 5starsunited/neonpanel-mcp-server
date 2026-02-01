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
    
    -- Date range filters (nullable)
    {{start_date}} AS start_date,
    {{end_date}} AS end_date,
    
    -- Aggregation config
    {{periodicity_sql}} AS periodicity,
    {{group_by_fields}} AS group_by_fields,
    
    -- Sort and limit
    {{sort_field_sql}} AS sort_field,
    {{sort_direction_sql}} AS sort_direction,
    {{limit_rows}} AS limit_rows
),

base_transactions AS (
  SELECT
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
    ft.pareto_abc_class,
    ft.inventory_id,
    COALESCE(ft.io_batch_id, ft.ao_batch_id) AS source_batch_id,
    ft.batch_document_id AS batch_id,
    ft.batch_document_name AS batch,
    ft.batch_document_ref_number AS batch_ref_number,
    ft.vendor,
    ft.document_date,
    ft.document_id,
    ft.document_ref_number,
    
    -- COGS calculations: convert negative quantities/amounts to positive
    ABS(ft.quantity) AS units_sold,
    ABS(ft.transaction_amount) AS cogs_amount,
    ABS(ft.item_purchase_price * ft.quantity) AS purchase_price_amount,
    ABS(ft.item_landed_cost * ft.quantity) AS landed_cost_amount,
    
    -- Quality tracking: separate units with/without cost data
    CASE WHEN COALESCE(ft.item_landed_cost, 0) > 0 THEN ABS(ft.quantity) ELSE 0 END AS units_with_cost,
    CASE WHEN COALESCE(ft.item_landed_cost, 0) = 0 THEN ABS(ft.quantity) ELSE 0 END AS units_missing_cost,
    CASE WHEN COALESCE(ft.item_landed_cost, 0) > 0 THEN ABS(ft.transaction_amount) ELSE 0 END AS cogs_with_cost,
    
    1 AS transaction_count
    
  FROM awsdatacatalog.neonpanel_iceberg.fifo_transactions_snapshot ft
  CROSS JOIN params p
  WHERE 1=1
    -- REQUIRED: company filter (partition pruning)
    AND contains(p.company_ids, ft.company_id)
    
    -- REQUIRED: invoice transactions only
    AND ft.document_type = 'Invoice'
    
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
  GROUP BY 
    {{group_by_clause}}
)

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
  END AS avg_unit_cogs
FROM aggregated_cogs ac
{{order_by_clause}}
LIMIT {{limit_rows}}
