-- Tool: inventory_health_scorecard
-- Draft SQL scaffold. Replace NULL columns with real fields/expressions and update FROM/WHERE as needed.
-- This draft intentionally enumerates all output fields from the tool JSON (flattened).

SELECT
  company_id,
  NULL AS kpis_sku_count,
  NULL AS kpis_stockout_risk_sku_count,
  NULL AS kpis_overstock_risk_sku_count,
  NULL AS kpis_median_days_of_supply,
  NULL AS kpis_total_units_on_hand,
  NULL AS breakdown_group,
  NULL AS breakdown_sku_count,
  NULL AS breakdown_stockout_risk_sku_count,
  NULL AS breakdown_overstock_risk_sku_count,
  NULL AS breakdown_median_days_of_supply
FROM "{{catalog}}"."{{database}}"."{{table}}"
WHERE company_id IN ({{companyIdsSql}})
LIMIT {{topN}}
