-- RYG (Red/Yellow/Green) signal thresholds for Brand Analytics tools.
--
-- This table stores the numeric thresholds used to classify KPI metrics into
-- signal colors (green/yellow/red) and signal codes with explanations.
--
-- Scope hierarchy:
--   company_id IS NULL  → system-wide defaults, applied when no company override exists
--   company_id = N      → company-specific overrides (take priority over defaults)
--
-- Each row defines ONE threshold boundary for one (signal_group, metric, color).
-- The SQL consumers JOIN this table and use the thresholds in CASE WHEN expressions.

CREATE TABLE brand_analytics_iceberg.ryg_thresholds (
  company_id          BIGINT,
  user_id             STRING,  
  tool                STRING,
  signal_group        STRING,
  metric              STRING,
  color               STRING,
  threshold_value     DOUBLE,
  signal_code         STRING,
  signal_description  STRING,
  updated_at          TIMESTAMP
)
LOCATION 's3://etl-glue-amazon-ads-prod-preprocessbucketreports6-1w0usrm0kq0j7/aws_etl/brand_analytics_iceberg/brand_analytics_iceberg/ryg_thresholds'
TBLPROPERTIES (
  'table_type' = 'iceberg',
  'format'     = 'PARQUET',
  'write_compression' = 'ZSTD',
  'compression_level' = '3'
);
