WITH {{term_intents_cte_sql}}
SELECT
  t.company_id,
  t.marketplace,
  t.keyword,
  t.period_start,
  t.period_end,
  t.total_impressions,
  t.total_clicks,
  t.total_click_rate,
  t.competitors,
  t.uploaded_by,
  t.uploaded_at,
  t.source_screenshot_s3_uri,
  ti.intent_ids,
  ti.primary_intent_id,
  ti.primary_intent_label
FROM "{{catalog}}"."brand_analytics_iceberg"."sqp_query_details_uploads" t
LEFT JOIN term_intents ti
  ON ti.company_id = t.company_id
 AND ti.term_norm = lower(t.keyword)
WHERE {{company_filter_sql}}
  AND {{marketplace_filter_sql}}
  AND {{keyword_filter_sql}}
  AND ({{intent_terms_filter_sql}})
  AND {{uploaded_by_filter_sql}}
  AND {{period_overlap_filter_sql}}
ORDER BY t.uploaded_at DESC
LIMIT {{limit_top_n}}
