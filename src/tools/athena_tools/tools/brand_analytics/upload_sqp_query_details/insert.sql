INSERT INTO "{{catalog}}"."brand_analytics_iceberg"."sqp_query_details_uploads" (
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
  source_screenshot_s3_uri,
  raw_extracted_json
)
VALUES (
  {{company_id}},
  {{marketplace_literal}},
  {{keyword_literal}},
  DATE {{period_start_literal}},
  DATE {{period_end_literal}},
  {{total_impressions_sql}},
  {{total_clicks_sql}},
  {{total_click_rate_sql}},
  {{competitors_array_sql}},
  {{uploaded_by_literal}},
  current_timestamp,
  {{source_screenshot_sql}},
  {{raw_extracted_json_literal}}
)
