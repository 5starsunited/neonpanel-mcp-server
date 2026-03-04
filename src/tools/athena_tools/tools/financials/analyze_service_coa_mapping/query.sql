-- Tool: financials_analyze_service_coa_mapping
-- Purpose: Analyze service items → Chart of Accounts mapping.
--          LEFT JOINs services to accounts via income_account_id
--          so both mapped and unmapped services appear.
-- Join chain:
--   services         S   (fact – service items)
--     → accounts      A   ON A.id  = S.income_account_id AND A.company_id = S.company_id
--     → account_types AT  ON AT.id = A.account_type_id   (authoritative type & classification)
--     → accounts      AP1 ON AP1.id = A.parent_id        (parent account – hierarchy level 1)
--     → accounts      AP2 ON AP2.id = AP1.parent_id      (grandparent – hierarchy level 2)
--     → app_companies  C  ON C.id  = S.company_id

WITH params AS (
  SELECT
    {{limit_top_n}}                   AS limit_top_n,
    {{company_ids_array}}             AS company_ids,

    -- Mapping status filter: 'mapped', 'unmapped', or NULL (both)
    {{mapping_status_sql}}            AS mapping_status,

    -- Optional text search on service name (substring, case-insensitive)
    {{service_name_search_sql}}       AS service_name_search,

    -- Optional account filters
    {{account_names_array}}           AS account_names,
    {{account_numbers_array}}         AS account_numbers,

    -- Active filter
    {{active_filter}}                 AS active_filter
),

enriched AS (
  SELECT
    s.id                                    AS service_id,
    s.name                                  AS service_name,
    s.description                           AS service_description,
    s.service_group_name,
    s.item_price,
    s.purchase_cost,
    s.purchase_description,
    s.active                                AS service_active,

    -- Mapping info
    s.income_account_id,
    CASE
      WHEN s.income_account_id IS NOT NULL AND a.id IS NOT NULL THEN 'mapped'
      ELSE 'unmapped'
    END                                     AS mapping_status,

    -- Account details (NULL when unmapped)
    a.number                                AS account_number,
    a.name                                  AS account_name,
    a.full_name                             AS account_full_name,

    -- Account type dimensions from account_types (authoritative source)
    at.name                                 AS account_type,
    at.classification                       AS account_classification,
    at.description                          AS account_type_description,
    a.statement                             AS account_statement,

    -- Parent hierarchy
    ap1.name                                AS parent_account_name,
    ap2.name                                AS grandparent_account_name,

    -- Breadcrumb path: "Number GrandParent: Parent: Account"
    CONCAT(
      COALESCE(CAST(a.number AS VARCHAR), ''),
      IF(ap2.name IS NOT NULL, CONCAT(' ', ap2.name, ': '), ' '),
      IF(ap1.name IS NOT NULL, CONCAT(ap1.name, ': '), ''),
      a.name
    )                                       AS account_path,

    c.name                                  AS company_name,
    c.currency                              AS main_currency,
    s.company_id

  FROM "{{catalog}}"."neonpanel_iceberg"."services" s

  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."accounts" a
    ON a.id = s.income_account_id
    AND a.company_id = s.company_id

  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."account_types" at
    ON at.id = a.account_type_id

  -- Self-joins for account hierarchy
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."accounts" ap1
    ON ap1.id = a.parent_id

  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."accounts" ap2
    ON ap2.id = ap1.parent_id

  INNER JOIN "{{catalog}}"."neonpanel_iceberg"."app_companies" c
    ON c.id = s.company_id

  CROSS JOIN params p

  WHERE
    -- Authorization
    contains(p.company_ids, s.company_id)

    -- Template = 0 means it's a real service, not a template
    AND s.template = 0

    -- Active filter
    AND (p.active_filter IS NULL OR s.active = p.active_filter)

    -- Mapping status filter
    AND (
      p.mapping_status IS NULL
      OR (p.mapping_status = 'mapped'   AND s.income_account_id IS NOT NULL AND a.id IS NOT NULL)
      OR (p.mapping_status = 'unmapped' AND (s.income_account_id IS NULL OR a.id IS NULL))
    )

    -- Service name search (substring, case-insensitive)
    AND (
      p.service_name_search IS NULL
      OR lower(s.name) LIKE '%' || lower(p.service_name_search) || '%'
    )

    -- Account name filter
    AND (
      cardinality(p.account_names) = 0
      OR any_match(p.account_names, n -> lower(a.name) LIKE '%' || lower(n) || '%')
    )

    -- Account number filter
    AND (
      cardinality(p.account_numbers) = 0
      OR any_match(p.account_numbers, an -> an = a.number)
    )
)

SELECT
  ROW_NUMBER() OVER (ORDER BY e.mapping_status DESC, e.service_name ASC) AS row_num,
  e.service_id,
  e.service_name,
  e.service_description,
  e.service_group_name,
  e.item_price,
  e.purchase_cost,
  e.mapping_status,
  e.income_account_id,
  e.account_number,
  e.account_name,
  e.account_full_name,
  e.account_type,
  e.account_classification,
  e.account_type_description,
  e.account_statement,
  e.parent_account_name,
  e.grandparent_account_name,
  e.account_path,
  e.service_active,
  e.company_name,
  e.main_currency
FROM enriched e
ORDER BY e.mapping_status DESC, e.service_name ASC
LIMIT {{limit_top_n}}
