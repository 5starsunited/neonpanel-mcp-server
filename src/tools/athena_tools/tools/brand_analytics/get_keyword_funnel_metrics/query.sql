-- Tool: brand_analytics_get_keyword_funnel_metrics
-- Purpose: Raw funnel stage metrics (Impressions → Clicks → Cart Adds → Purchases)
--          with brand share vs total market at each stage, plus WoW trending.
-- Source:  etl.ba_search_query_performance (ClickHouse) — the SQP weekly report
--          joined to ASIN attributes; etl.ba_marketplaces supplies country_code.
-- Difference from analyze_search_query_performance:
--   • Keyword-centric (optional keywords filter with match_type, returns all if omitted)
--   • Returns raw funnel totals + shares, NOT scored RYG signals
--   • Computes funnel stage drop-off rates
-- NOTE: revenue_abcd_class / pareto_abc_class are rolling last-30-day, as-of
--       attributes of the ASIN, not the class in effect during a past report week.

WITH {{term_intents_cte_sql}},

-- ─── 1. Pull raw SQP rows, apply keyword + standard filters ────────────────
raw AS (
  SELECT
    sqp.search_query AS search_query,
    ifNull(marketplace.country_code, '') AS marketplace,
    sqp.week_start AS week_start,
    sqp.search_query_volume AS search_query_volume,
    sqp.search_query_score AS search_query_score,
    ifNull(sqp.total_query_impression_count, 0) AS total_query_impression_count,
    ifNull(sqp.asin_impression_count, 0) AS asin_impression_count,
    ifNull(sqp.total_click_count, 0) AS total_click_count,
    ifNull(sqp.asin_click_count, 0) AS asin_click_count,
    ifNull(sqp.total_cart_add_count, 0) AS total_cart_add_count,
    ifNull(sqp.asin_cart_add_count, 0) AS asin_cart_add_count,
    ifNull(sqp.total_purchase_count, 0) AS total_purchase_count,
    ifNull(sqp.asin_purchase_count, 0) AS asin_purchase_count
  FROM etl.ba_search_query_performance AS sqp
  LEFT JOIN etl.ba_marketplaces AS marketplace
    ON sqp.marketplace_id = marketplace.marketplace_id
  WHERE
    has({{company_ids_array}}, sqp.company_id)

    -- Keyword matching (optional — when empty, returns all keywords).
    -- startsWith/position rather than LIKE: a keyword containing % or _ would
    -- otherwise act as a wildcard and silently widen the match.
    AND (
      length({{keywords_array}}) = 0
      OR multiIf(
           {{match_type_sql}} = 'exact',
             arrayExists(k -> lower(k) = lower(sqp.search_query), {{keywords_array}}),
           {{match_type_sql}} = 'starts_with',
             arrayExists(k -> startsWith(lower(sqp.search_query), lower(k)), {{keywords_array}}),
           arrayExists(k -> position(lower(sqp.search_query), lower(k)) > 0, {{keywords_array}})
         )
    )

    AND ({{intent_terms_filter_sql}})

    -- Optional marketplace
    AND (
      length({{marketplaces_array}}) = 0
      OR arrayExists(
           m -> lower(m) IN (lower(ifNull(marketplace.country_code, '')), lower(ifNull(marketplace.marketplace_name, ''))),
           {{marketplaces_array}}
         )
    )

    -- Optional ASIN filter
    AND (length({{asins_array}}) = 0 OR arrayExists(a -> lower(a) = lower(sqp.asin), {{asins_array}}))

    -- Optional brand filter
    AND (length({{brands_array}}) = 0 OR arrayExists(b -> lower(b) = lower(ifNull(sqp.brand, '')), {{brands_array}}))

    -- Optional product family
    AND (length({{product_families_array}}) = 0
         OR arrayExists(f -> lower(f) = lower(ifNull(sqp.product_family, '')), {{product_families_array}}))

    -- Optional revenue ABCD class
    AND (length({{revenue_abcd_class_array}}) = 0
         OR arrayExists(c -> upper(c) = upper(ifNull(sqp.revenue_abcd_class, '')), {{revenue_abcd_class_array}}))

    -- Optional Pareto ABC class
    AND (length({{pareto_abc_class_array}}) = 0
         OR arrayExists(c -> upper(c) = upper(ifNull(sqp.pareto_abc_class, '')), {{pareto_abc_class_array}}))
),

-- ─── 2. Determine date window ──────────────────────────────────────────────
-- lookback_start reaches one week further back so the LAG has a prior row even
-- when periods_back = 1.
date_bounds AS (
  SELECT
    ifNull({{start_date_sql}}, addWeeks(max(week_start), -1 * ({{periods_back}} - 1))) AS start_date,
    ifNull({{end_date_sql}}, max(week_start)) AS end_date,
    addWeeks(ifNull({{start_date_sql}}, addWeeks(max(week_start), -1 * ({{periods_back}} - 1))), -1) AS lookback_start
  FROM raw
),

windowed AS (
  SELECT *
  FROM raw
  WHERE week_start >= (SELECT lookback_start FROM date_bounds)
    AND week_start <= (SELECT end_date FROM date_bounds)
),

