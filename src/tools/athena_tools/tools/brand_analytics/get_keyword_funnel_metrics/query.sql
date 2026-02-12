-- Tool: brand_analytics_get_keyword_funnel_metrics
-- Purpose: Raw funnel stage metrics (Impressions → Clicks → Cart Adds → Purchases)
--          with brand share vs total market at each stage, plus WoW trending.
-- Difference from analyze_search_query_performance:
--   • Keyword-centric (requires keywords filter, supports match_type)
--   • Returns raw funnel totals + shares, NOT scored RYG signals
--   • Computes funnel stage drop-off rates
--   • Optionally includes competitor context (top 3 ASINs from search_term_smart_snapshot)

WITH params AS (
  SELECT
    {{limit_top_n}}                   AS limit_top_n,
    {{start_date_sql}}                AS start_date,
    {{end_date_sql}}                  AS end_date,
    CAST({{periods_back}} AS INTEGER) AS periods_back,

    -- REQUIRED (authorization + partition pruning)
    {{company_ids_array}}             AS company_ids,
    transform({{company_ids_array}}, x -> CAST(x AS VARCHAR)) AS company_ids_str,

    -- REQUIRED keyword filter
    {{keywords_array}}                AS keywords,
    {{match_type_sql}}                AS match_type,

    -- OPTIONAL filters
    {{marketplaces_array}}            AS marketplaces,
    {{asins_array}}                   AS asins,
    {{brands_array}}                  AS brands,

    -- Tool-specific thresholds
    CAST({{min_search_frequency_rank}} AS INTEGER) AS min_search_frequency_rank,
    CAST({{min_impressions}} AS INTEGER)           AS min_impressions
),

-- ─── 1. Pull raw SQP rows, apply keyword + standard filters ────────────────
raw AS (
  SELECT r.*
  FROM "{{catalog}}"."brand_analytics_iceberg"."search_query_performance_snapshot" r
  CROSS JOIN params p
  WHERE
    -- Partition pruning: company_id is VARCHAR in the table
    contains(p.company_ids_str, r.company_id)

    -- Keyword matching (required)
    AND (
      CASE p.match_type
        WHEN 'exact' THEN
          any_match(p.keywords, k -> lower(k) = lower(r.searchquerydata_searchquery))
        WHEN 'starts_with' THEN
          any_match(p.keywords, k -> lower(r.searchquerydata_searchquery) LIKE lower(k) || '%')
        ELSE -- 'contains'
          any_match(p.keywords, k -> lower(r.searchquerydata_searchquery) LIKE '%' || lower(k) || '%')
      END
    )

    -- Optional marketplace
    AND (
      cardinality(p.marketplaces) = 0
      OR any_match(
        p.marketplaces,
        m -> lower(m) IN (lower(r.marketplace_country_code), lower(r.marketplace))
      )
    )

    -- Optional ASIN filter
    AND (cardinality(p.asins) = 0 OR any_match(p.asins, a -> lower(a) = lower(r.asin)))

    -- Optional brand filter
    AND (cardinality(p.brands) = 0 OR any_match(p.brands, b -> lower(b) = lower(r.brand)))

    -- Only child rows for funnel (parent rows aggregate differently)
    AND r.row_type = 'child'
),

-- ─── 2. Determine date window ──────────────────────────────────────────────
latest AS (
  SELECT max(week_start) AS latest_week FROM raw
),

date_bounds AS (
  SELECT
    COALESCE(p.start_date, date_add('week', -1 * (p.periods_back - 1), l.latest_week)) AS start_date,
    COALESCE(p.end_date, l.latest_week) AS end_date
  FROM params p
  CROSS JOIN latest l
),

windowed AS (
  SELECT r.*
  FROM raw r
  CROSS JOIN date_bounds d
  WHERE r.week_start BETWEEN d.start_date AND d.end_date
    AND r.year BETWEEN year(d.start_date) AND year(d.end_date)
),

