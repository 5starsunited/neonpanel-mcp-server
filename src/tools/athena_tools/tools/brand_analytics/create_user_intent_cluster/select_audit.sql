-- Read the existing pending audit row so we can rewrite it as 'completed'.
-- Iceberg row-level UPDATE is unreliable across workgroups, so we do
-- DELETE + re-INSERT through the create_user_intent_cluster handler.
SELECT
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
FROM "{{catalog}}"."brand_analytics_iceberg"."intent_cluster_audit"
WHERE id = {{run_id}}
  AND company_id = {{company_id}}
