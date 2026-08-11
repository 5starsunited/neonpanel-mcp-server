-- Read the pending audit row for a clustering run so it can be re-inserted as
-- 'completed'. analytics.ba_intent_cluster_audit is a
-- SharedReplacingMergeTree(version), so finalizing is an insert of a newer
-- version rather than an UPDATE.
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
FROM etl.ba_intent_cluster_audit_current
WHERE id = {{run_id}}
  AND company_id = {{company_id}}
