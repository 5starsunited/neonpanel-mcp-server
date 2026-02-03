-- Shipment Arrival Oracle: Monitor in-transit shipments with predictive ETAs
-- Statistical arrival predictions based on historical warehouse-to-warehouse performance

SELECT
  s.shipment_id,
  s.shipment_name,
  s.ref_number,
  s.shipment_status,
  s.original_warehouse_name,
  s.destination_warehouse_name,
  s.origin_country_code,
  s.destination_country_code,
  s.date_shipped,
  
  -- Days in transit calculation
  DATE_DIFF('day', CAST(s.date_shipped AS DATE), CURRENT_DATE) AS days_in_transit,
  
  -- Carrier tracking data
  s.tracked_eta,
  s.first_tracked_eta,
  
  -- Statistical ETA predictions (from historical data)
  s.p50_eta,
  s.p80_eta,
  s.p95_eta,
  
  -- Delay calculation: how many days beyond P80 estimate
  CASE 
    WHEN s.tracked_eta IS NOT NULL AND s.p80_eta IS NOT NULL 
    THEN DATE_DIFF('day', s.p80_eta, s.tracked_eta)
    ELSE NULL
  END AS delay_days,
  
  -- Actionable signals
  s.signals,
  
  -- Arrival and receipt status
  s.arrived_at,
  s.total_items_received,
  
  -- Tracking details (JSON)
  s.shipment_tracking_details

FROM neonpanel_iceberg.inventory_shipments_snapshot s

WHERE 1=1
  {{#company_id}}AND s.company_id = {{company_id}}{{/company_id}}
  {{#shipment_status_filter}}AND s.shipment_status IN ({{shipment_status_filter}}){{/shipment_status_filter}}
  {{#destination_warehouse_filter}}AND LOWER(s.destination_warehouse_name) LIKE LOWER('%{{destination_warehouse_name}}%'){{/destination_warehouse_filter}}
  {{#original_warehouse_filter}}AND LOWER(s.original_warehouse_name) LIKE LOWER('%{{original_warehouse_name}}%'){{/original_warehouse_filter}}
  {{#origin_country_filter}}AND s.origin_country_code IN ({{origin_country_filter}}){{/origin_country_filter}}
  {{#destination_country_filter}}AND s.destination_country_code IN ({{destination_country_filter}}){{/destination_country_filter}}
  {{#delay_threshold_filter}}AND (
    CASE 
      WHEN s.tracked_eta IS NOT NULL AND s.p80_eta IS NOT NULL 
      THEN DATE_DIFF('day', s.p80_eta, s.tracked_eta)
      ELSE NULL
    END >= {{delay_threshold_days}}
  ){{/delay_threshold_filter}}
  {{#min_days_in_transit_filter}}AND DATE_DIFF('day', CAST(s.date_shipped AS DATE), CURRENT_DATE) >= {{min_days_in_transit}}{{/min_days_in_transit_filter}}
  {{#exclude_received}}AND s.arrived_at IS NULL{{/exclude_received}}

{{#sort_clause}}ORDER BY {{sort_clause}}{{/sort_clause}}
{{#limit}}LIMIT {{limit}}{{/limit}}
