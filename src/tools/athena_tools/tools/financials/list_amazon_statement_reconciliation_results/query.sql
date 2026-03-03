-- Tool: financials_list_amazon_statement_reconciliation_results
-- Purpose: List reconciliation summaries (and optionally their detail rows) from Iceberg tables.
-- Source tables:
--   financial_accounting.amazon_payments_summaries             (one row per reconciliation)
--   financial_accounting.amazon_payments_transaction_details   (per-category detail rows)
-- Partitioned by (company_id VARCHAR, year INT).

WITH params AS (
  SELECT
    CAST({{company_id}} AS VARCHAR)          AS company_id,
    CAST({{year}} AS INTEGER)                AS year,
    {{statuses_array}}                       AS statuses,
    {{start_date_sql}}                       AS start_date,
    {{end_date_sql}}                         AS end_date,
    CAST({{include_details}} AS BOOLEAN)     AS include_details,
    {{limit_top_n}}                          AS limit_top_n
),

-- ── Summaries ────────────────────────────────────────────────────────
summaries AS (
  SELECT
    ROW_NUMBER() OVER (ORDER BY s.created_at {{sort_direction}} NULLS LAST) AS row_num,
    'summary'              AS row_type,
    s.company_id,
    s.year,
    s.user_id,
    s.legal_name,
    s.total_income,
    s.total_expenses,
    s.total_tax,
    s.total_transfers,
    s.status,
    s.memo,
    s.created_at,
    s.updated_at,
    -- Detail-only columns (NULL for summary rows)
    CAST(NULL AS VARCHAR)        AS category,
    CAST(NULL AS VARCHAR)        AS item_description,
    CAST(NULL AS DECIMAL(18,2))  AS debit_amount,
    CAST(NULL AS DECIMAL(18,2))  AS credit_amount
  FROM "{{fa_catalog}}"."{{fa_database}}"."{{fa_table_summaries}}" s
  CROSS JOIN params p
  WHERE s.company_id = p.company_id
    AND s.year       = p.year
    -- Optional status filter
    AND (
      cardinality(p.statuses) = 0
      OR contains(p.statuses, s.status)
    )
    -- Optional date range filter on created_at
    AND (p.start_date IS NULL OR s.created_at >= CAST(p.start_date AS TIMESTAMP))
    AND (p.end_date   IS NULL OR s.created_at <= CAST(p.end_date   AS TIMESTAMP) + INTERVAL '1' DAY)
),

-- ── Details (only when include_details = true) ───────────────────────
details AS (
  SELECT
    0                            AS row_num,
    'detail'                     AS row_type,
    d.company_id,
    d.year,
    d.user_id,
    CAST(NULL AS VARCHAR)        AS legal_name,
    CAST(NULL AS DECIMAL(18,2))  AS total_income,
    CAST(NULL AS DECIMAL(18,2))  AS total_expenses,
    CAST(NULL AS DECIMAL(18,2))  AS total_tax,
    CAST(NULL AS DECIMAL(18,2))  AS total_transfers,
    d.status,
    d.memo,
    d.created_at,
    d.updated_at,
    d.category,
    d.item_description,
    d.debit_amount,
    d.credit_amount
  FROM "{{fa_catalog}}"."{{fa_database}}"."{{fa_table_details}}" d
  CROSS JOIN params p
  WHERE p.include_details = true
    AND d.company_id = p.company_id
    AND d.year       = p.year
    -- Optional date range
    AND (p.start_date IS NULL OR d.created_at >= CAST(p.start_date AS TIMESTAMP))
    AND (p.end_date   IS NULL OR d.created_at <= CAST(p.end_date   AS TIMESTAMP) + INTERVAL '1' DAY)
)

-- ── Combined output (summaries first, then details) ──────────────────
SELECT *
FROM (
  SELECT * FROM summaries
  UNION ALL
  SELECT * FROM details
)
ORDER BY row_type DESC, row_num ASC  -- 'summary' > 'detail' lexicographically
LIMIT {{limit_top_n}}