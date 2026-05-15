WITH fba_inbound_ledger as (
SELECT 
   fba.`sku`, 
   fba.inventory_id as inventory_id, 
   sum(fba.`quantity`) as 'quantity', 
   fba.`amazon_shipment_id`,
   max(fba.arrived_at) as 'arrived_at' 
FROM `amazon_fba_inbound_shipment_ledger` fba 
LEFT JOIN inventory_items ii ON ii.id = fba.inventory_id
LEFT JOIN inventory_items iip ON iip.id = ii.parent_id
WHERE fba.`arrived_at` is NOT NULL
GROUP BY fba.`inventory_id`,fba.`amazon_shipment_id`
)

-- this part is for same marketplace shipments only
SELECT 
    ishp.company_id AS 'Company ID', 
    ac.name AS 'Company',
    afis.`marketplace_id` AS 'Marketplace ID', 
    iw1.name AS 'Origin',
    iw2.name AS 'Destination',
    COALESCE(ishp.shipped_at,NULL) AS 'Shipped Date', 
    fil.arrived_at AS 'Date Products Received',
    coalesce(fil.arrived_at,ishp.arrived_at) AS 'Date Product Arrived', 
    coalesce(ishp.`name`,afis.name,ishp.ref_number,afis.amazon_shipment_id) AS 'Document', 
    afis.`amazon_shipment_id` AS 'Amazon Shipment ID', 
    afis.`trackings` AS 'Trackings', 
    afis.`amazon_status` AS 'Amazon Status',
    CASE 
         when clm.name is not NULL then clm.name
         when ishp.`status`= 8 then 'Closed'
         when ishp.`status`= 7 then 'Receiving'
         when ishp.`status`= 6 then 'Checked In'
         when ishp.`status`= 5 then 'Delivered'
         when ishp.`status`= 4 then 'In Transit'
         when ishp.`status`= 3 then 'Shipped'
         when ishp.`status`= 2 then 'Ready to Ship'
         when ishp.`status`= 1 then 'Created'
         when ishp.`status`= 9 then 'Cancelled'
         when ishp.`status`= 0 then 'Working'
         when ishp.`status`= 10 then 'Deleted'
         when ishp.`status`= 11 then 'Error'
     ELSE 'Undefined' 
    END AS 'Shipment Status',
    afis.`from_postal_code` AS 'From Postal Code', 
    afis.`carrier_name` AS 'Carrier Name', 
    afis.`shipment_type` AS 'Shipment Type',
    coalesce(ishp.`name`,afis.name,ishp.ref_number,afis.amazon_shipment_id) AS 'Shipment', 
    afis.`amazon_reference_id` AS 'Amazon Reference ID', 
    afis.`created_at` AS 'Created At', 
    afis.`updated_at` AS 'Updated At',
    if(ishp.shipped_at is not NULL, isi.`quantity_shipped`,0) AS 'Quantity Shipped', 
    if(ishp.document_id is not NULL,coalesce(fil.`quantity`,0),
          if(ishp.arrived_at is not NULL, isi.quantity_received,0) 
                ) AS 'Quantity Received', 
    apo.`sku` AS 'Seller SKU',
    ishp.active AS 'Active Status', 
    CONCAT(apo.`sku`, '-', ishp.company_id, '-', coalesce(afis.`amazon_marketplace_id`,amo.`amazon_marketplace_id`)) AS 'fba_sku_key'
FROM `inventory_shipment_items` isi
LEFT JOIN `inventory_shipments` ishp ON ishp.id = isi.shipment_id
LEFT JOIN `amazon_fba_inbound_shipments` afis ON afis.id = ishp.document_id
LEFT JOIN `inventory_items` iio on iio.id = isi.original_inventory_id
LEFT JOIN `app_products` apo ON apo.id = iio.product_id
LEFT JOIN `amazon_marketplaces` amo ON amo.id = iio.marketplace_id 
LEFT JOIN `inventory_warehouses` iw1 ON iw1.id = ishp.original_warehouse_id
LEFT JOIN `inventory_warehouses` iw2 ON iw2.id = ishp.destination_warehouse_id 
LEFT JOIN `app_companies` ac ON ac.id = ishp.company_id
left join `app_tasks` p on p.extension_id = ishp.id AND substring(p.extension_type,12) = 'Shipment' 
left join app_tasks t on t.task_id = p.id and t.content = 'Item List'
left join app_columns clm on clm.id = p.column_id
left join app_processes pss on pss.id = clm.process_id
LEFT JOIN fba_inbound_ledger fil ON fil.`amazon_shipment_id` = ishp.ref_number AND fil.inventory_id = iio.id
WHERE true
AND original_marketplace_id = destination_marketplace_id

