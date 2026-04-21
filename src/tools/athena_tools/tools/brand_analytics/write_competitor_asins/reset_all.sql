-- Reset: deactivate ALL competitor entries for the company (soft delete).
UPDATE "{{catalog}}"."brand_analytics_iceberg"."competitor_asins"
SET is_active = FALSE
WHERE company_id = {{company_id}}
  AND is_active = TRUE
