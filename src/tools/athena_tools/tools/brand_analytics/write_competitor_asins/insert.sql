-- Insert new competitor entries. Upsert semantics achieved by deleting matching slots first via delete_slots.sql.
INSERT INTO "{{catalog}}"."brand_analytics_iceberg"."competitor_asins" (
  company_id,
  marketplace,
  competitor_asin,
  competitor_brand,
  competitor_label,
  against_my_asin,
  against_my_product_family,
  priority,
  added_by,
  added_at,
  is_active
)
VALUES
  {{writes_values_sql}}
