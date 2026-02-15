-- Tool: financials_list_amazon_settlements
-- Purpose: List Amazon settlement reports – one row per settlement (title/summary row).
-- Source table:
--   sp_api_iceberg.v2_settlement_report_data_flat_file_v2
-- Join chain:
--   settlement S → app_companies C  (company name)

WITH params AS (
  SELECT
    {{limit_top_n}}                                                        AS limit_top_n,
    {{start_date_sql}}                                                     AS start_date,
    {{end_date_sql}}                                                       AS end_date,
    {{company_ids_array}}                                                  AS company_ids,
    transform({{company_ids_array}}, x -> CAST(x AS VARCHAR))             AS company_ids_str,
    {{settlement_ids_array}}                                               AS settlement_ids,
    {{marketplace_names_array}}                                            AS marketplace_names,
    {{currencies_array}}                                                   AS currencies,
    {{seller_ids_array}}                                                   AS seller_ids,
    {{min_amount_sql}}                                                     AS min_amount,
    {{max_amount_sql}}                                                     AS max_amount
)

SELECT
  ROW_NUMBER() OVER (ORDER BY s.deposit_date {{sort_direction}} NULLS LAST, s.settlement_id DESC) AS row_num,
  c.name                                                                   AS company_name,
  CAST(s.ingest_company_id AS BIGINT)                                      AS company_id,
  s.settlement_id,
  s.settlement_start_date,
  s.settlement_end_date,
  s.deposit_date,
  s.total_amount,
  s.currency,
  s.ingest_seller_id                                                       AS seller_id

FROM "{{catalog}}"."sp_api_iceberg"."v2_settlement_report_data_flat_file_v2" s

INNER JOIN "{{catalog}}"."neonpanel_iceberg"."app_companies" c
  ON CAST(c.id AS VARCHAR) = s.ingest_company_id

CROSS JOIN params p

WHERE
  -- Title/summary rows only: transaction_type is empty/null AND total_amount is filled
  (s.transaction_type IS NULL OR TRIM(s.transaction_type) = '')
  AND s.total_amount IS NOT NULL

  -- Authorization
  AND contains(p.company_ids_str, s.ingest_company_id)

  -- Optional: settlement_id filter
  AND (
    cardinality(p.settlement_ids) = 0
    OR contains(p.settlement_ids, s.settlement_id)
  )

  -- Optional: marketplace filter (via a subquery on detail rows for that settlement)
  AND (
    cardinality(p.marketplace_names) = 0
    OR EXISTS (
      SELECT 1
      FROM "{{catalog}}"."sp_api_iceberg"."v2_settlement_report_data_flat_file_v2" d
      WHERE d.settlement_id = s.settlement_id
        AND d.ingest_company_id = s.ingest_company_id
        AND d.partition_year  = s.partition_year
        AND d.partition_month = s.partition_month
        AND d.transaction_type IS NOT NULL
        AND TRIM(d.transaction_type) <> ''
        AND any_match(p.marketplace_names, mn -> lower(mn) = lower(d.marketplace_name))
    )
  )

  -- Optional: currency filter
  AND (
    cardinality(p.currencies) = 0
    OR any_match(p.currencies, cur -> lower(cur) = lower(s.currency))
  )

  -- Optional: seller_id filter
  AND (
    cardinality(p.seller_ids) = 0
    OR any_match(p.seller_ids, sid -> sid = s.ingest_seller_id)
  )

  -- Optional: total_amount range filter
  AND (p.min_amount IS NULL OR s.total_amount >= p.min_amount)
  AND (p.max_amount IS NULL OR s.total_amount <= p.max_amount)

  -- Partition pruning (partition_year + partition_month)
  AND s.partition_year >= {{partition_year_start}}
  AND s.partition_year <= {{partition_year_end}}
  AND (s.partition_year > {{partition_year_start}} OR s.partition_month >= {{partition_month_start}})
  AND (s.partition_year < {{partition_year_end}}   OR s.partition_month <= {{partition_month_end}})

  -- Date filter on deposit_date (precise, after partition pruning)
  AND (p.start_date IS NULL OR TRY_CAST(s.deposit_date AS DATE) >= p.start_date)
  AND (p.end_date   IS NULL OR TRY_CAST(s.deposit_date AS DATE) <= p.end_date)

ORDER BY s.deposit_date {{sort_direction}} NULLS LAST, s.settlement_id DESC
LIMIT {{limit_top_n}}
