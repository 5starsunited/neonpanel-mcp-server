-- List competitor ASINs for the given company scope (ClickHouse).
--
-- Source: analytics.ba_competitor_asins, the versioned MCP state table. FINAL
-- collapses SharedReplacingMergeTree(version) to the latest row per
-- (company_id, marketplace_id, competitor_asin, against_my_asin,
--  against_my_product_family), which replaces the Athena ROW_NUMBER dedup.
-- The base table is read instead of etl.ba_competitor_asins_current so that
-- include_inactive can still surface deactivated rows.
--
-- marketplace_id holds the canonical Amazon marketplace id; `marketplace` is
-- republished as the country code the tool contract has always returned.
SELECT
  competitors.company_id AS company_id,
  ifNull(nullIf(marketplace.country_code, ''), competitors.marketplace_id) AS marketplace,
  competitors.marketplace_id AS marketplace_id,
  competitors.competitor_asin AS competitor_asin,
  competitors.competitor_brand AS competitor_brand,
  competitors.competitor_label AS competitor_label,
  competitors.against_my_asin AS against_my_asin,
  competitors.against_my_product_family AS against_my_product_family,
  competitors.priority AS priority,
  competitors.added_by AS added_by,
  competitors.added_at AS added_at,
  competitors.is_active AS is_active
FROM analytics.ba_competitor_asins AS competitors FINAL
LEFT JOIN etl.ba_marketplaces AS marketplace
  ON marketplace.marketplace_id = competitors.marketplace_id
WHERE {{company_filter_sql}}
  AND ({{marketplace_filter_sql}})
  AND ({{against_my_asin_filter_sql}})
  AND ({{against_my_product_family_filter_sql}})
  AND ({{competitor_asin_filter_sql}})
  AND ({{active_filter_sql}})
ORDER BY
  competitors.company_id,
  competitors.marketplace_id,
  -- priority 0 means "unset" (the column is UInt16, not nullable); sort it last
  -- to preserve the Athena `priority NULLS LAST` ordering.
  competitors.priority = 0,
  competitors.priority,
  competitors.competitor_asin
LIMIT {{limit_top_n}}
