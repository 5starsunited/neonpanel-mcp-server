-- Insert N rows linking the new intent to its search terms.
INSERT INTO "{{catalog}}"."brand_analytics_iceberg"."search_term_to_intent" (
  id,
  company_id,
  search_term,
  intent_id,
  confidence,
  contribution_pct,
  source,
  created_at,
  created_by
)
VALUES
  {{mappings_values_sql}}
