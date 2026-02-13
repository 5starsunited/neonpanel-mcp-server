-- Tool: financials_analyze_general_ledger
-- Purpose: Universal General Ledger analysis – aggregate journal entry details
--          by account, account type, classification, statement, and time period.
-- Join chain:
--   journal_entry_details  JED  (fact – line items with debit/credit in main currency)
--     → journal_entries     JE  ON JE.id = JED.journal_entry_id   (header: date, company)
--     → accounts            A   ON A.id  = JED.account_id         (chart of accounts)
--     → account_types       AT  ON AT.id = A.account_type_id      (type lookup)
--     → app_companies       C   ON C.id  = JE.company_id          (company name, currency)
-- Notes:
--   • debit / credit in JED are already in the company's main currency (app_companies.currency).
--   • net = debit − credit (positive = net debit, negative = net credit).

WITH params AS (
  SELECT
    {{limit_top_n}}                   AS limit_top_n,
    {{start_date_sql}}                AS start_date,
    {{end_date_sql}}                  AS end_date,
    CAST({{periods_back}} AS INTEGER) AS periods_back,

    -- Authorization
    {{company_ids_array}}             AS company_ids,

    -- Optional account filters
    {{account_types_array}}           AS account_types,        -- e.g. ['Expense', 'Other Income']
    {{classifications_array}}         AS classifications,      -- e.g. ['Expense', 'Revenue', 'Asset']
    {{statements_array}}              AS statements,           -- e.g. ['PL', 'BS']
    {{account_names_array}}           AS account_names,        -- substring match on account name
    {{account_numbers_array}}         AS account_numbers,      -- exact match on account number
    {{account_name_match_type_sql}}   AS account_name_match_type, -- 'exact', 'contains', 'starts_with'

    -- Optional journal entry filters
    {{document_types_array}}          AS document_types,       -- e.g. ['Invoice', 'Journal Entry']

    -- Flags
    {{sde_filter}}                    AS sde_filter,           -- NULL = no filter, 1 = SDE only, 0 = non-SDE
    {{ebitda_filter}}                 AS ebitda_filter,        -- NULL = no filter, 1 = EBITDA only, 0 = non-EBITDA
    {{pnl_filter}}                    AS pnl_filter,           -- NULL = no filter, 1 = P&L only, 0 = non-P&L
    {{active_filter}}                 AS active_filter,        -- NULL = no filter, 1 = active only, 0 = inactive

    -- Periodicity: 'day', 'month', 'quarter', 'year', 'total'
    {{periodicity_sql}}               AS periodicity,

    -- Group-by flags (1 = enabled, 0 = disabled)
    CAST({{group_by_account}} AS INTEGER)          AS group_by_account,
    CAST({{group_by_account_type}} AS INTEGER)     AS group_by_account_type,
    CAST({{group_by_classification}} AS INTEGER)   AS group_by_classification,
    CAST({{group_by_statement}} AS INTEGER)        AS group_by_statement,
    CAST({{group_by_report_chart}} AS INTEGER)     AS group_by_report_chart,
    CAST({{group_by_company}} AS INTEGER)          AS group_by_company
),

