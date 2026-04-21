SELECT
  company_id,
  marketplace,
  watchlist_name,
  grain,
  entity_ids,
  cadence,
  focus,
  owner,
  last_run_at,
  is_active,
  created_at,
  updated_at,
  notes
FROM "{{catalog}}"."brand_analytics_iceberg"."analytics_watchlist"
WHERE company_id = {{company_id}}
  AND marketplace = {{marketplace_literal}}
  AND LOWER(watchlist_name) = {{watchlist_name_literal_lower}}
  AND is_active = TRUE
LIMIT 1
