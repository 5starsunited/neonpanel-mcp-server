-- Tool: cogs_list_fifo_transactions
-- Purpose: List raw FIFO transactions with bounded period and optional item, warehouse, batch, and document filters.
-- Data source: neonpanel_iceberg.fifo_transactions_snapshot

WITH params AS (
  SELECT
    {{company_ids_array}} AS company_ids,
    DATE {{start_date}} AS start_date,
    DATE {{end_date}} AS end_date,
    {{inventory_ids_array}} AS inventory_ids,
    {{skus_array}} AS skus,
    {{marketplaces_array}} AS marketplaces,
    {{warehouses_array}} AS warehouses,
    {{origin_warehouses_array}} AS origin_warehouses,
    {{destination_warehouses_array}} AS destination_warehouses,
    {{io_batch_ids_array}} AS io_batch_ids,
    {{batch_ids_array}} AS batch_ids,
    {{document_ids_array}} AS document_ids,
    {{document_types_array}} AS document_types,
    {{document_ref_numbers_array}} AS document_ref_numbers,
    {{transaction_ids_array}} AS transaction_ids
),

filtered_transactions AS (
  SELECT
    ft.transaction_id,
    ft.company_id,
    ft.company,
    ft.company_short_name,
    ft.inventory_id,
    ft.fnsku,
    ft.sku,
    ft.brand,
    ft.product_family,
    ft.child_asin,
    ft.parent_asin,
    ft.vendor,
    ft.marketplace,
    ft.marketplace_currency,
    ft.country,
    ft.market_country_code,
    ft.mode,
    ft.status,
    ft.io_batch_id,
    ft.io_batch_name,
    ft.io_batch_ref_number,
    ft.ao_batch_id,
    ft.ao_batch_name,
    ft.ao_batch_ref_number,
    ft.received_date,
    ft.assembled_date,
    ft.batch_document_type,
    ft.batch_document_id AS batch_id,
    ft.batch_document_name AS batch_name,
    ft.batch_document_ref_number AS batch_ref_number,
    ft.doc_key,
    ft.io_batch_balance,
    ft.batch_balance,
    ft.warehouse_balance,
    ft.origin_warehouse,
    ft.destination_warehouse,
    ft.shipment_destination,
    ft.document_type,
    ft.document_id,
    ft.document_date,
    ft.document_name,
    ft.document_ref_number,
    ft.transaction_updated_at,
    ft.quantity,
    ft.item_purchase_price,
    ft.item_landed_cost,
    ft.transaction_amount
  FROM awsdatacatalog.neonpanel_iceberg.fifo_transactions_snapshot ft
  CROSS JOIN params p
  WHERE contains(p.company_ids, ft.company_id)
    AND ft.document_date >= p.start_date
    AND ft.document_date <= p.end_date
    AND (cardinality(p.inventory_ids) = 0 OR contains(p.inventory_ids, ft.inventory_id))
    AND (cardinality(p.skus) = 0 OR contains(p.skus, ft.sku))
    AND (cardinality(p.marketplaces) = 0 OR contains(p.marketplaces, ft.marketplace))
    AND (cardinality(p.warehouses) = 0 OR contains(p.warehouses, ft.origin_warehouse) OR contains(p.warehouses, ft.destination_warehouse) OR contains(p.warehouses, ft.shipment_destination))
    AND (cardinality(p.origin_warehouses) = 0 OR contains(p.origin_warehouses, ft.origin_warehouse))
    AND (cardinality(p.destination_warehouses) = 0 OR contains(p.destination_warehouses, ft.destination_warehouse))
    AND (cardinality(p.io_batch_ids) = 0 OR contains(p.io_batch_ids, ft.io_batch_id))
    AND (cardinality(p.batch_ids) = 0 OR contains(p.batch_ids, ft.batch_document_id))
    AND (cardinality(p.document_ids) = 0 OR contains(p.document_ids, ft.document_id))
    AND (cardinality(p.document_types) = 0 OR contains(p.document_types, ft.document_type))
    AND (cardinality(p.document_ref_numbers) = 0 OR contains(p.document_ref_numbers, ft.document_ref_number))
    AND (cardinality(p.transaction_ids) = 0 OR contains(p.transaction_ids, ft.transaction_id))
)

SELECT
  transaction_id,
  company_id,
  company,
  company_short_name,
  inventory_id,
  fnsku,
  sku,
  brand,
  product_family,
  child_asin,
  parent_asin,
  vendor,
  marketplace,
  marketplace_currency,
  country,
  market_country_code,
  mode,
  status,
  io_batch_id,
  io_batch_name,
  io_batch_ref_number,
  ao_batch_id,
  ao_batch_name,
  ao_batch_ref_number,
  CAST(received_date AS VARCHAR) AS received_date,
  CAST(assembled_date AS VARCHAR) AS assembled_date,
  batch_document_type,
  batch_id,
  batch_name,
  batch_ref_number,
  doc_key,
  io_batch_balance,
  batch_balance,
  warehouse_balance,
  origin_warehouse,
  destination_warehouse,
  shipment_destination,
  document_type,
  document_id,
  CAST(document_date AS VARCHAR) AS document_date,
  document_name,
  document_ref_number,
  CAST(transaction_updated_at AS VARCHAR) AS transaction_updated_at,
  quantity,
  item_purchase_price,
  item_landed_cost,
  transaction_amount
FROM filtered_transactions
ORDER BY {{sort_field}} {{sort_direction}}, transaction_id DESC
LIMIT {{limit_rows}}