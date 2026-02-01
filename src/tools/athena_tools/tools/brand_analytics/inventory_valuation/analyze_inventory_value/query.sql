-- Tool: inventory_valuation_analyze_inventory_value
-- Purpose: Analyze current inventory value using FIFO batch balances
-- Data source: neonpanel_iceberg.fifo_transactions_snapshot
-- Method: Rank by transaction_id DESC to get latest balance for each warehouse/batch

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
    {{origin_warehouses_array}} AS origin_warehouses,
    {{destination_warehouses_array}} AS destination_warehouses,
    
    -- Snapshot date (nullable - if NULL, uses latest)
    {{snapshot_date}} AS snapshot_date,
    
    -- Aggregation config
    {{periodicity_sql}} AS periodicity,
    {{group_by_fields}} AS group_by_fields,
    
    -- Sort and limit
    {{sort_field_sql}} AS sort_field,
    {{sort_direction_sql}} AS sort_direction,
    {{limit_rows}} AS limit_rows
),

ranked_transactions AS (
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
    ft.origin_warehouse,
    ft.destination_warehouse,
    ft.document_date,
    ft.transaction_id,
    ft.batch_balance,
    ft.item_landed_cost,
    
    -- Rank transactions within each warehouse/batch, latest first
    ROW_NUMBER() OVER (
      PARTITION BY ft.inventory_id, ft.destination_warehouse, ft.batch_document_id 
      ORDER BY ft.transaction_id DESC
    ) AS rn
    
  FROM awsdatacatalog.neonpanel_iceberg.fifo_transactions_snapshot ft
  CROSS JOIN params p
  WHERE 1=1
    -- REQUIRED: company filter (partition pruning)
    AND contains(p.company_ids, ft.company_id)
    
    -- OPTIONAL: snapshot date filter (if provided, only consider transactions up to that date)
    AND (p.snapshot_date IS NULL OR ft.document_date <= CAST(p.snapshot_date AS DATE))
    
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
    AND (cardinality(p.origin_warehouses) = 0 OR contains(p.origin_warehouses, ft.origin_warehouse))
    AND (cardinality(p.destination_warehouses) = 0 OR contains(p.destination_warehouses, ft.destination_warehouse))
),

latest_balances AS (
  SELECT
    rt.company_id,
    rt.sku,
    rt.brand,
    rt.product_family,
    rt.child_asin,
    rt.parent_asin,
    rt.marketplace,
    rt.country,
    rt.marketplace_currency,
    rt.revenue_abcd_class,
    rt.pareto_abc_class,
    rt.inventory_id,
    rt.source_batch_id,
    rt.batch_id,
    rt.batch,
    rt.batch_ref_number,
    rt.vendor,
    rt.origin_warehouse,
    rt.destination_warehouse,
    rt.document_date,
    
    -- Balance metrics
    rt.batch_balance AS balance_quantity,
    rt.item_landed_cost AS unit_cost,
    rt.batch_balance * COALESCE(rt.item_landed_cost, 0) AS balance_amount
    
  FROM ranked_transactions rt
  WHERE rt.rn = 1  -- Only keep the latest transaction for each warehouse/batch
    AND rt.batch_balance > 0  -- Only keep batches with positive balance
),

aggregated_inventory AS (
  SELECT
    p.periodicity,
    
    -- Time period grouping (if periodicity is not 'total')
    CASE 
      WHEN p.periodicity = 'month' THEN FORMAT('%d-%02d', YEAR(lb.document_date), MONTH(lb.document_date))
      WHEN p.periodicity = 'year' THEN CAST(YEAR(lb.document_date) AS VARCHAR)
      ELSE NULL
    END AS time_period,
    
    -- Dynamic dimension grouping (only include if in group_by_fields)
    {{group_by_select_clause}}
    
    -- Aggregated metrics
    SUM(lb.balance_quantity) AS balance_quantity,
    SUM(lb.balance_amount) AS balance_amount,
    COUNT(DISTINCT CONCAT(CAST(lb.inventory_id AS VARCHAR), '-', CAST(lb.batch_id AS VARCHAR))) AS batches_count
    
  FROM latest_balances lb
  CROSS JOIN params p
  GROUP BY 
    {{group_by_clause}}
)

SELECT
  ai.time_period,
  {{select_dimensions}}
  ai.balance_quantity,
  ai.balance_amount,
  ai.batches_count,
  
  -- Average unit cost
  CASE 
    WHEN ai.balance_quantity > 0 THEN ROUND(ai.balance_amount / ai.balance_quantity, 2)
    ELSE 0.0 
  END AS avg_unit_cost
FROM aggregated_inventory ai
{{order_by_clause}}
LIMIT {{limit_rows}}
