-- Tool: inventory_valuation_analyze_shipment_discrepancy
-- Purpose: List shipment item shipped-vs-received quantities and discrepancies.
-- Data sources: neonpanel_iceberg inventory shipment and Amazon FBA inbound tables.

WITH params AS (
  SELECT
    {{company_ids_array}} AS company_ids,
    {{start_date_sql}} AS start_date,
    {{end_date_sql}} AS end_date,
    {{date_field_sql}} AS date_field,
    {{skus_array}} AS skus,
    {{shipment_ids_array}} AS shipment_ids,
    {{amazon_shipment_ids_array}} AS amazon_shipment_ids,
    {{marketplace_ids_array}} AS marketplace_ids,
    {{origin_warehouse_names_lower_array}} AS origin_warehouse_names_lower,
    {{destination_warehouse_names_lower_array}} AS destination_warehouse_names_lower,
    {{shipment_statuses_lower_array}} AS shipment_statuses_lower,
    {{shipment_types_lower_array}} AS shipment_types_lower,
    {{quantity_tolerance}} AS quantity_tolerance,
    {{discrepancy_only_sql}} AS discrepancy_only,
    {{include_inactive_sql}} AS include_inactive,
    {{include_cancelled_deleted_sql}} AS include_cancelled_deleted,
    {{limit_rows}} AS limit_rows
),

fba_inbound_ledger AS (
  SELECT
    fba.inventory_id,
    fba.amazon_shipment_id,
    SUM(COALESCE(CAST(fba.quantity AS BIGINT), 0)) AS quantity_received,
    MAX(fba.arrived_at) AS arrived_at
  FROM "{{catalog}}"."neonpanel_iceberg"."amazon_fba_inbound_shipment_ledger" fba
  WHERE fba.arrived_at IS NOT NULL
  GROUP BY fba.inventory_id, fba.amazon_shipment_id
),

