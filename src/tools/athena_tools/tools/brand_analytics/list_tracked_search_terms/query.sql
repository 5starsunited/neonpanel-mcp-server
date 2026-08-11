-- List tracked search terms for the given company scope (ClickHouse).
--
-- Source: analytics.ba_tracked_search_terms, the versioned MCP state table.
-- FINAL collapses SharedReplacingMergeTree(version) to the latest row per
-- (company_id, marketplace_id, keyword, asin, parent_asin, product_family),
-- which replaces the Athena ROW_NUMBER dedup. The base table is read instead of
-- etl.ba_tracked_search_terms_current so include_inactive can still surface
-- deactivated rows.
--
-- marketplace_id holds the canonical Amazon marketplace id; `marketplace` is
-- republished as the country code the tool contract has always returned.
WITH {{term_intents_cte_sql}}
SELECT
  r.company_id AS company_id,
  ifNull(nullIf(mk.country_code, ''), r.marketplace_id) AS marketplace,
  r.marketplace_id AS marketplace_id,
  r.asin AS asin,
  r.parent_asin AS parent_asin,
  r.product_family AS product_family,
  r.keyword AS keyword,
  r.priority AS priority,
  r.intent AS intent,
  r.added_by AS added_by,
  r.added_at AS added_at,
  r.is_active AS is_active,
  r.notes AS notes,
  ti.intent_ids AS intent_ids,
  ti.primary_intent_id AS primary_intent_id,
  ti.primary_intent_label AS primary_intent_label
FROM analytics.ba_tracked_search_terms AS r FINAL
LEFT JOIN term_intents AS ti
  ON ti.company_id = r.company_id
 AND ti.term_norm = lower(r.keyword)
LEFT JOIN etl.ba_marketplaces AS mk
  ON mk.marketplace_id = r.marketplace_id
WHERE {{company_filter_sql}}
  AND ({{marketplace_filter_sql}})
  AND ({{asin_filter_sql}})
  AND ({{parent_asin_filter_sql}})
  AND ({{product_family_filter_sql}})
  AND ({{keyword_filter_sql}})
  AND ({{intent_filter_sql}})
  AND ({{intent_terms_filter_sql}})
  AND ({{active_filter_sql}})
ORDER BY
  r.company_id,
  r.marketplace_id,
  -- priority 0 means "unset" (the column is UInt16, not nullable); sort it last
  -- to preserve the Athena `priority NULLS LAST` ordering.
  r.priority = 0,
  r.priority,
  r.keyword
LIMIT {{limit_top_n}}
