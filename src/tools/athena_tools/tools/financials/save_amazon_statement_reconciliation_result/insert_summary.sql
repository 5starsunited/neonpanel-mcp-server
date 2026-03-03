-- Tool: financials_save_amazon_statement_reconciliation_result
-- Purpose: INSERT one summary row into amazon_payments_summaries (Iceberg).

INSERT INTO "{{fa_catalog}}"."{{fa_database}}"."{{fa_table_summaries}}" (
  company_id,
  year,
  user_id,
  legal_name,
  total_income,
  total_expenses,
  total_tax,
  total_transfers,
  status,
  memo,
  created_at,
  updated_at
)

WITH params AS (
  SELECT
    CAST({{company_id}} AS VARCHAR)  AS company_id,
    CAST({{year}}       AS INTEGER)  AS year,
    {{user_id_sql}}                  AS user_id,
    {{legal_name_sql}}               AS legal_name,
    {{total_income_sql}}             AS total_income,
    {{total_expenses_sql}}           AS total_expenses,
    {{total_tax_sql}}                AS total_tax,
    {{total_transfers_sql}}          AS total_transfers,
    {{summary_status_sql}}           AS status,
    {{reason_sql}}                   AS memo,
    current_timestamp                AS created_at,
    current_timestamp                AS updated_at
)

SELECT
  company_id,
  year,
  user_id,
  legal_name,
  total_income,
  total_expenses,
  total_tax,
  total_transfers,
  status,
  memo,
  created_at,
  updated_at
FROM params
WHERE total_income IS NOT NULL
  AND total_expenses IS NOT NULL
  AND total_tax IS NOT NULL
  AND total_transfers IS NOT NULL
  AND status IS NOT NULL;
