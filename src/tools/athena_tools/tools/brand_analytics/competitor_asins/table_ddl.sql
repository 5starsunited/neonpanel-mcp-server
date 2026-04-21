-- Iceberg table: per-company registry of competitor ASINs.
-- Used by:
--   - brand_analytics_list_competitor_asins  (read)
--   - brand_analytics_write_competitor_asins (write/upsert/delete)
--   - brand_analytics_growth_machine_diagnosis (flags: is_competitor, competitor_won_keyword)
--   - brand_analytics_get_competitive_landscape (optional auto-scope)
--
-- Scope: one row per (company_id, marketplace, competitor_asin, against_my_asin, against_my_product_family).
-- is_active = false is the "soft delete" convention.

CREATE TABLE brand_analytics_iceberg.competitor_asins (
  company_id                 BIGINT,
  marketplace                STRING,
  competitor_asin            STRING,
  competitor_brand           STRING,
  competitor_label           STRING,
  against_my_asin            STRING,
  against_my_product_family  STRING,
  priority                   INT,
  added_by                   STRING,
  added_at                   TIMESTAMP,
  is_active                  BOOLEAN
)
PARTITIONED BY (company_id)
LOCATION 's3://etl-glue-amazon-ads-prod-preprocessbucketreports6-1w0usrm0kq0j7/aws_etl/brand_analytics_iceberg/brand_analytics_iceberg/competitor_asins'
TBLPROPERTIES (
  'table_type' = 'ICEBERG',
  'format' = 'parquet',
  'write_compression' = 'zstd'
);
