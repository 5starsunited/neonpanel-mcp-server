-- Test COGS Query for Company 106, US Market, December 2025
-- Compare result with NeonPanel report: $248,939.55

SELECT 
  '2025-12' AS month,
  SUM(-1 * ft.transaction_amount) AS cogs_amount,
  SUM(-1 * ft.quantity) AS units_sold,
  COUNT(*) AS transactions_count,
  SUM(CASE WHEN COALESCE(ft.item_landed_cost, 0) > 0 THEN -1 * ft.quantity ELSE 0 END) AS units_with_cost,
  SUM(CASE WHEN COALESCE(ft.item_landed_cost, 0) = 0 THEN -1 * ft.quantity ELSE 0 END) AS units_missing_cost,
  ROUND(100.0 * SUM(CASE WHEN COALESCE(ft.item_landed_cost, 0) > 0 THEN -1 * ft.quantity ELSE 0 END) / 
    NULLIF(SUM(-1 * ft.quantity), 0), 2) AS cogs_quality_pct
FROM awsdatacatalog.neonpanel_iceberg.fifo_transactions_snapshot ft
WHERE 1=1
  -- Company filter
  AND ft.company_id = 106
  
  -- Invoice transactions only
  AND ft.document_type = 'Invoice'
  
  -- US market only
  AND ft.market_country_code = 'US'
  
  -- December 2025
  AND ft.document_date >= DATE '2025-12-01'
  AND ft.document_date <= DATE '2025-12-31'
  
  -- Data quality filters
  AND ft.quantity IS NOT NULL
  AND ft.quantity != 0
  AND ft.transaction_amount IS NOT NULL
