-- List tracked search terms for the given company scope.
-- Dedup to latest row per logical slot so re-writes don't show duplicates.
WITH ranked AS (
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
    ROW_NUMBER() OVER (
      PARTITION BY
        company_id,
        marketplace,
        LOWER(keyword),
        COALESCE(asin, ''),
        COALESCE(parent_asin, ''),
        COALESCE(product_family, '')
      ORDER BY added_at DESC
    ) AS rn
  FROM "{{catalog}}"."brand_analytics_iceberg"."tracked_search_terms"
  WHERE {{company_filter_sql}}
    AND ({{marketplace_filter_sql}})
    AND ({{asin_filter_sql}})
    AND ({{parent_asin_filter_sql}})
    AND ({{product_family_filter_sql}})
    AND ({{keyword_filter_sql}})
    AND ({{intent_filter_sql}})
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
  notes
FROM ranked
WHERE rn = 1
  AND ({{active_filter_sql}})
ORDER BY
  company_id,
  marketplace,
  priority NULLS LAST,
  keyword
LIMIT {{limit_top_n}}
