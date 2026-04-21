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
  created_by,
  updated_by,
  notes
FROM "{{catalog}}"."brand_analytics_iceberg"."analytics_watchlist"
WHERE {{company_filter_sql}}
  AND {{marketplace_filter_sql}}
  AND {{watchlist_name_filter_sql}}
  AND {{grain_filter_sql}}
  AND {{cadence_filter_sql}}
  AND {{focus_filter_sql}}
  AND {{owner_filter_sql}}
  AND {{active_filter_sql}}
ORDER BY company_id, marketplace, watchlist_name
LIMIT {{limit_top_n}}
