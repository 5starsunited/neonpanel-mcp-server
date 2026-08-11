-- List persisted Seller Central "Search Query Details" uploads (ClickHouse).
--
-- Source: analytics.ba_sqp_query_details_uploads, the versioned MCP state table.
-- FINAL collapses SharedReplacingMergeTree(version) to the latest row per
-- (company_id, marketplace_id, lower(keyword), period_start).
--
-- Competitors are stored as a JSON string; the handler parses competitors_json
-- back into the array shape the tool contract publishes as `competitors`.
WITH {{term_intents_cte_sql}}
SELECT
  t.company_id AS company_id,
  ifNull(nullIf(mk.country_code, ''), t.marketplace_id) AS marketplace,
  t.marketplace_id AS marketplace_id,
  t.keyword AS keyword,
  t.period_start AS period_start,
  t.period_end AS period_end,
  t.total_impressions AS total_impressions,
  t.total_clicks AS total_clicks,
  t.total_click_rate AS total_click_rate,
  t.competitors_json AS competitors_json,
  t.uploaded_by AS uploaded_by,
  t.uploaded_at AS uploaded_at,
  t.source_screenshot_s3_uri AS source_screenshot_s3_uri,
  ti.intent_ids AS intent_ids,
  ti.primary_intent_id AS primary_intent_id,
  ti.primary_intent_label AS primary_intent_label
FROM analytics.ba_sqp_query_details_uploads AS t FINAL
LEFT JOIN term_intents AS ti
  ON ti.company_id = t.company_id
 AND ti.term_norm = lower(t.keyword)
LEFT JOIN etl.ba_marketplaces AS mk
  ON mk.marketplace_id = t.marketplace_id
WHERE {{company_filter_sql}}
  AND t.is_active = 1
  AND ({{marketplace_filter_sql}})
  AND ({{keyword_filter_sql}})
  AND ({{intent_terms_filter_sql}})
  AND ({{uploaded_by_filter_sql}})
  AND ({{period_overlap_filter_sql}})
ORDER BY t.uploaded_at DESC
LIMIT {{limit_top_n}}
