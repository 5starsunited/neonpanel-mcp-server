-- PPC leg for brand_analytics_growth_machine_diagnosis (Athena).
--
-- Source: amazon_ads.ads_dataset (Iceberg, day(time_window_start)), refreshed daily by
-- clickhouse_etl/etl/ads_athena. Its Marketing Stream rows split traffic and conversion:
--   * sp-traffic rows carry target_keyword + match_type + impressions/clicks/cost;
--   * sp-conversion rows carry ONLY target_keyword_id + sales/orders (no keyword text).
-- Grouping by keyword text therefore strands every sale on a NULL-keyword row. We rebuild
-- the keyword dimension from target_keyword_id (verified 2026-11-12 for company 106: 100% of
-- conversion sales resolve to a traffic keyword_id) before aggregating.
--
-- Only SPONSORED PRODUCTS EXACT-match keyword targets are returned. A target is what the
-- advertiser bid on, not what the shopper typed; for EXACT match the two coincide, so the row
-- can be joined to SQP's search_query. BROAD / PHRASE / auto / ASIN / category targets have no
-- reliable search term and are excluded (their spend is reported in the coverage row instead).
--
-- Period alignment: SQP rows are weekly (Sunday week_start) and the diagnosis keeps weeks whose
-- week_start falls in [period_start, period_end]. Each ads day is mapped to its Sunday week
-- start with the same rule, so PPC and SQP cover exactly the same days.
--
-- Money is converted to USD with the row's currency_rate (NULL for USD).
--
-- Output: one row per (kw_norm, child_asin) with row_kind = 'exact', plus a single
-- row_kind = 'coverage' row (kw_norm = '', child_asin = '') holding total SP spend in scope,
-- so the caller can report how much of the spend the EXACT leg represents. The coverage row
-- is always present (aggregates over an empty set still return one row) and sorts first.
WITH sp AS (
  SELECT
    target_keyword_id,
    target_keyword,
    upper(match_type) AS match_type,
    coalesce(nullif(advertised_asin, ''), nullif(child_asin, '')) AS child_asin,
    campaign_id,
    impressions,
    clicks,
    cost * coalesce(currency_rate, 1.0) AS cost_usd,
    attributed_sales * coalesce(currency_rate, 1.0) AS sales_usd,
    conversions
  FROM "{{catalog}}"."amazon_ads"."ads_dataset"
  WHERE company_id = {{company_id}}
    AND amazon_marketplace_id = {{marketplace_id_literal}}
    AND dataset IN ('sponsored_products', 'sp_advertised_product')
    -- Partition pruning (day(time_window_start)), widened by a week on each side; the exact
    -- week rule is applied below.
    AND time_window_start >= CAST(date_add('day', -7, {{period_start_date}}) AS TIMESTAMP)
    AND time_window_start <  CAST(date_add('day', 14, {{period_end_date}}) AS TIMESTAMP)
    AND date_add(
          'day',
          -(day_of_week(CAST(time_window_start AS DATE)) % 7),
          CAST(time_window_start AS DATE)
        ) BETWEEN {{period_start_date}} AND {{period_end_date}}
),

-- keyword_id -> keyword text / match type, taken from the traffic rows that carry them.
kw_dim AS (
  SELECT
    target_keyword_id,
    arbitrary(target_keyword) AS target_keyword,
    arbitrary(match_type) AS match_type
  FROM sp
  WHERE target_keyword_id IS NOT NULL
    AND target_keyword IS NOT NULL
    AND match_type IS NOT NULL
  GROUP BY target_keyword_id
),

resolved AS (
  SELECT
    coalesce(sp.target_keyword, k.target_keyword) AS target_keyword,
    coalesce(sp.match_type, k.match_type) AS match_type,
    sp.child_asin,
    sp.campaign_id,
    sp.impressions,
    sp.clicks,
    sp.cost_usd,
    sp.sales_usd,
    sp.conversions
  FROM sp
  LEFT JOIN kw_dim AS k ON k.target_keyword_id = sp.target_keyword_id
),

unioned AS (
SELECT
  'exact' AS row_kind,
  lower(trim(target_keyword)) AS kw_norm,
  child_asin,
  sum(coalesce(impressions, 0)) AS ppc_impressions,
  sum(coalesce(clicks, 0)) AS ppc_clicks,
  round(sum(coalesce(cost_usd, 0)), 4) AS ppc_spend,
  round(sum(coalesce(sales_usd, 0)), 4) AS ppc_sales,
  sum(coalesce(conversions, 0)) AS ppc_purchases,
  count(DISTINCT campaign_id) AS ppc_campaign_count
FROM resolved
WHERE match_type = 'EXACT'
  AND target_keyword IS NOT NULL
  AND trim(target_keyword) <> ''
  AND child_asin IS NOT NULL
GROUP BY lower(trim(target_keyword)), child_asin

UNION ALL

SELECT
  'coverage' AS row_kind,
  '' AS kw_norm,
  '' AS child_asin,
  sum(coalesce(impressions, 0)),
  sum(coalesce(clicks, 0)),
  round(sum(coalesce(cost_usd, 0)), 4),
  round(sum(coalesce(sales_usd, 0)), 4),
  sum(coalesce(conversions, 0)),
  count(DISTINCT campaign_id)
FROM resolved
)

-- Coverage row first, then the biggest spenders, so a caller-side row cap keeps what matters.
SELECT *
FROM unioned
ORDER BY row_kind = 'coverage' DESC, ppc_spend DESC, kw_norm, child_asin
