UPDATE "{{catalog}}"."brand_analytics_iceberg"."analytics_watchlist"
SET is_active = FALSE,
    updated_at = current_timestamp,
    updated_by = {{updated_by_literal}}
WHERE company_id = {{company_id}}
  AND is_active = TRUE
