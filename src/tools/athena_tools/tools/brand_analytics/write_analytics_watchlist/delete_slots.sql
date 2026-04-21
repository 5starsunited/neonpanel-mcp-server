-- Delete existing rows for specific slots before INSERT (upsert semantics).
-- Slot key: (marketplace, LOWER(watchlist_name)).
DELETE FROM "{{catalog}}"."brand_analytics_iceberg"."analytics_watchlist"
WHERE company_id = {{company_id}}
  AND (marketplace, LOWER(watchlist_name)) IN (
    {{slots_in_clause}}
  )
