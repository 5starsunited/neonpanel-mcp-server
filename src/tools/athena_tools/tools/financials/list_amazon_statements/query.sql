-- Tool: financials_list_amazon_statements
-- Purpose: List Amazon statements – one row per statement (header row from amazon_statements).
-- Source tables:
--   sp_api_iceberg.amazon_statements   (statement-level header: dates, deposit, totals)
--   neonpanel_iceberg.app_companies    (company name, shortname, main currency)
--   neonpanel_iceberg.amazon_sellers   (seller → marketplace mapping)
--   neonpanel_iceberg.amazon_marketplaces (marketplace name, code, country, currency)
-- Join chain:
--   amazon_statements S
--     → app_companies       C   ON CAST(C.id AS VARCHAR) = S.company_id
--     → amazon_sellers      AS2 ON AS2.amazon_seller_id = S.amazon_seller_id AND AS2.deleted_at IS NULL
--     → amazon_marketplaces M   ON M.id = AS2.marketplace_id

WITH params AS (
  SELECT
    {{limit_top_n}}                                                        AS limit_top_n,
    {{start_date_sql}}                                                     AS start_date,
    {{end_date_sql}}                                                       AS end_date,
    {{company_ids_array}}                                                  AS company_ids,
    transform({{company_ids_array}}, x -> CAST(x AS VARCHAR))             AS company_ids_str,
    {{statement_ids_array}}                                                AS statement_ids,
    {{marketplace_codes_array}}                                            AS marketplace_codes,
    {{currencies_array}}                                                   AS currencies,
    {{seller_ids_array}}                                                   AS seller_ids,
    {{min_amount_sql}}                                                     AS min_amount,
    {{max_amount_sql}}                                                     AS max_amount
)

SELECT
  ROW_NUMBER() OVER (ORDER BY s.deposit_date {{sort_direction}} NULLS LAST, s.settlement_id DESC) AS row_num,
  c.name                                                                   AS company_name,
  c.shortname                                                              AS company_short_name,
  CAST(s.company_id AS BIGINT)                                             AS company_id,
  c.currency                                                               AS main_currency,
  s.settlement_id                                                          AS statement_id,
  s.settlement_start_date                                                  AS statement_start_date,
  s.settlement_end_date                                                    AS statement_end_date,
  s.deposit_date,
  s.settlement_amount                                                      AS total_amount,
  COALESCE(s.currency, m.currency_iso)                                     AS currency,
  s.amazon_seller_id                                                       AS seller_id,
  m.name                                                                   AS marketplace_name,
  m.code                                                                   AS marketplace_code,
  m.country                                                                AS marketplace_country,
  m.currency_iso                                                           AS marketplace_currency

FROM "{{catalog}}"."sp_api_iceberg"."amazon_statements" s

INNER JOIN "{{catalog}}"."neonpanel_iceberg"."app_companies" c
  ON CAST(c.id AS VARCHAR) = s.company_id

LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."amazon_sellers" as2
  ON as2.amazon_seller_id = s.amazon_seller_id
  AND as2.deleted_at IS NULL

LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."amazon_marketplaces" m
  ON m.id = as2.marketplace_id

CROSS JOIN params p

WHERE
  -- Authorization
  contains(p.company_ids_str, s.company_id)

  -- Optional: statement_id filter
  AND (
    cardinality(p.statement_ids) = 0
    OR contains(p.statement_ids, s.settlement_id)
  )

  -- Optional: marketplace code filter
  AND (
    cardinality(p.marketplace_codes) = 0
    OR any_match(p.marketplace_codes, mc -> lower(mc) = lower(m.code))
  )

  -- Optional: currency filter
  AND (
    cardinality(p.currencies) = 0
    OR any_match(p.currencies, cur -> lower(cur) = lower(COALESCE(s.currency, m.currency_iso)))
  )

  -- Optional: seller_id filter
  AND (
    cardinality(p.seller_ids) = 0
    OR any_match(p.seller_ids, sid -> sid = s.amazon_seller_id)
  )

  -- Optional: total_amount range filter
  AND (p.min_amount IS NULL OR s.settlement_amount >= p.min_amount)
  AND (p.max_amount IS NULL OR s.settlement_amount <= p.max_amount)

  -- Partition pruning (settlement_year INT + settlement_month STRING)
  AND s.settlement_year >= {{partition_year_start}}
  AND s.settlement_year <= {{partition_year_end}}
  AND (s.settlement_year > {{partition_year_start}} OR s.settlement_month >= {{partition_month_start}})
  AND (s.settlement_year < {{partition_year_end}}   OR s.settlement_month <= {{partition_month_end}})

  -- Date filter on deposit_date (precise, after partition pruning)
  AND (p.start_date IS NULL OR CAST(s.deposit_date AS DATE) >= p.start_date)
  AND (p.end_date   IS NULL OR CAST(s.deposit_date AS DATE) <= p.end_date)

ORDER BY s.deposit_date {{sort_direction}} NULLS LAST, s.settlement_id DESC
LIMIT {{limit_top_n}}
