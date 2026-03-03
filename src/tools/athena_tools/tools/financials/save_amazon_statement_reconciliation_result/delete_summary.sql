-- Tool: financials_save_amazon_statement_reconciliation_result
-- Purpose: DELETE existing reconciliation rows for company_id + year (before replace-mode insert).

DELETE FROM "{{fa_catalog}}"."{{fa_database}}"."{{fa_table_summaries}}"
WHERE company_id = CAST({{company_id}} AS VARCHAR)
  AND year       = CAST({{year}} AS INTEGER);
