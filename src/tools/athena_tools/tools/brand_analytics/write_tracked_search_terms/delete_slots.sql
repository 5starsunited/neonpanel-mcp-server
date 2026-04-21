-- Delete existing rows for specific slots before INSERT (upsert semantics).
-- Slot key: (marketplace, LOWER(keyword), asin, parent_asin, product_family).
DELETE FROM "{{catalog}}"."brand_analytics_iceberg"."tracked_search_terms"
WHERE company_id = {{company_id}}
  AND (marketplace, LOWER(keyword), COALESCE(asin, ''), COALESCE(parent_asin, ''), COALESCE(product_family, '')) IN (
    {{slots_in_clause}}
  )
