-- Tool: financials_list_journal_entries
-- Purpose: Lists journal entry headers with summary stats (total debit/credit,
--          line count, attachment count). Does NOT expand individual lines —
--          use financials_get_journal_entry_details for that.
-- Join chain:
--   journal_entries       JE  (main entity)
--     → app_companies      C   ON C.id = JE.company_id
--     ← journal_entry_details  JED  (aggregated for line_count, total_debit/credit)
--     ← journal_entry_attachments  JEA  (aggregated for attachment_count)

WITH params AS (
  SELECT
    {{limit_top_n}}                   AS limit_top_n,
    {{start_date_sql}}                AS start_date,
    {{end_date_sql}}                  AS end_date,

    -- Authorization
    {{company_ids_array}}             AS company_ids,

    -- JE filters
    {{je_names_array}}                AS je_names,
    {{je_name_match_type_sql}}        AS je_name_match_type,
    {{doc_numbers_array}}             AS doc_numbers,
    {{source_doc_types_array}}        AS source_doc_types,
    {{target_doc_types_array}}        AS target_doc_types,

    -- Amount filters
    {{min_amount_sql}}                AS min_amount,
    {{max_amount_sql}}                AS max_amount
),

-- ─── Line-level aggregates ──────────────────────────────────────────────────
line_agg AS (
  SELECT
    jed.journal_entry_id,
    COUNT(*)                          AS line_count,
    COALESCE(SUM(jed.debit),  0)      AS total_debit,
    COALESCE(SUM(jed.credit), 0)      AS total_credit
  FROM "{{catalog}}"."neonpanel_iceberg"."journal_entry_details" jed
  GROUP BY jed.journal_entry_id
),

-- ─── Attachment counts ──────────────────────────────────────────────────────
attachment_agg AS (
  SELECT
    jea.journal_entry_id,
    COUNT(*) AS attachment_count
  FROM "{{catalog}}"."neonpanel_iceberg"."journal_entry_attachments" jea
  GROUP BY jea.journal_entry_id
)

-- ─── Main query ─────────────────────────────────────────────────────────────
SELECT
  ROW_NUMBER() OVER (ORDER BY je.transaction_date {{sort_direction}}, je.doc_number) AS row_num,
  je.transaction_date,
  je.doc_number,
  je.name                             AS je_name,
  je.message,
  je.source_doc_type,
  je.target_doc_type,
  ROUND(je.amount, 2)                 AS amount,
  je.currency,
  ROUND(je.main_amount, 2)            AS main_amount,
  je.main_currency,
  COALESCE(la.line_count, 0)          AS line_count,
  ROUND(COALESCE(la.total_debit, 0),  2)  AS total_debit,
  ROUND(COALESCE(la.total_credit, 0), 2)  AS total_credit,
  ROUND(COALESCE(la.total_debit, 0) - COALESCE(la.total_credit, 0), 2) AS total_net,
  COALESCE(aa.attachment_count, 0)    AS attachment_count,
  c.name                              AS company_name,
  je.company_id

FROM "{{catalog}}"."neonpanel_iceberg"."journal_entries" je

INNER JOIN "{{catalog}}"."neonpanel_iceberg"."app_companies" c
  ON c.id = je.company_id

LEFT JOIN line_agg la
  ON la.journal_entry_id = je.id

LEFT JOIN attachment_agg aa
  ON aa.journal_entry_id = je.id

CROSS JOIN params p

WHERE
  -- Authorization
  contains(p.company_ids, je.company_id)

  -- Date range
  AND je.transaction_date >= p.start_date
  AND je.transaction_date <= p.end_date

  -- JE name filter
  AND (
    cardinality(p.je_names) = 0
    OR (
      CASE p.je_name_match_type
        WHEN 'exact' THEN
          any_match(p.je_names, n -> lower(n) = lower(je.name))
        WHEN 'starts_with' THEN
          any_match(p.je_names, n -> lower(je.name) LIKE lower(n) || '%')
        ELSE
          any_match(p.je_names, n -> lower(je.name) LIKE '%' || lower(n) || '%')
      END
    )
  )

  -- Doc number filter
  AND (
    cardinality(p.doc_numbers) = 0
    OR any_match(p.doc_numbers, d -> d = je.doc_number)
  )

  -- Source doc type filter
  AND (
    cardinality(p.source_doc_types) = 0
    OR any_match(p.source_doc_types, dt -> lower(dt) = lower(je.source_doc_type))
  )

  -- Target doc type filter
  AND (
    cardinality(p.target_doc_types) = 0
    OR any_match(p.target_doc_types, dt -> lower(dt) = lower(je.target_doc_type))
  )

  -- Amount filters (on main_amount)
  AND (p.min_amount IS NULL OR je.main_amount >= p.min_amount)
  AND (p.max_amount IS NULL OR je.main_amount <= p.max_amount)

ORDER BY je.transaction_date {{sort_direction}}, je.doc_number
LIMIT {{limit_top_n}}
