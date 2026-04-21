-- Delete existing rows for specific slots (used before INSERT for upsert semantics).
-- Slots are matched on the logical key: (marketplace, competitor_asin, against_my_asin, against_my_product_family).
DELETE FROM "{{catalog}}"."brand_analytics_iceberg"."competitor_asins"
WHERE company_id = {{company_id}}
  AND (marketplace, competitor_asin, COALESCE(against_my_asin, ''), COALESCE(against_my_product_family, '')) IN (
    {{slots_in_clause}}
  )
