-- Export Monthly Unit Costs
-- Returns latest purchase price, logistics cost, and landed cost per SKU per month
-- Suitable for uploading to Sellerboard or other profitability tools

WITH date_range AS (
  SELECT 
    {{start_date}} AS start_date,
    {{end_date}} AS end_date
),

filtered_transactions AS (
  SELECT 
    ft.company_id,
    ft.marketplace,
    ft.market_country_code AS country,
    ft.marketplace_currency,
    ft.sku,
    ft.document_date,
    YEAR(ft.document_date) AS year,
    MONTH(ft.document_date) AS month,
    FORMAT('%d-%02d', YEAR(ft.document_date), MONTH(ft.document_date)) AS year_month,
    ft.item_purchase_price AS purchase_price,
    ft.item_logistics_cost AS logistics_cost,
    ft.item_landed_cost AS landed_cost,
    ft.transaction_id
  FROM neonpanel_iceberg.fifo_transactions_snapshot ft
  CROSS JOIN date_range dr
  WHERE 1=1
    -- Partition pruning (REQUIRED for performance)
    AND ft.company_id IN ({{company_id_list}})
    
    -- Date range filter
    AND ft.document_date >= dr.start_date
    AND ft.document_date <= dr.end_date
    
    -- Optional filters (1=1 when empty array)
    AND ({{sku_filter}})
    AND ({{marketplace_filter}})
    AND ({{country_filter}})
    
    -- Only sales invoices have relevant cost data
    AND ft.document_type = 'Invoice'
    
    -- Exclude transactions with missing cost data
    AND ft.item_landed_cost IS NOT NULL
    AND ft.item_landed_cost > 0
),

ranked_costs AS (
  SELECT 
    *,
    ROW_NUMBER() OVER (
      PARTITION BY company_id, marketplace, sku, year, month 
      ORDER BY document_date DESC, transaction_id DESC
    ) AS rn
  FROM filtered_transactions
),

latest_monthly_costs AS (
  SELECT 
    company_id,
    marketplace,
    country,
    marketplace_currency,
    sku,
    year,
    month,
    year_month,
    purchase_price,
    logistics_cost,
    landed_cost,
    document_date AS last_updated
  FROM ranked_costs
  WHERE rn = 1
)

SELECT 
  company_id,
  marketplace,
  country,
  marketplace_currency,
  sku,
  year,
  month,
  year_month,
  ROUND(purchase_price, 2) AS purchase_price,
  ROUND(logistics_cost, 2) AS logistics_cost,
  ROUND(landed_cost, 2) AS landed_cost,
  CAST(last_updated AS VARCHAR) AS last_updated
FROM latest_monthly_costs
ORDER BY {{sort_field}} {{sort_direction}}
LIMIT {{limit}}
