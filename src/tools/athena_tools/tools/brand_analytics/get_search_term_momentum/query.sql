-- Tool: brand_analytics_get_search_term_momentum
-- Purpose: Weekly search term momentum from the pre-aggregated smart snapshot.
-- Source: search_term_smart_snapshot (weekly, top-3 flattened, WoW/4w/12w pre-computed).
-- Notes:
-- - company_id filtering is REQUIRED for authorization + partition pruning.
-- - Snapshot is weekly only.
-- - Top-3 competitor ASINs, click shares, conversion shares are pre-flattened.
-- - WoW delta, 4-week avg, 12-week avg are pre-computed in ETL.

WITH params AS (
  SELECT
    {{limit_top_n}}                   AS limit_top_n,
    {{start_date_sql}}                AS start_date,
    {{end_date_sql}}                  AS end_date,
    CAST({{periods_back}} AS INTEGER) AS periods_back,

    -- REQUIRED (authorization + partition pruning)
    {{company_ids_array}}             AS company_ids,

    -- OPTIONAL filters (empty array => no filter)
    {{search_terms_array}}            AS search_terms,
    {{match_type_sql}}                AS match_type,
    {{asins_array}}                   AS asins,
    {{competitor_asins_array}}        AS competitor_asins,
    {{marketplaces_array}}            AS marketplaces,
    {{categories_array}}              AS categories,
    {{brands_array}}                  AS brands,
    {{revenue_abcd_class_array}}      AS revenue_abcd_class,
    {{momentum_signals_array}}        AS momentum_signals,

    -- Tool-specific thresholds
    CAST({{weak_leader_max_conversion_share}} AS DOUBLE)  AS weak_leader_max_conversion_share,
    CAST({{weak_leader_min_search_volume}} AS DOUBLE)     AS weak_leader_min_search_volume,
    CAST({{min_click_share}} AS DOUBLE)                   AS min_click_share,
    CAST({{min_search_volume}} AS DOUBLE)                 AS min_search_volume
),

-- ─── 1. Filter snapshot rows ───────────────────────────────────────────────
filtered AS (
  SELECT s.*
  FROM "{{catalog}}"."brand_analytics_iceberg"."search_term_smart_snapshot" s
  CROSS JOIN params p
  WHERE
    -- Partition pruning on company_id (BIGINT in snapshot)
    contains(p.company_ids, s.company_id)

    -- Optional search terms with match_type
    AND (
      cardinality(p.search_terms) = 0
      OR (
        CASE p.match_type
          WHEN 'exact' THEN
            any_match(p.search_terms, t -> lower(t) = lower(s.search_term))
          WHEN 'starts_with' THEN
            any_match(p.search_terms, t -> lower(s.search_term) LIKE lower(t) || '%')
          ELSE -- 'contains'
            any_match(p.search_terms, t -> lower(s.search_term) LIKE '%' || lower(t) || '%')
        END
      )
    )

    -- Optional marketplace
    AND (cardinality(p.marketplaces) = 0
         OR any_match(p.marketplaces,
            m -> lower(m) IN (lower(s.marketplace_country_code), lower(s.marketplace), lower(s.country))))

    -- Optional category (match against any of the top-3 department names)
    AND (cardinality(p.categories) = 0
         OR any_match(p.categories, c ->
              lower(c) IN (lower(s.rank_1_department), lower(s.rank_2_department), lower(s.rank_3_department))))

    -- Optional brand
    AND (cardinality(p.brands) = 0
         OR any_match(p.brands, b -> lower(b) = lower(s.brand)))

    -- Optional ASIN filter (my ASIN)
    AND (cardinality(p.asins) = 0
         OR any_match(p.asins, a -> lower(a) = lower(s.asin)))

    -- Optional revenue class
    AND (cardinality(p.revenue_abcd_class) = 0
         OR any_match(p.revenue_abcd_class, c -> upper(c) = upper(s.revenue_abcd_class)))

    -- Optional momentum signal
    AND (cardinality(p.momentum_signals) = 0
         OR any_match(p.momentum_signals, m -> lower(m) = lower(s.momentum_signal)))

    -- Optional: at least one of my/competitor ASINs must appear in row or top-3
    AND (
      (cardinality(p.asins) = 0 AND cardinality(p.competitor_asins) = 0)
      OR any_match(p.asins, a -> lower(a) = lower(s.asin))
      OR any_match(p.competitor_asins, a -> lower(a) IN (
           lower(s.rank_1_asin), lower(s.rank_2_asin), lower(s.rank_3_asin)
         ))
    )
),

