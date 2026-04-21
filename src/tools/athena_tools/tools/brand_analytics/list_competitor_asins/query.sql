-- List competitor ASINs for the given company scope.
-- Dedup to latest row per logical slot so re-writes don't show duplicates.
WITH ranked AS (
  SELECT
    company_id,
    marketplace,
    competitor_asin,
    competitor_brand,
    competitor_label,
    against_my_asin,
    against_my_product_family,
    priority,
    added_by,
    added_at,
    is_active,
    ROW_NUMBER() OVER (
      PARTITION BY
        company_id,
        marketplace,
        competitor_asin,
        COALESCE(against_my_asin, ''),
        COALESCE(against_my_product_family, '')
      ORDER BY added_at DESC
    ) AS rn
  FROM "{{catalog}}"."brand_analytics_iceberg"."competitor_asins"
  WHERE {{company_filter_sql}}
    AND ({{marketplace_filter_sql}})
    AND ({{against_my_asin_filter_sql}})
    AND ({{against_my_product_family_filter_sql}})
    AND ({{competitor_asin_filter_sql}})
)
SELECT
  company_id,
  marketplace,
  competitor_asin,
  competitor_brand,
  competitor_label,
  against_my_asin,
  against_my_product_family,
  priority,
  added_by,
  added_at,
  is_active
FROM ranked
WHERE rn = 1
  AND ({{active_filter_sql}})
ORDER BY
  company_id,
  marketplace,
  priority NULLS LAST,
  competitor_asin
LIMIT {{limit_top_n}}
