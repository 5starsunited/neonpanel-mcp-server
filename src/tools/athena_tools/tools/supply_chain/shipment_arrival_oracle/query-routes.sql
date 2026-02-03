-- Shipment Arrival Oracle: Route Aggregation Mode
-- Aggregates shipment performance by origin→destination warehouse pairs

SELECT
  s.original_warehouse_name AS origin_warehouse,
  s.destination_warehouse_name AS destination_warehouse,
  s.origin_country_code,
  s.destination_country_code,
  
  -- Shipment counts
  COUNT(*) AS total_shipments,
  COUNT(CASE WHEN s.arrived_at IS NULL THEN 1 END) AS in_transit_count,
  COUNT(CASE WHEN s.arrived_at IS NOT NULL THEN 1 END) AS completed_count,
  
  -- Transit time statistics (days)
  AVG(DATE_DIFF('day', CAST(s.date_shipped AS DATE), COALESCE(CAST(s.arrived_at AS DATE), CURRENT_DATE))) AS avg_days_in_transit,
  APPROX_PERCENTILE(DATE_DIFF('day', CAST(s.date_shipped AS DATE), COALESCE(CAST(s.arrived_at AS DATE), CURRENT_DATE)), 0.5) AS median_days_in_transit,
  MAX(DATE_DIFF('day', CAST(s.date_shipped AS DATE), COALESCE(CAST(s.arrived_at AS DATE), CURRENT_DATE))) AS max_days_in_transit,
  
  -- Delay statistics
  AVG(CASE 
    WHEN s.tracked_eta IS NOT NULL AND s.p80_eta IS NOT NULL 
    THEN DATE_DIFF('day', s.p80_eta, s.tracked_eta)
    ELSE NULL
  END) AS avg_delay_days,
  
  -- Reliability metrics
  COUNT(CASE 
    WHEN s.arrived_at IS NOT NULL AND s.p80_eta IS NOT NULL 
         AND CAST(s.arrived_at AS DATE) <= s.p80_eta THEN 1 
  END) * 100.0 / NULLIF(COUNT(CASE WHEN s.arrived_at IS NOT NULL AND s.p80_eta IS NOT NULL THEN 1 END), 0) AS reliability_pct,
  
  -- Problem indicators
  COUNT(CASE 
    WHEN s.arrived_at IS NOT NULL AND (s.total_items_received IS NULL OR s.total_items_received = 0) THEN 1 
  END) AS ghost_shipment_count,
  COUNT(CASE 
    WHEN s.tracked_eta IS NOT NULL AND s.p80_eta IS NOT NULL 
         AND DATE_DIFF('day', s.p80_eta, s.tracked_eta) > 0 THEN 1 
  END) AS delayed_count,
  
  -- Statistical ETA benchmarks (most recent values for this route)
  MAX(s.p50_eta) AS latest_p50_eta,
  MAX(s.p80_eta) AS latest_p80_eta,
  MAX(s.p95_eta) AS latest_p95_eta

FROM neonpanel_iceberg.inventory_shipments_snapshot s

WHERE s.company_id = {{company_id}}
  AND {{shipment_status_filter}}
  AND {{destination_warehouse_filter}}
  AND {{original_warehouse_filter}}
  AND {{origin_country_filter}}
  AND {{destination_country_filter}}
  AND {{shipped_after_filter}}
  AND {{shipped_before_filter}}

GROUP BY 
  s.original_warehouse_name,
  s.destination_warehouse_name,
  s.origin_country_code,
  s.destination_country_code

ORDER BY {{sort_clause}}
LIMIT {{limit}}
