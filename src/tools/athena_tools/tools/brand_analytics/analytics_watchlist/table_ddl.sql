-- Iceberg table: per-company saved analytics watchlists.
-- Each row is a named bundle of entities + cadence + focus that `run_watchlist`
-- expands into parameters for `brand_analytics_growth_machine_diagnosis`.
--
-- Used by:
--   - brand_analytics_list_analytics_watchlist  (read)
--   - brand_analytics_write_analytics_watchlist (write/upsert/deactivate/reset)
--   - brand_analytics_run_watchlist             (reads config, invokes Component 1, updates last_run_at)
--
-- Upsert key: (company_id, marketplace, LOWER(watchlist_name)).

CREATE TABLE brand_analytics_iceberg.analytics_watchlist (
  company_id       BIGINT,
  marketplace      STRING,
  watchlist_name   STRING,
  grain            STRING,        -- 'child_asin' | 'parent_asin' | 'product_family' | 'brand'
  entity_ids       ARRAY<STRING>, -- list of ASINs / family names / brand names depending on grain
  cadence          STRING,        -- 'weekly' | 'monthly' | 'quarterly'
  focus            STRING,        -- 'growth_machine' | 'cart_leak' | 'cannibalization' | 'weak_leader' | 'defend' | 'generic'
  owner            STRING,
  last_run_at      TIMESTAMP,
  is_active        BOOLEAN,
  created_at       TIMESTAMP,
  updated_at       TIMESTAMP,
  created_by       STRING,
  updated_by       STRING,
  notes            STRING
)
LOCATION 's3://etl-glue-amazon-ads-prod-preprocessbucketreports6-1w0usrm0kq0j7/aws_etl/brand_analytics_iceberg/brand_analytics_iceberg/analytics_watchlist'
TBLPROPERTIES (
  'table_type' = 'iceberg',
  'format'     = 'PARQUET',
  'write_compression' = 'ZSTD',
  'compression_level' = '3'
);
