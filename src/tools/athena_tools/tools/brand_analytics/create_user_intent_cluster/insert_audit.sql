-- Re-insert the audit row with updated counters / status / llm fields.
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
  {{operation_type}},
  'completed',
  {{input_search_terms_count}},
  {{output_intents_count}},
  {{output_mapping}},
  {{llm_model}},
  {{llm_input_tokens}},
  {{llm_output_tokens}},
  {{created_at_expr}},
  {{created_by}}
)
