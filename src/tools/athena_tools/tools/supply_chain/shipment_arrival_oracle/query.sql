-- Shipment Arrival Oracle: Monitor in-transit shipments with predictive ETAs
-- Statistical arrival predictions based on historical warehouse-to-warehouse performance

SELECT
  s.shipment_id,
  s.shipment_name,
  s.ref_number,
  s.shipment_type,
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
  
  -- Historical data quality indicators
  CASE WHEN s.p80_eta IS NOT NULL THEN TRUE ELSE FALSE END AS has_historical_data,
  
  -- Delay calculation: how many days beyond P80 estimate
  CASE 
    WHEN s.tracked_eta IS NOT NULL AND s.p80_eta IS NOT NULL 
    THEN DATE_DIFF('day', s.p80_eta, s.tracked_eta)
    ELSE NULL
  END AS delay_days,
  
  -- Urgency score: combines delay severity and time in transit
  -- Higher score = more urgent (max 100)
  CASE
    WHEN s.arrived_at IS NOT NULL AND (s.total_items_received IS NULL OR s.total_items_received = 0) THEN 100  -- Ghost shipment = highest urgency
    ELSE LEAST(100, GREATEST(0,
      -- Delay component (0-50 points): days past P80
      COALESCE(
        CASE 
          WHEN s.tracked_eta IS NOT NULL AND s.p80_eta IS NOT NULL 
          THEN GREATEST(0, DATE_DIFF('day', s.p80_eta, s.tracked_eta)) * 5
          ELSE 0
        END, 0
      ) +
      -- Time in transit component (0-50 points): days in transit penalty
      CASE 
        WHEN DATE_DIFF('day', CAST(s.date_shipped AS DATE), CURRENT_DATE) > 30 THEN 50
        WHEN DATE_DIFF('day', CAST(s.date_shipped AS DATE), CURRENT_DATE) > 14 THEN 30
        WHEN DATE_DIFF('day', CAST(s.date_shipped AS DATE), CURRENT_DATE) > 7 THEN 15
        ELSE 0
      END
    ))
  END AS urgency_score,
  
  -- Actionable signals
  s.signals,
  
  -- Arrival and receipt status
  s.arrived_at,
  s.total_items_received,
  
  -- Tracking details (JSON)
  s.shipment_tracking_details

FROM neonpanel_iceberg.inventory_shipments_snapshot s

WHERE s.company_id = {{company_id}}
  AND {{shipment_type_filter}}
  AND {{shipment_status_filter}}
  AND {{destination_warehouse_filter}}
  AND {{original_warehouse_filter}}
  AND {{origin_country_filter}}
  AND {{destination_country_filter}}
  AND {{delay_threshold_filter}}
  AND {{min_days_in_transit_filter}}
  AND {{exclude_received_filter}}
  AND {{signal_filter}}
  AND {{shipped_after_filter}}
  AND {{shipped_before_filter}}
  AND {{eta_before_filter}}
  AND {{search_filter}}

ORDER BY {{sort_clause}}
LIMIT {{limit}}

