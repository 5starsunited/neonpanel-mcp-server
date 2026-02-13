-- Tool: brand_analytics_get_cross_sell_opportunities
-- Purpose: Products frequently purchased together from Amazon Brand Analytics
--          Market Basket Analysis report. Identifies cross-sell, bundling,
--          and product-targeting ad opportunities.
-- Source:  sp_api_iceberg.brand_analytics_market_basket_report (weekly snapshots)
-- Notes:
--   • combinationpct = % of the primary ASIN's orders that also include the co-purchased ASIN
--   • purchasedwithrank = Amazon's rank (1 = most frequently co-purchased)
--   • Each primary ASIN has up to 3 co-purchased ASINs per week per marketplace

WITH params AS (
  SELECT
    {{limit_top_n}}                   AS limit_top_n,
    {{start_date_sql}}                AS start_date,
    {{end_date_sql}}                  AS end_date,
    CAST({{periods_back}} AS INTEGER) AS periods_back,

    -- REQUIRED (authorization + partition pruning)
    {{company_ids_array}}             AS company_ids,
    transform({{company_ids_array}}, x -> CAST(x AS VARCHAR)) AS company_ids_str,

    -- OPTIONAL ASIN filter (empty = all ASINs for the company)
    {{asins_array}}                   AS asins,

    -- OPTIONAL marketplace filter
    {{marketplaces_array}}            AS marketplaces,

    -- Minimum combination % threshold (0–100 scale, default 0 = no filter)
    CAST({{min_combination_pct}} AS DOUBLE) AS min_combination_pct,

    -- Max co-purchase rank to include (1–3, default 3 = all)
    CAST({{max_rank}} AS INTEGER)     AS max_rank
),

-- ─── 1. Raw rows with partition pruning ────────────────────────────────────
raw AS (
  SELECT
    mb.asin                       AS primary_asin,
    mb.purchasedwithasin          AS co_purchased_asin,
    mb.purchasedwithrank          AS co_purchase_rank,
    mb.combinationpct             AS combination_pct,
    mb.week_start,
    mb.rspec_marketplaceids       AS marketplace_ids,
    CAST(mb.ingest_company_id AS BIGINT) AS company_id
  FROM "{{catalog}}"."sp_api_iceberg"."brand_analytics_market_basket_report" mb
  CROSS JOIN params p
  WHERE
    -- Partition pruning: company_id
    contains(p.company_ids_str, mb.ingest_company_id)

    -- Optional ASIN filter
    AND (cardinality(p.asins) = 0 OR any_match(p.asins, a -> lower(a) = lower(mb.asin)))

    -- Optional max rank filter
    AND mb.purchasedwithrank <= p.max_rank

    -- Optional min combination %
    AND mb.combinationpct >= p.min_combination_pct
),

-- ─── 2. Resolve marketplace name from ID ───────────────────────────────────
marketplaces_dim AS (
  SELECT
    CAST(amazon_marketplace_id AS VARCHAR) AS amazon_marketplace_id,
    lower(country)    AS country,
    lower(code)       AS country_code,
    lower(name)       AS marketplace_name,
    lower(domain)     AS domain,
    CAST(id AS BIGINT) AS marketplace_numeric_id
  FROM "{{catalog}}"."neonpanel_iceberg"."amazon_marketplaces"
),

with_marketplace AS (
  SELECT
    r.*,
    COALESCE(upper(m.country_code), r.marketplace_ids[1]) AS marketplace,
    m.marketplace_numeric_id
  FROM raw r
  CROSS JOIN UNNEST(r.marketplace_ids) AS t(marketplace_id)
  LEFT JOIN marketplaces_dim m
    ON lower(m.amazon_marketplace_id) = lower(t.marketplace_id)
  CROSS JOIN params p
  WHERE
    -- Optional marketplace filter
    cardinality(p.marketplaces) = 0
    OR any_match(
      p.marketplaces,
      input -> lower(input) IN (
        m.country,
        m.country_code,
        m.marketplace_name,
        m.domain,
        lower(t.marketplace_id)
      )
    )
),

-- ─── 3. Determine date window ──────────────────────────────────────────────
latest AS (
  SELECT max(week_start) AS latest_week FROM with_marketplace
),

date_bounds AS (
  SELECT
    COALESCE(p.start_date, date_add('week', -1 * (p.periods_back - 1), l.latest_week)) AS start_date,
    COALESCE(p.end_date,   l.latest_week)                                               AS end_date
  FROM params p
  CROSS JOIN latest l
),

windowed AS (
  SELECT w.*
  FROM with_marketplace w
  CROSS JOIN date_bounds d
  WHERE w.week_start BETWEEN d.start_date AND d.end_date
),

