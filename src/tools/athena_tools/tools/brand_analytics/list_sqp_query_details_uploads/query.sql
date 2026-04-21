SELECT
  company_id,
  marketplace,
  keyword,
  period_start,
  period_end,
  total_impressions,
  total_clicks,
  total_click_rate,
  competitors,
  uploaded_by,
  uploaded_at,
  source_screenshot_s3_uri
FROM "{{catalog}}"."brand_analytics_iceberg"."sqp_query_details_uploads"
WHERE {{company_filter_sql}}
  AND {{marketplace_filter_sql}}
  AND {{keyword_filter_sql}}
  AND {{uploaded_by_filter_sql}}
  AND {{period_overlap_filter_sql}}
ORDER BY uploaded_at DESC
LIMIT {{limit_top_n}}
