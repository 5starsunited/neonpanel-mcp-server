-- Tool: financials_list_account_transactions
-- Purpose: Detailed account ledger – returns individual journal entry lines
--          for selected accounts, showing JE name, ref number, date,
--          debit, credit, description, and a running balance.
-- Join chain:
--   journal_entry_details  JED  (fact – individual line items)
--     → journal_entries     JE  ON JE.id = JED.journal_entry_id
--     → accounts            A   ON A.id  = JED.account_id
--     → app_companies       C   ON C.id  = JE.company_id
-- Note: debit/credit are in the company's main currency.

WITH params AS (
  SELECT
    {{limit_top_n}}                   AS limit_top_n,
    {{start_date_sql}}                AS start_date,
    {{end_date_sql}}                  AS end_date,

    -- Authorization
    {{company_ids_array}}             AS company_ids,

    -- Account filters (at least one recommended for targeted results)
    {{account_names_array}}           AS account_names,
    {{account_name_match_type_sql}}   AS account_name_match_type,
    {{account_numbers_array}}         AS account_numbers,
    {{account_types_array}}           AS account_types,
    {{classifications_array}}         AS classifications,
    {{statements_array}}              AS statements,
    {{report_charts_array}}           AS report_charts,

    -- JE filters
    {{je_names_array}}                AS je_names,
    {{doc_numbers_array}}             AS doc_numbers,
    {{document_types_array}}          AS document_types,
    {{descriptions_array}}            AS descriptions,

    -- Boolean flag filters
    {{sde_filter}}                    AS sde_filter,
    {{ebitda_filter}}                 AS ebitda_filter,
    {{pnl_filter}}                    AS pnl_filter,
    {{active_filter}}                 AS active_filter
),

-- ─── Individual transaction lines ───────────────────────────────────────────
transactions AS (
  SELECT
    je.transaction_date,
    je.doc_number,
    je.name                                 AS je_name,
    je.source_doc_type,
    je.target_doc_type,

    a.number                                AS account_number,
    a.name                                  AS account_name,
    a.full_name                             AS account_full_name,
    a.type                                  AS account_type,
    a.classification,
    a.statement,
    a.report_chart,

    jed.debit,
    jed.credit,
    jed.debit - jed.credit                  AS net,
    jed.description                         AS line_description,

    c.name                                  AS company_name,
    c.currency                              AS main_currency,
    je.company_id

  FROM "{{catalog}}"."neonpanel_iceberg"."journal_entry_details" jed

  INNER JOIN "{{catalog}}"."neonpanel_iceberg"."journal_entries" je
    ON je.id = jed.journal_entry_id

  INNER JOIN "{{catalog}}"."neonpanel_iceberg"."accounts" a
    ON a.id = jed.account_id

  INNER JOIN "{{catalog}}"."neonpanel_iceberg"."app_companies" c
    ON c.id = je.company_id

  CROSS JOIN params p

  WHERE
    -- Authorization
    contains(p.company_ids, je.company_id)
    AND a.company_id = je.company_id

    -- Date range
    AND je.transaction_date >= p.start_date
    AND je.transaction_date <= p.end_date

    -- Account filters
    AND (
      cardinality(p.account_numbers) = 0
      OR any_match(p.account_numbers, an -> an = a.number)
    )
    AND (
      cardinality(p.account_names) = 0
      OR (
        CASE p.account_name_match_type
          WHEN 'exact' THEN
            any_match(p.account_names, n -> lower(n) = lower(a.name))
          WHEN 'starts_with' THEN
            any_match(p.account_names, n -> lower(a.name) LIKE lower(n) || '%')
          ELSE
            any_match(p.account_names, n -> lower(a.name) LIKE '%' || lower(n) || '%')
        END
      )
    )
    AND (
      cardinality(p.account_types) = 0
      OR any_match(p.account_types, at -> lower(at) = lower(a.type))
    )
    AND (
      cardinality(p.classifications) = 0
      OR any_match(p.classifications, cl -> lower(cl) = lower(a.classification))
    )
    AND (
      cardinality(p.statements) = 0
      OR any_match(p.statements, s -> lower(s) = lower(a.statement))
    )
    AND (
      cardinality(p.report_charts) = 0
      OR any_match(p.report_charts, rc -> lower(rc) = lower(a.report_chart))
    )

    -- JE-level filters
    AND (
      cardinality(p.je_names) = 0
      OR any_match(p.je_names, n -> lower(n) = lower(je.name))
    )
    AND (
      cardinality(p.doc_numbers) = 0
      OR any_match(p.doc_numbers, d -> d = je.doc_number)
    )
    AND (
      cardinality(p.document_types) = 0
      OR any_match(p.document_types, dt -> lower(dt) = lower(je.source_doc_type))
    )
    AND (
      cardinality(p.descriptions) = 0
      OR any_match(p.descriptions, d -> lower(jed.description) LIKE '%' || lower(d) || '%')
    )

    -- Boolean flag filters
    AND (p.sde_filter    IS NULL OR a.sde    = p.sde_filter)
    AND (p.ebitda_filter  IS NULL OR a.ebitda = p.ebitda_filter)
    AND (p.pnl_filter     IS NULL OR a.pnl   = p.pnl_filter)
    AND (p.active_filter  IS NULL OR a.active = p.active_filter)
)

-- ─── Output with running balance per account ────────────────────────────────
SELECT
  ROW_NUMBER() OVER (ORDER BY t.transaction_date {{sort_direction}}, t.doc_number) AS row_num,
  t.transaction_date,
  t.doc_number,
  t.je_name,
  t.source_doc_type,
  t.account_number,
  t.account_name,
  t.account_full_name,
  t.account_type,
  t.classification,
  t.statement,
  ROUND(t.debit, 2)   AS debit,
  ROUND(t.credit, 2)  AS credit,
  ROUND(t.net, 2)     AS net,
  ROUND(SUM(t.net) OVER (
    PARTITION BY t.account_number
    ORDER BY t.transaction_date, t.doc_number
    ROWS UNBOUNDED PRECEDING
  ), 2)                AS running_balance,
  t.line_description,
  t.company_name,
  t.main_currency
FROM transactions t
ORDER BY t.transaction_date {{sort_direction}}, t.doc_number
LIMIT {{limit_top_n}}