-- ─── 4. Aggregate across weeks ─────────────────────────────────────────────
-- Average the combination_pct and count how many weeks this pair appears.
aggregated AS (
  SELECT
    w.primary_asin,
    w.co_purchased_asin,
    w.marketplace,
    w.company_id,
    MAX(w.marketplace_numeric_id) AS marketplace_numeric_id,
    MIN(w.co_purchase_rank) AS best_rank,
    ROUND(AVG(w.combination_pct), 4) AS avg_combination_pct,
    ROUND(MAX(w.combination_pct), 4) AS max_combination_pct,
    ROUND(MIN(w.combination_pct), 4) AS min_combination_pct,
    COUNT(DISTINCT w.week_start) AS weeks_appearing,
    MIN(w.week_start) AS first_seen,
    MAX(w.week_start) AS last_seen
  FROM windowed w
  GROUP BY w.primary_asin, w.co_purchased_asin, w.marketplace, w.company_id
),

-- ─── 5. Date range context ─────────────────────────────────────────────────
date_range AS (
  SELECT
    MIN(week_start) AS window_start,
    MAX(week_start) AS window_end,
    COUNT(DISTINCT week_start) AS total_weeks
  FROM windowed
),

-- ─── 6. Identify own ASINs vs competitor ASINs ────────────────────────────
-- An ASIN is "mine" if it appears as a primary_asin (Brand Analytics only reports
-- the seller's own products as primary ASINs).
my_asins AS (
  SELECT DISTINCT primary_asin AS asin
  FROM aggregated
),

with_ownership AS (
  SELECT
    a.*,
    CASE WHEN ma.asin IS NOT NULL THEN TRUE ELSE FALSE END AS co_purchased_is_own
  FROM aggregated a
  LEFT JOIN my_asins ma ON lower(ma.asin) = lower(a.co_purchased_asin)
),

-- ─── 7. Stability / consistency score ──────────────────────────────────────
-- How consistently does this pair appear? weeks_appearing / total_weeks_in_window
with_consistency AS (
  SELECT
    o.*,
    dr.total_weeks,
    dr.window_start,
    dr.window_end,
    ROUND(CAST(o.weeks_appearing AS DOUBLE) / NULLIF(dr.total_weeks, 0), 4) AS consistency_score
  FROM with_ownership o
  CROSS JOIN date_range dr
)

SELECT
  ROW_NUMBER() OVER (ORDER BY {{sort_column}} {{sort_direction}} NULLS LAST) AS rank,
  c.primary_asin,
  COALESCE(pa.product_family, 'unknown')     AS primary_product_family,
  COALESCE(pa.brand, 'unknown')              AS primary_brand,
  COALESCE(pa.pareto_abc_class, 'unknown')   AS primary_pareto_abc_class,
  COALESCE(pa.revenue_abcd_class, 'unknown') AS primary_revenue_abcd_class,
  pa.revenue_share                           AS primary_revenue_share,
  c.co_purchased_asin,
  COALESCE(ca.product_family, 'unknown')     AS co_purchased_product_family,
  COALESCE(ca.brand, 'unknown')              AS co_purchased_brand,
  COALESCE(ca.pareto_abc_class, 'unknown')   AS co_purchased_pareto_abc_class,
  COALESCE(ca.revenue_abcd_class, 'unknown') AS co_purchased_revenue_abcd_class,
  ca.revenue_share                           AS co_purchased_revenue_share,
  c.marketplace,
  c.best_rank,
  c.avg_combination_pct,
  c.max_combination_pct,
  c.min_combination_pct,
  c.weeks_appearing,
  c.total_weeks,
  c.consistency_score,
  c.co_purchased_is_own,
  CAST(c.first_seen AS DATE) AS first_seen,
  CAST(c.last_seen  AS DATE) AS last_seen,
  CAST(c.window_start AS DATE) AS window_start,
  CAST(c.window_end   AS DATE) AS window_end
FROM with_consistency c
-- ASIN attributes for primary ASIN
LEFT JOIN "{{catalog}}"."brand_analytics_iceberg"."asin_attributes" pa
  ON pa.asin = c.primary_asin
  AND pa.company_id = c.company_id
  AND pa.marketplace_id = c.marketplace_numeric_id
-- ASIN attributes for co-purchased ASIN
LEFT JOIN "{{catalog}}"."brand_analytics_iceberg"."asin_attributes" ca
  ON ca.asin = c.co_purchased_asin
  AND ca.company_id = c.company_id
  AND ca.marketplace_id = c.marketplace_numeric_id
ORDER BY {{sort_column}} {{sort_direction}} NULLS LAST
LIMIT {{limit_top_n}};
