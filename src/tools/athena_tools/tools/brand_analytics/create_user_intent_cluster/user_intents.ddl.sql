-- Iceberg table: per-company intent definitions (semantic customer-intent clusters).
-- Each row represents a named intent (e.g. "Plantar Fasciitis Relief") that groups
-- raw Amazon search terms into a single customer need.
--
-- Used by:
--   - brand_analytics_create_user_intent_cluster (write — one row per intent)
--   - brand_analytics_list_user_intent_clusters  (read)
--   - brand_analytics_cluster_search_terms       (prep — produces proposals only)
--
-- Uniqueness (app-enforced): (company_id, intent_id).

CREATE TABLE brand_analytics_iceberg.user_intents (
  id                   BIGINT,
  company_id           BIGINT,
  intent_id            STRING,
  intent_name          STRING,
  customer_need        STRING,
  status               STRING,
  search_term_count    INT,
  source               STRING,
  clustering_run_id    BIGINT,
  created_at           TIMESTAMP,
  created_by           STRING
)
PARTITIONED BY (bucket(16, company_id))
LOCATION 's3://etl-glue-amazon-ads-prod-preprocessbucketreports6-1w0usrm0kq0j7/aws_etl/brand_analytics_iceberg/brand_analytics_iceberg/user_intent'
TBLPROPERTIES (
  'table_type' = 'ICEBERG',
  'format' = 'parquet',
  'write_compression' = 'zstd'
);
