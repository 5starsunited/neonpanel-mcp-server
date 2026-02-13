-- Tool: financials_get_journal_entry_details
-- Purpose: Given a list of JE doc_numbers, returns every line item with
--          full account information and attachment details.
--          This is the "drill into a specific JE" tool.
-- Join chain:
--   journal_entries       JE
--     → app_companies      C   ON C.id  = JE.company_id
--     ← journal_entry_details  JED ON JED.journal_entry_id = JE.id
--       → accounts          A   ON A.id  = JED.account_id
--     ← journal_entry_attachments  JEA (aggregated per JE for attachment list)

WITH params AS (
  SELECT
    {{company_ids_array}}             AS company_ids,
    {{doc_numbers_array}}             AS doc_numbers
),

-- ─── Attachment summary per JE ──────────────────────────────────────────────
attachment_info AS (
  SELECT
    jea.journal_entry_id,
    COUNT(*)                                                           AS attachment_count,
    ARRAY_AGG(jea.original_filename)                                   AS attachment_filenames
  FROM "{{catalog}}"."neonpanel_iceberg"."journal_entry_attachments" jea
  GROUP BY jea.journal_entry_id
)

-- ─── Main query: every JED line for requested JEs ───────────────────────────
SELECT
  je.doc_number,
  je.transaction_date,
  je.name                             AS je_name,
  je.message                          AS je_message,
  je.source_doc_type,
  je.target_doc_type,
  ROUND(je.amount, 2)                 AS je_amount,
  je.currency                         AS je_currency,
  ROUND(je.main_amount, 2)            AS je_main_amount,
  je.main_currency,

  -- Line detail
  jed.line_number,
  a.number                            AS account_number,
  a.name                              AS account_name,
  a.full_name                         AS account_full_name,
  a.type                              AS account_type,
  a.classification,
  a.statement,
  a.report_chart,
  ROUND(jed.debit, 2)                 AS debit,
  ROUND(jed.credit, 2)                AS credit,
  ROUND(jed.debit - jed.credit, 2)    AS net,
  jed.description                     AS line_description,
  jed.name                            AS line_name,

  -- Attachments (at JE level)
  COALESCE(ai.attachment_count, 0)    AS attachment_count,
  ai.attachment_filenames,

  c.name                              AS company_name,
  je.company_id

FROM "{{catalog}}"."neonpanel_iceberg"."journal_entries" je

INNER JOIN "{{catalog}}"."neonpanel_iceberg"."journal_entry_details" jed
  ON jed.journal_entry_id = je.id

INNER JOIN "{{catalog}}"."neonpanel_iceberg"."accounts" a
  ON a.id = jed.account_id

INNER JOIN "{{catalog}}"."neonpanel_iceberg"."app_companies" c
  ON c.id = je.company_id

LEFT JOIN attachment_info ai
  ON ai.journal_entry_id = je.id

CROSS JOIN params p

WHERE
  -- Authorization
  contains(p.company_ids, je.company_id)
  AND a.company_id = je.company_id

  -- Doc number filter (required – this tool expects specific JEs)
  AND any_match(p.doc_numbers, d -> d = je.doc_number)

ORDER BY je.doc_number, jed.line_number
LIMIT 1000
