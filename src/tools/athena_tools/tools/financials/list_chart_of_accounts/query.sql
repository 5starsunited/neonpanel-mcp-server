-- Tool: financials_list_chart_of_accounts
-- Purpose: List the Chart of Accounts (COA) for a company – the master account
--          register with type, classification, hierarchy, and flags.
-- Join chain:
--   accounts        A   (fact – account master)
--     → account_types AT  ON AT.id  = A.account_type_id  (authoritative type & classification)
--     → accounts      AP1 ON AP1.id = A.parent_id        (parent account – hierarchy level 1)
--     → accounts      AP2 ON AP2.id = AP1.parent_id      (grandparent – hierarchy level 2)
--     → app_companies  C  ON C.id   = A.company_id
-- Note: account_type_details is intentionally excluded to avoid row
--       multiplication (one account_type can have many details).

WITH params AS (
  SELECT
    {{limit_top_n}}                   AS limit_top_n,
    {{company_ids_array}}             AS company_ids,

    -- Account filters
    {{account_numbers_array}}         AS account_numbers,
    {{account_names_array}}           AS account_names,
    {{account_name_match_type_sql}}   AS account_name_match_type,
    {{account_types_array}}           AS account_types,
    {{classifications_array}}         AS classifications,
    {{statements_array}}              AS statements,

    -- Boolean flag filters
    {{sde_filter}}                    AS sde_filter,
    {{ebitda_filter}}                 AS ebitda_filter,
    {{pnl_filter}}                    AS pnl_filter,
    {{active_filter}}                 AS active_filter
),

enriched AS (
  SELECT
    a.id                                    AS account_id,
    a.number                                AS account_number,
    a.name                                  AS account_name,
    a.full_name                             AS account_full_name,
    a.description                           AS account_description,

    -- Account type dimensions from account_types (authoritative source)
    at.name                                 AS account_type,
    at.classification,
    at.description                          AS account_type_description,

    -- Statement & reporting flags
    a.statement,
    a.report_chart,
    a.sde,
    a.ebitda,
    a.pnl,
    a.active,

    -- Parent hierarchy
    a.parent_id,
    ap1.name                                AS parent_account_name,
    ap2.name                                AS grandparent_account_name,

    -- Breadcrumb path: "Number Grandparent: Parent: Account"
    CONCAT(
      COALESCE(CAST(a.number AS VARCHAR), ''),
      IF(ap2.name IS NOT NULL, CONCAT(' ', ap2.name, ': '), ' '),
      IF(ap1.name IS NOT NULL, CONCAT(ap1.name, ': '), ''),
      a.name
    )                                       AS account_path,

    c.name                                  AS company_name,
    c.currency                              AS main_currency,
    a.company_id

  FROM "{{catalog}}"."neonpanel_iceberg"."accounts" a

  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."account_types" at
    ON at.id = a.account_type_id

  -- Self-joins for account hierarchy
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."accounts" ap1
    ON ap1.id = a.parent_id

  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."accounts" ap2
    ON ap2.id = ap1.parent_id

  INNER JOIN "{{catalog}}"."neonpanel_iceberg"."app_companies" c
    ON c.id = a.company_id

  CROSS JOIN params p

  WHERE
    -- Authorization
    contains(p.company_ids, a.company_id)

    -- Skip template accounts
    AND a.template = 0

    -- Account number filter (exact match)
    AND (
      cardinality(p.account_numbers) = 0
      OR any_match(p.account_numbers, an -> an = a.number)
    )

    -- Account name filter (configurable match type)
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

    -- Account type filter (from account_types.name)
    AND (
      cardinality(p.account_types) = 0
      OR any_match(p.account_types, t -> lower(t) = lower(at.name))
    )

    -- Classification filter
    AND (
      cardinality(p.classifications) = 0
      OR any_match(p.classifications, cl -> lower(cl) = lower(at.classification))
    )

    -- Statement filter (PL / BS)
    AND (
      cardinality(p.statements) = 0
      OR any_match(p.statements, s -> lower(s) = lower(a.statement))
    )

    -- Boolean flag filters
    AND (p.sde_filter    IS NULL OR a.sde    = p.sde_filter)
    AND (p.ebitda_filter IS NULL OR a.ebitda  = p.ebitda_filter)
    AND (p.pnl_filter    IS NULL OR a.pnl    = p.pnl_filter)
    AND (p.active_filter IS NULL OR a.active  = p.active_filter)
)

SELECT
  ROW_NUMBER() OVER (ORDER BY e.account_number ASC, e.account_name ASC) AS row_num,
  e.account_id,
  e.account_number,
  e.account_name,
  e.account_full_name,
  e.account_description,
  e.account_type,
  e.classification,
  e.account_type_description,
  e.statement,
  e.report_chart,
  e.sde,
  e.ebitda,
  e.pnl,
  e.active,
  e.parent_account_name,
  e.grandparent_account_name,
  e.account_path,
  e.company_name,
  e.main_currency
FROM enriched e
ORDER BY e.account_number ASC, e.account_name ASC
LIMIT {{limit_top_n}}
