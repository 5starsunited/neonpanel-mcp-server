CREATE TABLE brand_analytics_iceberg.campaign_asin_map (
  company_id string,
  marketplace_id string,
  campaign_id string,
  asin string,
  year bigint,
  month bigint,
  day bigint)
PARTITIONED BY (`year`, `month`, `day`)
LOCATION 's3://etl-glue-amazon-ads-prod-preprocessbucketreports6-1w0usrm0kq0j7/aws_etl/brand_analytics_iceberg/brand_analytics_iceberg/campaign_asin_map'
TBLPROPERTIES (
  'table_type'='iceberg',
  'compression_level'='3',
  'format'='PARQUET',
  'write_compression'='ZSTD'
);