shipment_lines AS (
  SELECT
    'same_marketplace' AS shipment_line_scope,
    ishp.company_id,
    ac.name AS company_name,
    ishp.id AS shipment_id,
    isi.id AS shipment_item_id,
    afis.marketplace_id AS marketplace_id,
    COALESCE(CAST(afis.amazon_marketplace_id AS VARCHAR), CAST(amo.amazon_marketplace_id AS VARCHAR)) AS amazon_marketplace_id,
    iw1.name AS origin,
    iw2.name AS destination,
    ishp.original_marketplace_id,
    ishp.destination_marketplace_id,
    CAST(ishp.shipped_at AS DATE) AS shipped_at,
    CAST(fil.arrived_at AS DATE) AS received_at,
    CAST(COALESCE(fil.arrived_at, ishp.arrived_at) AS DATE) AS arrived_at,
    CAST(afis.created_at AS DATE) AS created_at,
    CAST(afis.updated_at AS DATE) AS updated_at,
    COALESCE(ishp.name, afis.name, ishp.ref_number, afis.amazon_shipment_id) AS document_name,
    afis.amazon_shipment_id,
    afis.trackings,
    afis.amazon_status,
    CASE
      WHEN ishp.status = 8 THEN 'Closed'
      WHEN ishp.status = 7 THEN 'Receiving'
      WHEN ishp.status = 6 THEN 'Checked In'
      WHEN ishp.status = 5 THEN 'Delivered'
      WHEN ishp.status = 4 THEN 'In Transit'
      WHEN ishp.status = 3 THEN 'Shipped'
      WHEN ishp.status = 2 THEN 'Ready to Ship'
      WHEN ishp.status = 1 THEN 'Created'
      WHEN ishp.status = 9 THEN 'Cancelled'
      WHEN ishp.status = 0 THEN 'Working'
      WHEN ishp.status = 10 THEN 'Deleted'
      WHEN ishp.status = 11 THEN 'Error'
      ELSE 'Undefined'
    END AS shipment_status,
    ishp.status AS shipment_status_code,
    afis.from_postal_code,
    afis.carrier_name,
    afis.shipment_type,
    afis.amazon_reference_id,
    ishp.active AS active_status,
    iio.id AS inventory_id,
    apo.sku AS seller_sku,
    CONCAT(apo.sku, '-', CAST(ishp.company_id AS VARCHAR), '-', COALESCE(CAST(afis.amazon_marketplace_id AS VARCHAR), CAST(amo.amazon_marketplace_id AS VARCHAR))) AS fba_sku_key,
    CASE WHEN ishp.shipped_at IS NOT NULL THEN COALESCE(CAST(isi.quantity_shipped AS BIGINT), 0) ELSE 0 END AS quantity_shipped,
    CASE
      WHEN ishp.document_id IS NOT NULL THEN COALESCE(fil.quantity_received, 0)
      WHEN ishp.arrived_at IS NOT NULL THEN COALESCE(CAST(isi.quantity_received AS BIGINT), 0)
      ELSE 0
    END AS quantity_received
  FROM "{{catalog}}"."neonpanel_iceberg"."inventory_shipment_items" isi
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."inventory_shipments" ishp ON ishp.id = isi.shipment_id
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."amazon_fba_inbound_shipments" afis ON afis.id = ishp.document_id
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."inventory_items" iio ON iio.id = isi.original_inventory_id
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."app_products" apo ON apo.id = iio.product_id
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."amazon_marketplaces" amo ON amo.id = iio.marketplace_id
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."inventory_warehouses" iw1 ON iw1.id = ishp.original_warehouse_id
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."inventory_warehouses" iw2 ON iw2.id = ishp.destination_warehouse_id
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."app_companies" ac ON ac.id = ishp.company_id
  LEFT JOIN fba_inbound_ledger fil ON fil.amazon_shipment_id = ishp.ref_number AND fil.inventory_id = iio.id
  WHERE ishp.original_marketplace_id = ishp.destination_marketplace_id

  UNION ALL

  SELECT
    'destination_marketplace' AS shipment_line_scope,
    ishp.company_id,
    ac.name AS company_name,
    ishp.id AS shipment_id,
    isi.id AS shipment_item_id,
    afis.marketplace_id AS marketplace_id,
    COALESCE(CAST(afis.amazon_marketplace_id AS VARCHAR), CAST(amd.amazon_marketplace_id AS VARCHAR)) AS amazon_marketplace_id,
    iw1.name AS origin,
    iw2.name AS destination,
    ishp.original_marketplace_id,
    ishp.destination_marketplace_id,
    CAST(ishp.shipped_at AS DATE) AS shipped_at,
    CAST(fil.arrived_at AS DATE) AS received_at,
    CAST(COALESCE(fil.arrived_at, ishp.arrived_at) AS DATE) AS arrived_at,
    CAST(afis.created_at AS DATE) AS created_at,
    CAST(afis.updated_at AS DATE) AS updated_at,
    COALESCE(ishp.name, afis.name, ishp.ref_number, afis.amazon_shipment_id) AS document_name,
    afis.amazon_shipment_id,
    afis.trackings,
    afis.amazon_status,
    CASE
      WHEN ishp.status = 8 THEN 'Closed'
      WHEN ishp.status = 7 THEN 'Receiving'
      WHEN ishp.status = 6 THEN 'Checked In'
      WHEN ishp.status = 5 THEN 'Delivered'
      WHEN ishp.status = 4 THEN 'In Transit'
      WHEN ishp.status = 3 THEN 'Shipped'
      WHEN ishp.status = 2 THEN 'Ready to Ship'
      WHEN ishp.status = 1 THEN 'Created'
      WHEN ishp.status = 9 THEN 'Cancelled'
      WHEN ishp.status = 0 THEN 'Working'
      WHEN ishp.status = 10 THEN 'Deleted'
      WHEN ishp.status = 11 THEN 'Error'
      ELSE 'Undefined'
    END AS shipment_status,
    ishp.status AS shipment_status_code,
    afis.from_postal_code,
    afis.carrier_name,
    afis.shipment_type,
    afis.amazon_reference_id,
    ishp.active AS active_status,
    iid.id AS inventory_id,
    apd.sku AS seller_sku,
    CONCAT(apd.sku, '-', CAST(ishp.company_id AS VARCHAR), '-', COALESCE(CAST(afis.amazon_marketplace_id AS VARCHAR), CAST(amd.amazon_marketplace_id AS VARCHAR))) AS fba_sku_key,
    COALESCE(CAST(isi.quantity_shipped AS BIGINT), 0) AS quantity_shipped,
    CASE
      WHEN ishp.document_id IS NOT NULL THEN COALESCE(fil.quantity_received, 0)
      WHEN ishp.arrived_at IS NOT NULL THEN COALESCE(CAST(isi.quantity_received AS BIGINT), 0)
      ELSE 0
    END AS quantity_received
  FROM "{{catalog}}"."neonpanel_iceberg"."inventory_shipment_items" isi
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."inventory_shipments" ishp ON ishp.id = isi.shipment_id
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."amazon_fba_inbound_shipments" afis ON afis.id = ishp.document_id
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."inventory_items" iid ON iid.id = isi.destination_inventory_id
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."app_products" apd ON apd.id = iid.product_id
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."amazon_marketplaces" amd ON amd.id = iid.marketplace_id
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."inventory_warehouses" iw1 ON iw1.id = ishp.original_warehouse_id
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."inventory_warehouses" iw2 ON iw2.id = ishp.destination_warehouse_id
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."app_companies" ac ON ac.id = ishp.company_id
  LEFT JOIN fba_inbound_ledger fil ON fil.amazon_shipment_id = ishp.ref_number AND fil.inventory_id = iid.id
  WHERE ishp.original_marketplace_id <> ishp.destination_marketplace_id
),