UNION ALL

-- this part is for destination marketplace shipments only
SELECT 
    ishp.company_id AS 'Company ID', 
    ac.name AS 'Company',
    afis.`marketplace_id` AS 'Marketplace ID', 
    iw1.name AS 'Origin',
    iw2.name AS 'Destination',
    COALESCE(ishp.shipped_at,NULL) AS 'Shipped Date', 
    fil.arrived_at AS 'Date Products Received',
    coalesce(fil.arrived_at,ishp.arrived_at) AS 'Date Product Arrived', 
    coalesce(ishp.`name`,afis.name,ishp.ref_number,afis.amazon_shipment_id) AS 'Document', 
    afis.`amazon_shipment_id` AS 'Amazon Shipment ID', 
    afis.`trackings` AS 'Trackings', 
    afis.`amazon_status` AS 'Amazon Status',
    CASE 
         when clm.name is not NULL then clm.name
         when ishp.`status`= 8 then 'Closed'
         when ishp.`status`= 7 then 'Receiving'
         when ishp.`status`= 6 then 'Checked In'
         when ishp.`status`= 5 then 'Delivered'
         when ishp.`status`= 4 then 'In Transit'
         when ishp.`status`= 3 then 'Shipped'
         when ishp.`status`= 2 then 'Ready to Ship'
         when ishp.`status`= 1 then 'Created'
         when ishp.`status`= 0 then 'Working'
         when ishp.`status`= 9 then 'Cancelled'
         when ishp.`status`= 10 then 'Deleted'
         when ishp.`status`= 11 then 'Error'
     ELSE 'Undefined' 
    END AS 'Shipment Status',
    afis.`from_postal_code` AS 'From Postal Code', 
    afis.`carrier_name` AS 'Carrier Name', 
    afis.`shipment_type` AS 'Shipment Type',
    coalesce(ishp.`name`,afis.name,ishp.ref_number,afis.amazon_shipment_id) AS 'Shipment', 
    afis.`amazon_reference_id` AS 'Amazon Reference ID', 
    afis.`created_at` AS 'Created At', 
    afis.`updated_at` AS 'Updated At',
    isi.quantity_shipped AS 'Quantity Shipped', 
    if(ishp.document_id is not NULL,coalesce(fil.`quantity`,0),
          if(ishp.arrived_at is not NULL, isi.quantity_received,0) 
                ) AS 'Quantity Received',  
    apd.`sku` AS 'Seller SKU',
    ishp.active AS 'Active Status', 
    CONCAT(apd.`sku`, '-', ishp.company_id, '-', coalesce(afis.`amazon_marketplace_id`,amd.`amazon_marketplace_id`)) AS 'fba_sku_key'
FROM `inventory_shipment_items` isi
LEFT JOIN `inventory_shipments` ishp ON ishp.id = isi.shipment_id
LEFT JOIN `amazon_fba_inbound_shipments` afis ON afis.id = ishp.document_id
LEFT JOIN `inventory_items` iid on iid.id = isi.destination_inventory_id
LEFT JOIN `app_products` apd ON apd.id = iid.product_id
LEFT JOIN `amazon_marketplaces` amd ON amd.id = iid.marketplace_id 
LEFT JOIN `inventory_warehouses` iw1 ON iw1.id = ishp.original_warehouse_id
LEFT JOIN `inventory_warehouses` iw2 ON iw2.id = ishp.destination_warehouse_id 
LEFT JOIN `app_companies` ac ON ac.id = ishp.company_id
left join `app_tasks` p on p.extension_id = ishp.id AND substring(p.extension_type,12) = 'Shipment' 
left join app_tasks t on t.task_id = p.id and t.content = 'Item List'
left join app_columns clm on clm.id = p.column_id
left join app_processes pss on pss.id = clm.process_id
LEFT JOIN fba_inbound_ledger fil ON fil.`amazon_shipment_id` = ishp.ref_number AND fil.inventory_id = iid.id
WHERE true
AND original_marketplace_id <> destination_marketplace_id