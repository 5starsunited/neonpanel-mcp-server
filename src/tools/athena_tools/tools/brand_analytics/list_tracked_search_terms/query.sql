-- List tracked search terms for the given company scope.
-- Dedup to latest row per logical slot so re-writes don't show duplicates.
WITH {{term_intents_cte_sql}},
ranked AS (
  SELECT
    r.company_id,
    r.marketplace,
    r.asin,
    r.parent_asin,
    r.product_family,
    r.keyword,
    r.priority,
    r.intent,
    r.added_by,
    r.added_at,
    r.is_active,
    r.notes,
    ti.intent_ids,
    ti.primary_intent_id,
    ti.primary_intent_label,
    ROW_NUMBER() OVER (
      PARTITION BY
        r.company_id,
        r.marketplace,
        LOWER(r.keyword),
        COALESCE(r.asin, ''),
        COALESCE(r.parent_asin, ''),
        COALESCE(r.product_family, '')
      ORDER BY r.added_at DESC
    ) AS rn
  FROM "{{catalog}}"."brand_analytics_iceberg"."tracked_search_terms" r
  LEFT JOIN term_intents ti
    ON ti.company_id = r.company_id
   AND ti.term_norm = lower(r.keyword)
  WHERE {{company_filter_sql}}
    AND ({{marketplace_filter_sql}})
    AND ({{asin_filter_sql}})
    AND ({{parent_asin_filter_sql}})
    AND ({{product_family_filter_sql}})
    AND ({{keyword_filter_sql}})
    AND ({{intent_filter_sql}})
    AND ({{intent_terms_filter_sql}})
)
SELECT
  company_id,
  marketplace,
  asin,
  parent_asin,
  product_family,
  keyword,
  priority,
  intent,
  added_by,
  added_at,
  is_active,
  notes,
  intent_ids,
  primary_intent_id,
  primary_intent_label
FROM ranked
WHERE rn = 1
  AND ({{active_filter_sql}})
ORDER BY
  company_id,
  marketplace,
  priority NULLS LAST,
  keyword
LIMIT {{limit_top_n}}
