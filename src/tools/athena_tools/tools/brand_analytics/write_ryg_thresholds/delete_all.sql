-- Delete ALL company-specific overrides (reset to defaults).
DELETE FROM "{{catalog}}"."brand_analytics_iceberg"."ryg_thresholds"
WHERE company_id = {{company_id}}