enriched AS (
  SELECT
    sl.*,
    sl.quantity_shipped - sl.quantity_received AS quantity_discrepancy,
    ABS(sl.quantity_shipped - sl.quantity_received) AS absolute_discrepancy,
    CASE
      WHEN sl.quantity_shipped = 0 THEN NULL
      ELSE ROUND((CAST(sl.quantity_received AS DOUBLE) / CAST(sl.quantity_shipped AS DOUBLE)) * 100, 2)
    END AS received_rate_percent,
    CASE
      WHEN ABS(sl.quantity_shipped - sl.quantity_received) <= (SELECT quantity_tolerance FROM params) THEN 'matched_within_tolerance'
      WHEN sl.quantity_received = 0 AND sl.quantity_shipped > 0 THEN 'not_received'
      WHEN sl.quantity_received < sl.quantity_shipped THEN 'under_received'
      WHEN sl.quantity_received > sl.quantity_shipped THEN 'over_received'
      ELSE 'quantity_discrepancy'
    END AS discrepancy_status,
    CASE
      WHEN (SELECT date_field FROM params) = 'received_at' THEN sl.received_at
      WHEN (SELECT date_field FROM params) = 'arrived_at' THEN sl.arrived_at
      WHEN (SELECT date_field FROM params) = 'created_at' THEN sl.created_at
      WHEN (SELECT date_field FROM params) = 'updated_at' THEN sl.updated_at
      ELSE sl.shipped_at
    END AS selected_date
  FROM shipment_lines sl
),

filtered AS (
  SELECT e.*
  FROM enriched e
  CROSS JOIN params p
  WHERE contains(p.company_ids, e.company_id)
    AND e.selected_date >= p.start_date
    AND e.selected_date <= p.end_date
    AND (p.include_inactive = true OR COALESCE(CAST(e.active_status AS INTEGER), 1) <> 0)
    AND (p.include_cancelled_deleted = true OR e.shipment_status_code NOT IN (9, 10))
    AND (cardinality(p.skus) = 0 OR contains(p.skus, e.seller_sku))
    AND (cardinality(p.shipment_ids) = 0 OR contains(p.shipment_ids, e.shipment_id))
    AND (cardinality(p.amazon_shipment_ids) = 0 OR contains(p.amazon_shipment_ids, e.amazon_shipment_id))
    AND (cardinality(p.marketplace_ids) = 0 OR contains(p.marketplace_ids, CAST(e.marketplace_id AS VARCHAR)) OR contains(p.marketplace_ids, CAST(e.amazon_marketplace_id AS VARCHAR)))
    AND (cardinality(p.origin_warehouse_names_lower) = 0 OR contains(p.origin_warehouse_names_lower, lower(trim(e.origin))))
    AND (cardinality(p.destination_warehouse_names_lower) = 0 OR contains(p.destination_warehouse_names_lower, lower(trim(e.destination))))
    AND (cardinality(p.shipment_statuses_lower) = 0 OR contains(p.shipment_statuses_lower, lower(trim(e.shipment_status))))
    AND (cardinality(p.shipment_types_lower) = 0 OR contains(p.shipment_types_lower, lower(trim(CAST(e.shipment_type AS VARCHAR)))))
    AND (p.discrepancy_only = false OR e.absolute_discrepancy > p.quantity_tolerance)
)

SELECT
  company_id,
  company_name,
  shipment_id,
  shipment_item_id,
  shipment_line_scope,
  marketplace_id,
  amazon_marketplace_id,
  origin,
  destination,
  CAST(shipped_at AS VARCHAR) AS shipped_at,
  CAST(received_at AS VARCHAR) AS received_at,
  CAST(arrived_at AS VARCHAR) AS arrived_at,
  CAST(created_at AS VARCHAR) AS created_at,
  CAST(updated_at AS VARCHAR) AS updated_at,
  CAST(selected_date AS VARCHAR) AS selected_date,
  document_name,
  amazon_shipment_id,
  trackings,
  amazon_status,
  shipment_status,
  shipment_status_code,
  from_postal_code,
  carrier_name,
  shipment_type,
  amazon_reference_id,
  active_status,
  inventory_id,
  seller_sku,
  fba_sku_key,
  quantity_shipped,
  quantity_received,
  quantity_discrepancy,
  absolute_discrepancy,
  received_rate_percent,
  discrepancy_status
FROM filtered
{{order_by_clause}}
LIMIT {{limit_rows}}