-- ─── 2. Date window ────────────────────────────────────────────────────────
latest AS (
  SELECT max(week_start) AS latest_week FROM filtered
),

date_bounds AS (
  SELECT
    COALESCE(p.start_date, date_add('week', -1 * (p.periods_back - 1), l.latest_week)) AS start_date,
    COALESCE(p.end_date, l.latest_week)                                                 AS end_date
  FROM params p
  CROSS JOIN latest l
),

windowed AS (
  SELECT f.*
  FROM filtered f
  CROSS JOIN date_bounds d
  WHERE f.week_start BETWEEN d.start_date AND d.end_date
    AND f.year BETWEEN year(d.start_date) AND year(d.end_date)
),

-- ─── 3. Pick latest week per (search_term, asin, marketplace) ──────────────
latest_per_term AS (
  SELECT search_term, asin, marketplace_country_code,
         MAX(week_start) AS max_week
  FROM windowed
  GROUP BY search_term, asin, marketplace_country_code
),

current_rows AS (
  SELECT w.*
  FROM windowed w
  INNER JOIN latest_per_term lp
    ON  w.search_term              = lp.search_term
    AND w.asin                     = lp.asin
    AND w.marketplace_country_code = lp.marketplace_country_code
    AND w.week_start               = lp.max_week
),

-- ─── 4. Enrich with computed fields ────────────────────────────────────────
enriched AS (
  SELECT
    c.search_term,
    c.marketplace_country_code AS marketplace,
    c.rank_1_department        AS category,
    c.volume                   AS search_volume,
    c.week_start               AS period_start,
    date_add('day', 6, c.week_start) AS period_end,

    -- My position context
    c.asin                     AS my_asin,
    c.brand                    AS my_brand,
    c.my_click_share,
    c.prev_week_share,
    c.wow_delta,
    c.avg_share_l4w,
    c.avg_share_l12w,
    c.momentum_signal,

    -- Product classification
    c.revenue_abcd_class,
    c.pareto_abc_class,
    c.asin_class,
    c.product_family,

    -- Top 3 (pre-flattened from ETL)
    c.rank_1_asin, c.rank_1_itemname, c.rank_1_department, c.rank_1_clickshare, c.rank_1_conversionshare,
    c.rank_2_asin, c.rank_2_itemname, c.rank_2_department, c.rank_2_clickshare, c.rank_2_conversionshare,
    c.rank_3_asin, c.rank_3_itemname, c.rank_3_department, c.rank_3_clickshare, c.rank_3_conversionshare,

    -- Is my ASIN in the top 3?
    CASE
      WHEN lower(c.asin) = lower(c.rank_1_asin) THEN 1
      WHEN lower(c.asin) = lower(c.rank_2_asin) THEN 2
      WHEN lower(c.asin) = lower(c.rank_3_asin) THEN 3
      ELSE NULL
    END AS my_position,

    -- Weak leader detection
    CASE
      WHEN c.rank_1_conversionshare IS NULL THEN false
      WHEN c.rank_1_conversionshare <= p.weak_leader_max_conversion_share
        AND COALESCE(c.volume, 0) >= p.weak_leader_min_search_volume
        THEN true
      ELSE false
    END AS is_weak_leader,

    COALESCE(c.rank_1_conversionshare, 0.0) AS leader_conversion_share,

    -- Displacement opportunity score
    CASE
      WHEN c.rank_1_conversionshare IS NULL THEN 0.0
      ELSE GREATEST(0.0, (1.0 - c.rank_1_conversionshare))
           * COALESCE(c.volume, 0)
           / 1000.0
    END AS displacement_opportunity_score,

    -- Share gap: my click share vs leader click share
    CASE
      WHEN c.my_click_share IS NOT NULL AND c.rank_1_clickshare IS NOT NULL
        THEN c.rank_1_clickshare - c.my_click_share
      ELSE NULL
    END AS click_share_to_leader

  FROM current_rows c
  CROSS JOIN params p
)

SELECT *
FROM enriched e
CROSS JOIN params p
WHERE
  -- Tool-specific min thresholds
  (p.min_click_share = 0 OR COALESCE(e.my_click_share, 0) >= p.min_click_share)
  AND (p.min_search_volume = 0 OR COALESCE(e.search_volume, 0) >= p.min_search_volume)
ORDER BY
  e.search_volume DESC NULLS LAST
LIMIT {{limit_top_n}};
