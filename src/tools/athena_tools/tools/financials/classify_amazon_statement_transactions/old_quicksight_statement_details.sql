with st_detailes AS (
SELECT 
  merchant_order_id,
  adjustment_id,
  shipment_id,
  order_id,
  merchant_order_item_id,
  merchant_order_item_code,
  merchant_adjustment_item_id,
  promotion_id,
  sku,
  original_subclass as "Subclass",
  'Statements' AS "Data Source",
  fulfillment_id AS "Channel", 
  CAST(69 as INTEGER) AS "PnL Class ID",
  'Statements' AS "Data Type", 
  nprt.transaction_date AS "Transaction Date",
  substr(cast(nprt.transaction_date as varchar), 1, 10) as "Str Date",
  nprt.transaction_type AS "Transaction Type", 
  nprt.amount_type AS "Amount Type", 
  nprt.amount_description AS "Amount Description", 
  nprt.quantity AS "Transaction Quantity",
  nprt.amount AS "Transaction Amount",
  nprt.debit AS "debit",
  nprt.credit AS "credit",
  s.marketplace AS "Marketplace",
  CAST(nprt.company_id as INTEGER) AS "Company ID",
  s.country AS "Country",
  s.currency AS "Currency",
  nprt.currency AS "Orig Currency",
  'undefined' AS "expense_key",
  nprt.amazon_statement_id AS "Amazon Statement ID",
  nprt."filename"
FROM "sp_api"."amazon_statement_details" nprt
LEFT JOIN "sp_api"."duplicate_free_statement_list" s ON s.settlement_id = nprt.amazon_statement_id
)
SELECT sd.* FROM st_detailes sd
JOIN "sp_api"."duplicate_free_statement_list" s on s.filename = sd.filename
WHERE substring(CAST("Transaction Date" as VARCHAR),1,4) >= '2024'