-- ─── Enriched fact rows ─────────────────────────────────────────────────────
enriched AS (
  SELECT
    je.transaction_date                     AS transaction_date,
    je.company_id                           AS company_id,
    c.name                                  AS company_name,
    c.currency                              AS main_currency,

    -- Account dimensions
    a.id                                    AS account_id,
    a.number                                AS account_number,
    a.name                                  AS account_name,
    a.full_name                             AS account_full_name,
    a.type                                  AS account_type,
    a.type_detail                           AS account_type_detail,
    a.classification                        AS classification,
    a.statement                             AS statement,
    a.report_chart                          AS report_chart,
    a.sde                                   AS sde,
    a.ebitda                                AS ebitda,
    a.pnl                                   AS pnl,
    a.active                                AS active,

    -- Measures (already in main currency)
    jed.debit                               AS debit,
    jed.credit                              AS credit,
    jed.debit - jed.credit                  AS net,

    -- Journal entry info
    je.doc_number                           AS doc_number,
    je.name                                 AS je_name,
    je.source_doc_type                      AS source_doc_type,
    je.target_doc_type                      AS target_doc_type

  FROM "{{catalog}}"."neonpanel_iceberg"."journal_entry_details" jed

  INNER JOIN "{{catalog}}"."neonpanel_iceberg"."journal_entries" je
    ON je.id = jed.journal_entry_id

  INNER JOIN "{{catalog}}"."neonpanel_iceberg"."accounts" a
    ON a.id = jed.account_id

  INNER JOIN "{{catalog}}"."neonpanel_iceberg"."app_companies" c
    ON c.id = je.company_id

  CROSS JOIN params p

  WHERE
    -- Authorization: company_id filter
    contains(p.company_ids, je.company_id)

    -- Also ensure the account belongs to the same company
    AND a.company_id = je.company_id

    -- Date filter
    AND je.transaction_date >= COALESCE(p.start_date,
                                        date_add('week', -1 * (p.periods_back + 2), CURRENT_DATE))
    AND je.transaction_date <= COALESCE(p.end_date, CURRENT_DATE)

    -- Account type filter (matches accounts.type, e.g. 'Expense', 'Other Income', 'Bank')
    AND (
      cardinality(p.account_types) = 0
      OR any_match(p.account_types, at -> lower(at) = lower(a.type))
    )

    -- Classification filter (e.g. 'Expense', 'Revenue', 'Asset', 'Liability', 'Equity')
    AND (
      cardinality(p.classifications) = 0
      OR any_match(p.classifications, cl -> lower(cl) = lower(a.classification))
    )

    -- Statement filter (e.g. 'PL', 'BS')
    AND (
      cardinality(p.statements) = 0
      OR any_match(p.statements, s -> lower(s) = lower(a.statement))
    )

    -- Account name filter (with match type logic)
    AND (
      cardinality(p.account_names) = 0
      OR (
        CASE p.account_name_match_type
          WHEN 'exact' THEN
            any_match(p.account_names, n -> lower(n) = lower(a.name))
          WHEN 'starts_with' THEN
            any_match(p.account_names, n -> lower(a.name) LIKE lower(n) || '%')
          ELSE -- 'contains'
            any_match(p.account_names, n -> lower(a.name) LIKE '%' || lower(n) || '%')
        END
      )
    )

    -- Account number filter (exact match)
    AND (
      cardinality(p.account_numbers) = 0
      OR any_match(p.account_numbers, an -> an = a.number)
    )

    -- Document type filter (on source_doc_type)
    AND (
      cardinality(p.document_types) = 0
      OR any_match(p.document_types, dt -> lower(dt) = lower(je.source_doc_type))
    )

    -- Boolean flag filters
    AND (p.sde_filter    IS NULL OR a.sde    = p.sde_filter)
    AND (p.ebitda_filter  IS NULL OR a.ebitda = p.ebitda_filter)
    AND (p.pnl_filter     IS NULL OR a.pnl   = p.pnl_filter)
    AND (p.active_filter  IS NULL OR a.active = p.active_filter)
),

-- ─── Determine date window ──────────────────────────────────────────────────
latest AS (
  SELECT max(transaction_date) AS latest_date FROM enriched
),

date_bounds AS (
  SELECT
    COALESCE(p.start_date, CAST(date_add('week', -1 * (p.periods_back - 1), CAST(l.latest_date AS DATE)) AS DATE)) AS start_date,
    COALESCE(p.end_date, CAST(l.latest_date AS DATE)) AS end_date
  FROM params p
  CROSS JOIN latest l
),

windowed AS (
  SELECT e.*
  FROM enriched e
  CROSS JOIN date_bounds d
  WHERE e.transaction_date BETWEEN d.start_date AND d.end_date
),

