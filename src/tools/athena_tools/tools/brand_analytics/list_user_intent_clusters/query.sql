-- List intents for a company with rolled-up search-term metrics (ClickHouse).
--
-- etl.ba_user_intents_current / etl.ba_search_term_to_intent_current already
-- apply FINAL + is_active = 1, so the latest row per (company_id, intent_id)
-- is served directly and the ROW_NUMBER dedup is no longer needed.
WITH mapping_stats AS (
  SELECT
    intent_id AS intent_id,
    count() AS mapped_term_count,
    avg(confidence) AS avg_confidence
  FROM etl.ba_search_term_to_intent_current
  WHERE company_id = {{company_id}}
  GROUP BY intent_id
),
joined AS (
  SELECT
    li.id AS id,
    li.company_id AS company_id,
    li.intent_id AS intent_id,
    li.intent_name AS intent_name,
    li.customer_need AS customer_need,
    li.status AS status,
    li.source AS source,
    li.clustering_run_id AS clustering_run_id,
    ifNull(nullIf(ms.mapped_term_count, 0), li.search_term_count) AS search_term_count,
    ms.avg_confidence AS avg_confidence,
    li.created_at AS created_at,
    li.created_by AS created_by
  FROM etl.ba_user_intents_current AS li
  LEFT JOIN mapping_stats AS ms ON ms.intent_id = li.intent_id
  WHERE li.company_id = {{company_id}}
    AND ({{status_filter_sql}})
    AND ({{intent_ids_filter_sql}})
)
SELECT
  id,
  company_id,
  intent_id,
  intent_name,
  customer_need,
  status,
  source,
  clustering_run_id,
  search_term_count,
  avg_confidence,
  created_at,
  created_by,
  -- count() OVER () replaces the Athena scalar subquery over the same CTE.
  count() OVER () AS total_count
FROM joined
ORDER BY created_at DESC, intent_id ASC
LIMIT {{limit_top_n}} OFFSET {{offset}}