-- ─── 3. Aggregate to keyword × period level ────────────────────────────────
-- One keyword can appear across multiple ASINs; we aggregate brand-level shares.
keyword_agg AS (
  SELECT
    w.searchquerydata_searchquery                                 AS keyword,
    w.marketplace_country_code                                    AS marketplace,
    w.week_start                                                  AS period_start,
    date_add('day', 6, w.week_start)                              AS period_end,

    -- Search frequency (use max since it's the same per keyword per period)
    MAX(w.searchquerydata_searchqueryvolume)                      AS search_query_volume,
    MAX(w.searchquerydata_searchqueryscore)                       AS search_frequency_rank,

    -- Impressions (total is same per keyword; brand = sum across ASINs)
    MAX(w.impressiondata_totalqueryimpressioncount)               AS total_impressions,
    SUM(w.impressiondata_asinimpressioncount)                     AS brand_impressions,
    CASE WHEN MAX(w.impressiondata_totalqueryimpressioncount) > 0
      THEN SUM(w.impressiondata_asinimpressioncount) / MAX(w.impressiondata_totalqueryimpressioncount)
      ELSE 0 END                                                  AS brand_impression_share,

    -- Clicks
    MAX(w.clickdata_totalclickcount)                              AS total_clicks,
    SUM(w.clickdata_asinclickcount)                               AS brand_clicks,
    CASE WHEN MAX(w.clickdata_totalclickcount) > 0
      THEN SUM(w.clickdata_asinclickcount) / MAX(w.clickdata_totalclickcount)
      ELSE 0 END                                                  AS brand_click_share,

    -- Cart Adds
    MAX(w.cartadddata_totalcartaddcount)                          AS total_cart_adds,
    SUM(w.cartadddata_asincartaddcount)                           AS brand_cart_adds,
    CASE WHEN MAX(w.cartadddata_totalcartaddcount) > 0
      THEN SUM(w.cartadddata_asincartaddcount) / MAX(w.cartadddata_totalcartaddcount)
      ELSE 0 END                                                  AS brand_cart_add_share,

    -- Purchases
    MAX(w.purchasedata_totalpurchasecount)                        AS total_purchases,
    SUM(w.purchasedata_asinpurchasecount)                         AS brand_purchases,
    CASE WHEN MAX(w.purchasedata_totalpurchasecount) > 0
      THEN SUM(w.purchasedata_asinpurchasecount) / MAX(w.purchasedata_totalpurchasecount)
      ELSE 0 END                                                  AS brand_purchase_share

  FROM windowed w
  GROUP BY
    w.searchquerydata_searchquery,
    w.marketplace_country_code,
    w.week_start
),

-- ─── 4. WoW trends via LAG ────────────────────────────────────────────────
with_trends AS (
  SELECT
    k.*,

    -- WoW delta for each brand share metric
    k.brand_impression_share - LAG(k.brand_impression_share)
      OVER (PARTITION BY k.keyword, k.marketplace ORDER BY k.period_start)
      AS brand_impression_share_wow,
    k.brand_click_share - LAG(k.brand_click_share)
      OVER (PARTITION BY k.keyword, k.marketplace ORDER BY k.period_start)
      AS brand_click_share_wow,
    k.brand_cart_add_share - LAG(k.brand_cart_add_share)
      OVER (PARTITION BY k.keyword, k.marketplace ORDER BY k.period_start)
      AS brand_cart_add_share_wow,
    k.brand_purchase_share - LAG(k.brand_purchase_share)
      OVER (PARTITION BY k.keyword, k.marketplace ORDER BY k.period_start)
      AS brand_purchase_share_wow

  FROM keyword_agg k
),

-- ─── 5. Funnel drop-off rates ──────────────────────────────────────────────
with_funnel AS (
  SELECT
    t.*,

    -- Market-level funnel rates
    CASE WHEN t.total_impressions > 0
      THEN t.total_clicks * 1.0 / t.total_impressions ELSE NULL END
      AS market_impression_to_click_rate,
    CASE WHEN t.total_clicks > 0
      THEN t.total_cart_adds * 1.0 / t.total_clicks ELSE NULL END
      AS market_click_to_cart_rate,
    CASE WHEN t.total_cart_adds > 0
      THEN t.total_purchases * 1.0 / t.total_cart_adds ELSE NULL END
      AS market_cart_to_purchase_rate,
    CASE WHEN t.total_impressions > 0
      THEN t.total_purchases * 1.0 / t.total_impressions ELSE NULL END
      AS market_impression_to_purchase_rate,

    -- Brand-level funnel rates
    CASE WHEN t.brand_impressions > 0
      THEN t.brand_clicks * 1.0 / t.brand_impressions ELSE NULL END
      AS brand_impression_to_click_rate,
    CASE WHEN t.brand_clicks > 0
      THEN t.brand_cart_adds * 1.0 / t.brand_clicks ELSE NULL END
      AS brand_click_to_cart_rate,
    CASE WHEN t.brand_cart_adds > 0
      THEN t.brand_purchases * 1.0 / t.brand_cart_adds ELSE NULL END
      AS brand_cart_to_purchase_rate,
    CASE WHEN t.brand_impressions > 0
      THEN t.brand_purchases * 1.0 / t.brand_impressions ELSE NULL END
      AS brand_impression_to_purchase_rate

  FROM with_trends t
),

-- ─── 6. Keep only latest period per keyword for the final output ───────────
-- (trend rows from earlier periods were only needed for the LAG calculation)
latest_period AS (
  SELECT keyword, marketplace, MAX(period_start) AS max_period_start
  FROM with_funnel
  GROUP BY keyword, marketplace
),

final AS (
  SELECT f.*
  FROM with_funnel f
  INNER JOIN latest_period lp
    ON  f.keyword     = lp.keyword
    AND f.marketplace = lp.marketplace
    AND f.period_start = lp.max_period_start
  CROSS JOIN params p
  WHERE
    -- Optional min_search_frequency_rank (lower rank = higher volume)
    (p.min_search_frequency_rank = 0 OR f.search_frequency_rank <= p.min_search_frequency_rank)
    -- Optional min_impressions
    AND (p.min_impressions = 0 OR COALESCE(f.total_impressions, 0) >= p.min_impressions)
)

SELECT *
FROM final
ORDER BY search_frequency_rank ASC
LIMIT {{limit_top_n}};
