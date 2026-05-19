-- List intents for a company with rolled-up search-term metrics.
-- Dedup user_intents to the latest row per (company_id, intent_id).
WITH latest_intent AS (
  SELECT
    id,
    company_id,
    intent_id,
    intent_name,
    customer_need,
    status,
    search_term_count,
    source,
    clustering_run_id,
    created_at,
    created_by,
    ROW_NUMBER() OVER (
      PARTITION BY company_id, intent_id
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM "{{catalog}}"."brand_analytics_iceberg"."user_intents"
  WHERE company_id = {{company_id}}
),
mapping_stats AS (
  SELECT
    intent_id,
    COUNT(*) AS mapped_term_count,
    AVG(confidence) AS avg_confidence
  FROM "{{catalog}}"."brand_analytics_iceberg"."search_term_to_intent"
  WHERE company_id = {{company_id}}
  GROUP BY intent_id
),
joined AS (
  SELECT
    li.id,
    li.company_id,
    li.intent_id,
    li.intent_name,
    li.customer_need,
    li.status,
    li.source,
    li.clustering_run_id,
    COALESCE(ms.mapped_term_count, li.search_term_count, 0) AS search_term_count,
    ms.avg_confidence,
    li.created_at,
    li.created_by
  FROM latest_intent li
  LEFT JOIN mapping_stats ms ON ms.intent_id = li.intent_id
  WHERE li.rn = 1
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
  (SELECT COUNT(*) FROM joined) AS total_count
FROM joined
ORDER BY created_at DESC, intent_id ASC
OFFSET {{offset}}
LIMIT {{limit_top_n}}
