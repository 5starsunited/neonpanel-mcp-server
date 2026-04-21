-- Iceberg table: per-company registry of tracked search terms ("search-term cores").
-- Each row links a keyword to an optional scope: child ASIN, parent ASIN, or product family.
-- Null scope = company-wide keyword (applies across the whole catalog).
--
-- Used by:
--   - brand_analytics_list_tracked_search_terms  (read)
--   - brand_analytics_write_tracked_search_terms (write/upsert/deactivate/reset)
--   - brand_analytics_growth_machine_diagnosis   (auto-scope keyword filter when use_tracked_search_terms=true)
--
-- Upsert key: (company_id, marketplace, keyword, asin, parent_asin, product_family).

CREATE TABLE brand_analytics_iceberg.tracked_search_terms (
  company_id       BIGINT,
  marketplace      STRING,
  asin             STRING,
  parent_asin      STRING,
  product_family   STRING,
  keyword          STRING,
  priority         INT,
  -- intent values: defend | attack | evaluate | branded
  intent           STRING,
  added_by         STRING,
  added_at         TIMESTAMP,
  is_active        BOOLEAN,
  notes            STRING
)
WITH (
  table_type = 'ICEBERG',
  format = 'parquet',
  write_compression = 'zstd',
  partitioning = ARRAY['company_id'],
  location = 's3://etl-glue-amazon-ads-prod-preprocessbucketreports6-1w0usrm0kq0j7/aws_etl/brand_analytics_iceberg/brand_analytics_iceberg/tracked_search_terms'
);
