-- Iceberg table: audit trail of intent-clustering operations.
-- One row per clustering "run" (invocation of brand_analytics_cluster_search_terms).
-- Started as status='pending' by the cluster_search_terms tool; finalized by
-- brand_analytics_create_user_intent_cluster once the calling agent persists results.
--
-- LLM call itself is performed by the calling MCP agent (no server-side LLM call);
-- the agent reports its model + token usage back via create_user_intent_cluster.
--
-- output_mapping is JSON-serialized as STRING (json_parse() at read time).

CREATE TABLE brand_analytics_iceberg.intent_cluster_audit (
  id                         BIGINT,
  company_id                 BIGINT,
  operation_type             STRING,
  status                     STRING,
  input_search_terms_count   INT,
  output_intents_count       INT,
  output_mapping             STRING,
  llm_model                  STRING,
  llm_input_tokens           INT,
  llm_output_tokens          INT,
  created_at                 TIMESTAMP,
  created_by                 STRING
)
PARTITIONED BY (bucket(16, company_id))
LOCATION 's3://etl-glue-amazon-ads-prod-preprocessbucketreports6-1w0usrm0kq0j7/aws_etl/brand_analytics_iceberg/brand_analytics_iceberg/intent_cluster_audit'
TBLPROPERTIES (
  'table_type' = 'ICEBERG',
  'format' = 'parquet',
  'write_compression' = 'zstd'
);
