-- Test: Momentum Tool Grouped Query - term_intents LEFT JOIN
-- This verifies the LEFT JOIN works properly without TABLE_NOT_FOUND errors

WITH sample_expanded AS (
  SELECT
    1 AS company_id,
    'US' AS marketplace_country_code,
    'laptop' AS search_term,
    DATE '2026-05-20' AS week_start,
    'B001' AS asin,
    100 AS volume,
    0.15 AS my_click_share,
    'Product 1' AS rank_1_itemname
),

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

result AS (
  SELECT
    e.company_id,
    e.search_term,
    e.week_start,
    MAX(ti.primary_intent_id) AS primary_intent_id,
    MAX(ti.primary_intent_label) AS primary_intent_label
  FROM sample_expanded e
  LEFT JOIN term_intents ti
    ON ti.company_id = e.company_id
   AND ti.term_norm = lower(e.search_term)
  GROUP BY
    e.company_id,
    e.search_term,
    e.week_start
)

SELECT * FROM result;
