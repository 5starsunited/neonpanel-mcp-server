-- Delete existing row for the same logical slot before INSERT (upsert semantics).
-- Slot key: (marketplace, LOWER(keyword), period_start).
DELETE FROM "{{catalog}}"."brand_analytics_iceberg"."sqp_query_details_uploads"
WHERE company_id = {{company_id}}
  AND marketplace = {{marketplace_literal}}
  AND LOWER(keyword) = {{keyword_literal_lower}}
  AND period_start = DATE {{period_start_literal}}
