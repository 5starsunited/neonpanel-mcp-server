-- List Lost Batches (transactions where batch is NULL)
-- Shows transactions where batch tracking failed, sorted by lost amount
-- Useful for identifying data quality issues

WITH date_range AS (
  SELECT 
    {{start_date}} AS start_date,
    {{end_date}} AS end_date
),

lost_transactions AS (
  SELECT 
    ft.transaction_id,
    ft.company_id,
    ft.sku,
    ft.marketplace,
    ft.market_country_code AS country,
    ft.marketplace_currency,
    ft.document_date,
    ft.quantity,
    ft.item_purchase_price,
    (ft.item_landed_cost - ft.item_purchase_price) AS item_logistics_cost,
    ft.item_landed_cost,
    ft.quantity * ft.item_landed_cost AS lost_amount_total,
    ft.destination_warehouse,
    ft.origin_warehouse
  FROM neonpanel_iceberg.fifo_transactions_snapshot ft
  CROSS JOIN date_range dr
  WHERE 1=1
    -- Partition pruning (REQUIRED for performance)
    AND ft.company_id IN ({{company_id_list}})
    
    -- CRITICAL: Only transactions where batch is NULL (lost tracking)
    AND ft.io_batch_id IS NULL
    
    -- Date range filter
    AND ft.document_date >= dr.start_date
    AND ft.document_date <= dr.end_date
    
    -- Optional filters (1=1 when empty)
    AND ({{sku_filter}})
    AND ({{marketplace_filter}})
    AND ({{country_filter}})
)

SELECT 
  transaction_id,
  company_id,
  sku,
  marketplace,
  country,
  marketplace_currency,
  CAST(document_date AS VARCHAR) AS document_date,
  quantity,
  ROUND(item_purchase_price, 2) AS item_purchase_price,
  ROUND(item_logistics_cost, 2) AS item_logistics_cost,
  ROUND(item_landed_cost, 2) AS item_landed_cost,
  ROUND(lost_amount_total, 2) AS lost_amount_total,
  destination_warehouse,
  origin_warehouse
FROM lost_transactions
ORDER BY lost_amount_total DESC
LIMIT {{limit}}
