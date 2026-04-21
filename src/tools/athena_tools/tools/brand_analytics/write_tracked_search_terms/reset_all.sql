UPDATE "{{catalog}}"."brand_analytics_iceberg"."tracked_search_terms"
SET is_active = FALSE
WHERE company_id = {{company_id}}
  AND is_active = TRUE
