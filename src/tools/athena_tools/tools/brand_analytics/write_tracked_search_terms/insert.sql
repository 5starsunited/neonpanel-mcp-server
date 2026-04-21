INSERT INTO "{{catalog}}"."brand_analytics_iceberg"."tracked_search_terms" (
  company_id,
  marketplace,
  asin,
  parent_asin,
  product_family,
  keyword,
  priority,
  intent,
  added_by,
  added_at,
  is_active,
  notes
)
VALUES
  {{writes_values_sql}}
