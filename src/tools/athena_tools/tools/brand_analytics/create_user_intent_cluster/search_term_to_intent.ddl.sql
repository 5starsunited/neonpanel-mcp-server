-- Iceberg table: N:M mapping of raw search terms to intent clusters.
-- A single search term can map to multiple intents (with contribution_pct summing to <= 1.0).
--
-- Used by:
--   - brand_analytics_create_user_intent_cluster (write — inserts N rows per intent created)
--   - brand_analytics_list_user_intent_clusters  (read — aggregates count / avg confidence per intent)
--
-- Uniqueness (app-enforced): (company_id, search_term, intent_id).

CREATE TABLE brand_analytics_iceberg.search_term_to_intent (
  id                BIGINT,
  company_id        BIGINT,
  search_term       STRING,
  intent_id         STRING,
  confidence        DOUBLE,
  contribution_pct  DOUBLE,
  source            STRING,
  created_at        TIMESTAMP,
  created_by        STRING
)
PARTITIONED BY (bucket(16, company_id))
LOCATION 's3://etl-glue-amazon-ads-prod-preprocessbucketreports6-1w0usrm0kq0j7/aws_etl/brand_analytics_iceberg/brand_analytics_iceberg/search_term_to_intent'
TBLPROPERTIES (
  'table_type' = 'ICEBERG',
  'format' = 'parquet',
  'write_compression' = 'zstd'
);
