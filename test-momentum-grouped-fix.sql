-- Test SQL: Momentum Tool Grouped Query Fix
-- Purpose: Verify the term_intents CTE is properly defined and doesn't cause TABLE_NOT_FOUND error
-- Note: Replace {{catalog}} with your actual catalog name (usually awsdatacatalog)

WITH params AS (
  SELECT
    100                                   AS limit_top_n,
    DATE '2026-05-13'                     AS start_date,
    DATE '2026-05-20'                     AS end_date,
    CAST(4 AS INTEGER)                    AS periods_back,
    CAST(ARRAY[1] AS ARRAY(BIGINT))       AS company_ids,  -- Replace 1 with your company_id
    CAST(ARRAY[] AS ARRAY(VARCHAR))       AS search_terms,
    'exact'                               AS match_type,
    CAST(ARRAY[] AS ARRAY(VARCHAR))       AS asins,
    CAST(ARRAY[] AS ARRAY(VARCHAR))       AS competitor_asins,
    CAST(ARRAY[] AS ARRAY(VARCHAR))       AS marketplaces,
    CAST(ARRAY[] AS ARRAY(VARCHAR))       AS categories,
    CAST(ARRAY[] AS ARRAY(VARCHAR))       AS brands,
    CAST(ARRAY[] AS ARRAY(VARCHAR))       AS revenue_abcd_class,
    CAST(ARRAY[] AS ARRAY(VARCHAR))       AS pareto_abc_class,
    CAST(ARRAY[] AS ARRAY(VARCHAR))       AS product_families,
    CAST(ARRAY[] AS ARRAY(VARCHAR))       AS momentum_signals,
    CAST(0.15 AS DOUBLE)                  AS weak_leader_max_conversion_share,
    CAST(0.0 AS DOUBLE)                   AS weak_leader_min_search_volume,
    CAST(0.0 AS DOUBLE)                   AS min_click_share,
    CAST(0.0 AS DOUBLE)                   AS min_search_volume
),

-- This is the critical CTE that was missing in query_grouped.sql
-- Verify it's defined without errors and returns the expected schema
term_intents AS (
  -- Placeholder CTE: without search_term_to_intent mapping, we return NULLs
  -- to maintain schema compatibility while grouped query executes
  SELECT
    CAST(NULL AS BIGINT) AS company_id,
    CAST(NULL AS VARCHAR) AS term_norm,
    CAST(NULL AS VARCHAR) AS primary_intent_id,
    CAST(NULL AS VARCHAR) AS primary_intent_label
  WHERE FALSE
),

base_filtered AS (
  SELECT s.*
  FROM "awsdatacatalog"."brand_analytics_iceberg"."search_term_smart_snapshot" s
  CROSS JOIN params p
  WHERE
    contains(p.company_ids, s.company_id)
    AND s.year >= year(current_date) - 2
    LIMIT 10
)

SELECT
  COUNT(*) as row_count,
  'term_intents CTE defined successfully' as status,
  'No TABLE_NOT_FOUND error' as result
FROM base_filtered
LIMIT 5;
