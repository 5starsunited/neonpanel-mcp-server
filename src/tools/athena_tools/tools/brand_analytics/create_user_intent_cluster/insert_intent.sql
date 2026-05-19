-- Insert the new intent row.
INSERT INTO "{{catalog}}"."brand_analytics_iceberg"."user_intents" (
  id,
  company_id,
  intent_id,
  intent_name,
  customer_need,
  status,
  search_term_count,
  source,
  clustering_run_id,
  created_at,
  created_by
)
VALUES (
  {{id}},
  {{company_id}},
  {{intent_id}},
  {{intent_name}},
  {{customer_need}},
  'active',
  {{search_term_count}},
  {{source}},
  {{clustering_run_id}},
  current_timestamp,
  {{created_by}}
)
