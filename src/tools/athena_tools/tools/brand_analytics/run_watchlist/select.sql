-- Read one saved analytics watchlist (ClickHouse).
--
-- Source: analytics.ba_analytics_watchlist, the versioned MCP state table.
-- FINAL collapses SharedReplacingMergeTree(version) to the latest row per
-- (company_id, marketplace_id, lower(watchlist_name)).
--
-- Every state column is projected because bumping last_run_at re-inserts the
-- whole row: the table is append-only, so UPDATE is not available and any
-- unprojected column would be lost on the next write.
--
-- marketplace_id holds the canonical Amazon marketplace id; `marketplace` is
-- republished as the country code the tool contract has always returned.
SELECT
  w.company_id AS company_id,
  ifNull(nullIf(mk.country_code, ''), w.marketplace_id) AS marketplace,
  w.marketplace_id AS marketplace_id,
  w.watchlist_name AS watchlist_name,
  w.grain AS grain,
  w.entity_ids AS entity_ids,
  w.cadence AS cadence,
  w.focus AS focus,
  w.owner AS owner,
  w.last_run_at AS last_run_at,
  w.is_active AS is_active,
  w.created_at AS created_at,
  w.updated_at AS updated_at,
  w.created_by AS created_by,
  w.updated_by AS updated_by,
  w.notes AS notes
FROM analytics.ba_analytics_watchlist AS w FINAL
LEFT JOIN etl.ba_marketplaces AS mk
  ON mk.marketplace_id = w.marketplace_id
WHERE w.company_id = {{company_id}}
  AND w.marketplace_id = {{marketplace_id_literal}}
  AND lower(w.watchlist_name) = {{watchlist_name_literal_lower}}
  AND w.is_active = 1
LIMIT 1
