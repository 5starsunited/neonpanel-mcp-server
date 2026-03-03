-- Tool: financials_save_amazon_statement_reconciliation_result
-- Purpose: INSERT detail rows into amazon_payments_transaction_details (Iceberg).

INSERT INTO "{{fa_catalog}}"."{{fa_database}}"."{{fa_table_details}}" (
  company_id,
  year,
  user_id,
  category,
  item_description,
  debit_amount,
  credit_amount,
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
    {{reason_sql}}                   AS reason,
    current_timestamp                AS created_at,
    current_timestamp                AS updated_at
),

details_input AS (
  SELECT
    CAST(v.category         AS VARCHAR)        AS category,
    CAST(v.item_description AS VARCHAR)        AS item_description,
    CAST(v.debit_amount     AS DECIMAL(18,2))  AS debit_amount,
    CAST(v.credit_amount    AS DECIMAL(18,2))  AS credit_amount,
    CAST(v.status           AS VARCHAR)        AS status,
    CAST(v.memo             AS VARCHAR)        AS memo
  FROM (
    VALUES
      {{details_values_sql}}
  ) AS v(category, item_description, debit_amount, credit_amount, status, memo)
)

SELECT
  p.company_id,
  p.year,
  p.user_id,
  d.category,
  d.item_description,
  d.debit_amount,
  d.credit_amount,
  d.status,
  COALESCE(d.memo, p.reason) AS memo,
  p.created_at,
  p.updated_at
FROM details_input d
CROSS JOIN params p
WHERE d.category IS NOT NULL
  AND TRIM(d.category) <> ''
  AND d.item_description IS NOT NULL
  AND TRIM(d.item_description) <> ''
  AND d.debit_amount IS NOT NULL
  AND d.credit_amount IS NOT NULL
  AND d.status IS NOT NULL;