-- ─── 3. Aggregate to keyword × period level ────────────────────────────────
-- One keyword can appear across multiple ASINs; we aggregate brand-level shares.
keyword_agg AS (
  SELECT
    w.search_query                                                AS keyword,
    w.marketplace                                                 AS marketplace,
    w.week_start                                                  AS period_start,
    addDays(w.week_start, 6)                                      AS period_end,

    -- Search volume and score (use max since it's the same per keyword per period)
    MAX(w.search_query_volume)                                    AS search_query_volume,
    MAX(w.search_query_score)                                     AS search_query_score,

    -- Impressions (total repeats on every ASIN row for the query-week, so MAX
    -- takes it once; brand = sum across this company's ASINs)
    MAX(w.total_query_impression_count)                           AS total_impressions,
    SUM(w.asin_impression_count)                                  AS brand_impressions,
    CASE WHEN MAX(w.total_query_impression_count) > 0
      THEN SUM(w.asin_impression_count) / MAX(w.total_query_impression_count)
      ELSE 0 END                                                  AS brand_impression_share,

    -- Clicks
    MAX(w.total_click_count)                                      AS total_clicks,
    SUM(w.asin_click_count)                                       AS brand_clicks,
    CASE WHEN MAX(w.total_click_count) > 0
      THEN SUM(w.asin_click_count) / MAX(w.total_click_count)
      ELSE 0 END                                                  AS brand_click_share,

    -- Cart Adds
    MAX(w.total_cart_add_count)                                   AS total_cart_adds,
    SUM(w.asin_cart_add_count)                                    AS brand_cart_adds,
    CASE WHEN MAX(w.total_cart_add_count) > 0
      THEN SUM(w.asin_cart_add_count) / MAX(w.total_cart_add_count)
      ELSE 0 END                                                  AS brand_cart_add_share,

    -- Purchases
    MAX(w.total_purchase_count)                                   AS total_purchases,
    SUM(w.asin_purchase_count)                                    AS brand_purchases,
    CASE WHEN MAX(w.total_purchase_count) > 0
      THEN SUM(w.asin_purchase_count) / MAX(w.total_purchase_count)
      ELSE 0 END                                                  AS brand_purchase_share

  FROM windowed w
  GROUP BY
    w.search_query,
    w.marketplace,
    w.week_start
),

-- ─── 4. WoW trends via lagInFrame ─────────────────────────────────────────
-- toNullable + explicit NULL default reproduces LAG semantics: no prior week
-- yields NULL, not a fabricated 0 delta. The ROWS frame is required — the
-- default RANGE frame would not step back exactly one row.
with_trends AS (
  SELECT
    k.*,

    k.brand_impression_share - lagInFrame(toNullable(k.brand_impression_share), 1, NULL)
      OVER (PARTITION BY k.keyword, k.marketplace ORDER BY k.period_start
            ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)
      AS brand_impression_share_wow,
    k.brand_click_share - lagInFrame(toNullable(k.brand_click_share), 1, NULL)
      OVER (PARTITION BY k.keyword, k.marketplace ORDER BY k.period_start
            ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)
      AS brand_click_share_wow,
    k.brand_cart_add_share - lagInFrame(toNullable(k.brand_cart_add_share), 1, NULL)
      OVER (PARTITION BY k.keyword, k.marketplace ORDER BY k.period_start
            ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)
      AS brand_cart_add_share_wow,
    k.brand_purchase_share - lagInFrame(toNullable(k.brand_purchase_share), 1, NULL)
      OVER (PARTITION BY k.keyword, k.marketplace ORDER BY k.period_start
            ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)
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
-- The key columns are renamed: when a name exists on both sides of a join,
-- ClickHouse's analyzer emits the wildcard side's copy qualified (`f.keyword`),
-- which would leak that qualified name all the way out to the tool's output.
latest_period AS (
  SELECT
    keyword           AS lp_keyword,
    marketplace       AS lp_marketplace,
    MAX(period_start) AS lp_max_period_start
  FROM with_funnel
  GROUP BY keyword, marketplace
),

final AS (
  SELECT
    f.*,
    ti.intent_ids AS intent_ids,
    ti.primary_intent_id AS primary_intent_id,
    ti.primary_intent_label AS primary_intent_label
  FROM with_funnel f
  INNER JOIN latest_period lp
    ON  f.keyword      = lp.lp_keyword
    AND f.marketplace  = lp.lp_marketplace
    AND f.period_start = lp.lp_max_period_start
  -- Intent enrichment: flatten across companies (keyword_agg is not split by company).
  LEFT JOIN (
    SELECT
      term_norm AS term_norm,
      arrayDistinct(arrayFlatten(groupArray(intent_ids))) AS intent_ids,
      any(primary_intent_id)                              AS primary_intent_id,
      any(primary_intent_label)                           AS primary_intent_label
    FROM term_intents
    GROUP BY term_norm
  ) AS ti ON ti.term_norm = lower(f.keyword)
  WHERE
    -- Optional min_search_query_score filter
    ({{min_search_frequency_rank}} = 0 OR f.search_query_score <= {{min_search_frequency_rank}})
    -- Optional min_impressions
    AND ({{min_impressions}} = 0 OR COALESCE(f.total_impressions, 0) >= {{min_impressions}})
)

-- The window ORDER BY and the final ORDER BY must be identical and total.
-- With only {{sort_column}} to order by, ties are broken independently by the
-- window and by the final sort, so a LIMITed "top N" can come back carrying
-- arbitrary rank values. Ordering the result by the computed rank, and giving
-- both sorts the same key tiebreakers, keeps the two in lockstep.
SELECT
  row_number() OVER (
    ORDER BY {{sort_column}} {{sort_direction}} NULLS LAST,
             keyword ASC, marketplace ASC, period_start ASC
  ) AS `rank`,
  final.*
FROM final
ORDER BY `rank` ASC
LIMIT {{limit_top_n}};
