-- Iceberg table: user-uploaded Search Query Details data from Seller Central UI.
-- Amazon does NOT expose total_impressions, total_clicks, per-ASIN impressions/clicks/price,
-- or the full top-10 competitor list via API — only the Seller Central UI.
-- Users open the seller_central_query_detail_url surfaced by other BA tools, screenshot it,
-- and the calling agent extracts the fields into JSON which is persisted here.
--
-- Used by:
--   - brand_analytics_upload_sqp_query_details  (write)
--   - brand_analytics_list_sqp_query_details_uploads (read/audit)
--   - brand_analytics_growth_machine_diagnosis (LEFT JOIN to populate screenshot_data_available flag)
--
-- Upsert key: (company_id, marketplace, LOWER(keyword), period_start).

CREATE TABLE brand_analytics_iceberg.sqp_query_details_uploads (
  company_id         BIGINT,
  marketplace        STRING,
  keyword            STRING,
  period_start       DATE,
  period_end         DATE,
  total_impressions  BIGINT,
  total_clicks       BIGINT,
  total_click_rate   DOUBLE,
  competitors        ARRAY<STRUCT<
                         asin: STRING,
                         brand: STRING,
                         impressions: BIGINT,
                         clicks: BIGINT,
                         click_rate: DOUBLE,
                         price_median: DOUBLE,
                         rank: INT
                       >>,
  uploaded_by        STRING,
  uploaded_at        TIMESTAMP,
  source_screenshot_s3_uri STRING,
  raw_extracted_json STRING
)
LOCATION 's3://etl-glue-amazon-ads-prod-preprocessbucketreports6-1w0usrm0kq0j7/aws_etl/brand_analytics_iceberg/brand_analytics_iceberg/sqp_query_details_uploads'
TBLPROPERTIES (
  'table_type' = 'ICEBERG',
  'format' = 'parquet',
  'write_compression' = 'zstd'
);
