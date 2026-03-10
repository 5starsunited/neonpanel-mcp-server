SELECT
  sfy.id AS "Balance ID",
  sfy.company_id AS "Company ID",
  c.name as "Company",
  sfy.seller_id AS "Seller ID",
  sfy.date AS "Snapshot Date",
  sfy.type AS "Balance Type",
  sfy.inventory_id AS "Inventory ID",
  w.name AS "Warehouse Name",
  sfy.quantity AS "Stock Quantity",
  sfy.shopify_variant_id AS "Shopify Variant ID",
  sfy.sku AS "Product SKU",
  sfy.barcode AS "Barcode",
  sfy.synced_at AS "Last Sync Timestamp",
  sl.name AS "Seller Name",
  sl.status AS "Store Status",
  sl.domain AS "Store Domain",
  sl.state AS "Connection State"

FROM "neonpanel_iceberg"."shopify_balances" sfy
LEFT JOIN "neonpanel_iceberg"."shopify_sellers" sl
  ON sl.id = sfy.seller_id
  AND sfy.company_id = sl.company_id
LEFT JOIN "neonpanel_iceberg"."inventory_warehouses" w 
  ON w.id = sfy.warehouse_id
LEFT JOIN "neonpanel_iceberg"."app_companies" c 
  ON c.id = sfy.company_id