-- ─── Aggregate by dynamic group-by ──────────────────────────────────────────
aggregated AS (
  SELECT
    -- Periodicity key
    CASE p.periodicity
      WHEN 'day'     THEN CAST(w.transaction_date AS VARCHAR)
      WHEN 'month'   THEN DATE_FORMAT(w.transaction_date, '%Y-%m')
      WHEN 'quarter' THEN CAST(YEAR(w.transaction_date) AS VARCHAR) || '-Q' || CAST(QUARTER(w.transaction_date) AS VARCHAR)
      WHEN 'year'    THEN CAST(YEAR(w.transaction_date) AS VARCHAR)
      ELSE NULL
    END                                                                                   AS time_period,

    -- Conditional group-by keys
    CASE WHEN p.group_by_account = 1 THEN w.account_number ELSE NULL END                  AS account_number,
    CASE WHEN p.group_by_account = 1 THEN w.account_name ELSE NULL END                    AS account_name,
    CASE WHEN p.group_by_account = 1 THEN w.account_full_name ELSE NULL END               AS account_full_name,
    CASE WHEN p.group_by_account_type = 1 THEN w.account_type ELSE NULL END               AS account_type,
    CASE WHEN p.group_by_account_type = 1 THEN w.account_type_detail ELSE NULL END        AS account_type_detail,
    CASE WHEN p.group_by_classification = 1 THEN w.classification ELSE NULL END           AS classification,
    CASE WHEN p.group_by_statement = 1 THEN w.statement ELSE NULL END                     AS statement,
    CASE WHEN p.group_by_report_chart = 1 THEN w.report_chart ELSE NULL END               AS report_chart,
    CASE WHEN p.group_by_company = 1 THEN w.company_id ELSE NULL END                      AS company_id,
    CASE WHEN p.group_by_company = 1 THEN w.company_name ELSE NULL END                    AS company_name,
    CASE WHEN p.group_by_company = 1 THEN w.main_currency ELSE NULL END                   AS main_currency,

    -- Metrics
    SUM(w.debit)                              AS total_debit,
    SUM(w.credit)                             AS total_credit,
    SUM(w.net)                                AS net,
    COUNT(*)                                  AS line_count,
    COUNT(DISTINCT w.doc_number)              AS journal_entry_count,
    COUNT(DISTINCT w.account_id)              AS account_count

  FROM windowed w
  CROSS JOIN params p
  GROUP BY
    CASE p.periodicity
      WHEN 'day'     THEN CAST(w.transaction_date AS VARCHAR)
      WHEN 'month'   THEN DATE_FORMAT(w.transaction_date, '%Y-%m')
      WHEN 'quarter' THEN CAST(YEAR(w.transaction_date) AS VARCHAR) || '-Q' || CAST(QUARTER(w.transaction_date) AS VARCHAR)
      WHEN 'year'    THEN CAST(YEAR(w.transaction_date) AS VARCHAR)
      ELSE NULL
    END,
    CASE WHEN p.group_by_account = 1 THEN w.account_number ELSE NULL END,
    CASE WHEN p.group_by_account = 1 THEN w.account_name ELSE NULL END,
    CASE WHEN p.group_by_account = 1 THEN w.account_full_name ELSE NULL END,
    CASE WHEN p.group_by_account_type = 1 THEN w.account_type ELSE NULL END,
    CASE WHEN p.group_by_account_type = 1 THEN w.account_type_detail ELSE NULL END,
    CASE WHEN p.group_by_classification = 1 THEN w.classification ELSE NULL END,
    CASE WHEN p.group_by_statement = 1 THEN w.statement ELSE NULL END,
    CASE WHEN p.group_by_report_chart = 1 THEN w.report_chart ELSE NULL END,
    CASE WHEN p.group_by_company = 1 THEN w.company_id ELSE NULL END,
    CASE WHEN p.group_by_company = 1 THEN w.company_name ELSE NULL END,
    CASE WHEN p.group_by_company = 1 THEN w.main_currency ELSE NULL END
)

-- ─── Final ranked output ────────────────────────────────────────────────────
SELECT
  ROW_NUMBER() OVER (ORDER BY {{sort_column}} {{sort_direction}} NULLS LAST) AS rank,
  a.time_period,
  a.account_number,
  a.account_name,
  a.account_full_name,
  a.account_type,
  a.account_type_detail,
  a.classification,
  a.statement,
  a.report_chart,
  a.company_id,
  a.company_name,
  a.main_currency,
  ROUND(a.total_debit, 2)   AS total_debit,
  ROUND(a.total_credit, 2)  AS total_credit,
  ROUND(a.net, 2)           AS net,
  a.line_count,
  a.journal_entry_count,
  a.account_count
FROM aggregated a
ORDER BY {{sort_column}} {{sort_direction}} NULLS LAST
LIMIT {{limit_top_n}}
