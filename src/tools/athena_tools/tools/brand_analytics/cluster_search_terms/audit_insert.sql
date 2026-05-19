-- Insert a pending audit row for a clustering run.
-- Finalized later by brand_analytics_create_user_intent_cluster.
INSERT INTO "{{catalog}}"."brand_analytics_iceberg"."intent_cluster_audit" (
  id,
  company_id,
  operation_type,
  status,
  input_search_terms_count,
  output_intents_count,
  output_mapping,
  llm_model,
  llm_input_tokens,
  llm_output_tokens,
  created_at,
  created_by
)
VALUES (
  {{run_id}},
  {{company_id}},
  'cluster_with_llm',
  'pending',
  {{input_count}},
  0,
  NULL,
  NULL,
  NULL,
  NULL,
  current_timestamp,
  {{created_by}}
)
