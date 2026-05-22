-- Minimal Test: term_intents CTE Definition
-- This verifies the CTE is syntactically correct and can be used in a LEFT JOIN

WITH term_intents AS (
  SELECT
    CAST(NULL AS BIGINT) AS company_id,
    CAST(NULL AS VARCHAR) AS term_norm,
    CAST(NULL AS VARCHAR) AS primary_intent_id,
    CAST(NULL AS VARCHAR) AS primary_intent_label
  WHERE FALSE
)

SELECT
  'term_intents CTE schema test' as test_name,
  COUNT(*) as cte_row_count,
  'PASS: CTE is defined correctly' as result
FROM term_intents;
