UPDATE "{{catalog}}"."brand_analytics_iceberg"."analytics_watchlist"
SET last_run_at = current_timestamp,
    updated_at = current_timestamp,
    updated_by = {{updated_by_literal}}
WHERE company_id = {{company_id}}
  AND marketplace = {{marketplace_literal}}
  AND LOWER(watchlist_name) = {{watchlist_name_literal_lower}}
