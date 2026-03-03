-- Tool: financials_save_amazon_statement_reconciliation_result
-- Purpose: dry-run validation / preview of reconciliation writes.
-- Validates summary + detail rows and returns per-row status.

WITH params AS (
  SELECT
    CAST({{company_id}} AS VARCHAR)  AS company_id,
    CAST({{year}}       AS INTEGER)  AS year,
    {{user_id_sql}}                  AS user_id,
    {{reason_sql}}                   AS reason,
    current_timestamp                AS created_at
),

-- ── Summary row ──────────────────────────────────────────────────────
summary_input AS (
  SELECT
    p.company_id,
    p.year,
    p.user_id,
    {{legal_name_sql}}        AS legal_name,
    {{total_income_sql}}      AS total_income,
    {{total_expenses_sql}}    AS total_expenses,
    {{total_tax_sql}}         AS total_tax,
    {{total_transfers_sql}}   AS total_transfers,
    {{summary_status_sql}}    AS status,
    p.reason                  AS memo,
    p.created_at              AS created_at,
    p.created_at              AS updated_at
  FROM params p
),

summary_validated AS (
  SELECT
    *,
    'summary'                                             AS row_type,
    (total_income    IS NOT NULL)                          AS ok_total_income,
    (total_expenses  IS NOT NULL)                          AS ok_total_expenses,
    (total_tax       IS NOT NULL)                          AS ok_total_tax,
    (total_transfers IS NOT NULL)                          AS ok_total_transfers,
    (status          IS NOT NULL)                          AS ok_status
  FROM summary_input
),

-- ── Detail rows ──────────────────────────────────────────────────────
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
),

details_validated AS (
  SELECT
    p.company_id,
    p.year,
    p.user_id,
    d.category,
    d.item_description,
    d.debit_amount,
    d.credit_amount,
    d.status,
    COALESCE(d.memo, p.reason)  AS memo,
    p.created_at                AS created_at,
    p.created_at                AS updated_at,
    'detail'                    AS row_type,
    (d.category         IS NOT NULL AND TRIM(d.category)         <> '') AS ok_category,
    (d.item_description IS NOT NULL AND TRIM(d.item_description) <> '') AS ok_item_description,
    (d.debit_amount     IS NOT NULL)                                     AS ok_debit,
    (d.credit_amount    IS NOT NULL)                                     AS ok_credit,
    (d.status           IS NOT NULL)                                     AS ok_status
  FROM details_input d
  CROSS JOIN params p
)

-- ── Combined preview ─────────────────────────────────────────────────
SELECT
  'summary' AS row_type,
  CAST(NULL AS VARCHAR) AS category,
  CAST(NULL AS VARCHAR) AS item_description,
  CAST(NULL AS DECIMAL(18,2)) AS debit_amount,
  CAST(NULL AS DECIMAL(18,2)) AS credit_amount,
  legal_name,
  total_income,
  total_expenses,
  total_tax,
  total_transfers,
  status,
  ok_total_income  AND ok_total_expenses AND ok_total_tax AND ok_total_transfers AND ok_status AS ok
FROM summary_validated

UNION ALL

SELECT
  'detail' AS row_type,
  category,
  item_description,
  debit_amount,
  credit_amount,
  CAST(NULL AS VARCHAR) AS legal_name,
  CAST(NULL AS DECIMAL(18,2)) AS total_income,
  CAST(NULL AS DECIMAL(18,2)) AS total_expenses,
  CAST(NULL AS DECIMAL(18,2)) AS total_tax,
  CAST(NULL AS DECIMAL(18,2)) AS total_transfers,
  status,
  ok_category AND ok_item_description AND ok_debit AND ok_credit AND ok_status AS ok
FROM details_validated
ORDER BY row_type DESC -- summary first, then details
