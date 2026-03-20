-- Delete existing company-specific thresholds for specific (tool, signal_group, metric, color) slots.
-- Used before INSERT to achieve upsert semantics.
DELETE FROM "{{catalog}}"."brand_analytics_iceberg"."ryg_thresholds"
WHERE company_id = {{company_id}}
  AND (tool, signal_group, metric, color) IN (
    {{slots_in_clause}}
  )
