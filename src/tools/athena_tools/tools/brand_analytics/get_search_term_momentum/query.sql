-- Tool: brand_analytics_get_search_term_momentum
-- Purpose: Weekly search term momentum from the smart snapshot.
-- Source: search_term_smart_snapshot (weekly, top-3 flattened).
-- Notes:
-- - company_id filtering is REQUIRED for authorization + partition pruning.
-- - Snapshot is weekly only; partitioned by (company_id, year, week_start).
-- - Top-3 competitor ASINs, click shares, conversion shares are pre-flattened.
-- - WoW delta, 4w avg, 12w avg, momentum_signal are COMPUTED here via window fns.
-- - We read 12 extra weeks before start_date for rolling average history.

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

-- ─── 1. Base filter: dimension filters + partition pruning ─────────────────
-- We do NOT filter on dates here so the "latest" CTE can find the true max week.
-- A rough year guard limits the scan to recent partitions only.
base_filtered AS (
  SELECT s.*
  FROM "{{catalog}}"."brand_analytics_iceberg"."search_term_smart_snapshot" s
  CROSS JOIN params p
  WHERE
    -- Partition pruning on company_id (BIGINT)
    contains(p.company_ids, s.company_id)

    -- Rough year guard (current year ± 1 covers any 52-week lookback + 12-week history)
    AND s.year >= year(current_date) - 2

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

    -- Optional: at least one of my/competitor ASINs must appear in row or top-3
    AND (
      (cardinality(p.asins) = 0 AND cardinality(p.competitor_asins) = 0)
      OR any_match(p.asins, a -> lower(a) = lower(s.asin))
      OR any_match(p.competitor_asins, a -> lower(a) IN (
           lower(s.rank_1_asin), lower(s.rank_2_asin), lower(s.rank_3_asin)
         ))
    )
),

-- ─── 2. Date bounds ────────────────────────────────────────────────────────
latest AS (
  SELECT max(week_start) AS latest_week FROM base_filtered
),

date_bounds AS (
  SELECT
    COALESCE(p.start_date, date_add('week', -1 * (p.periods_back - 1), l.latest_week)) AS start_date,
    COALESCE(p.end_date, l.latest_week)                                                 AS end_date
  FROM params p
  CROSS JOIN latest l
),

-- ─── 3. Expanded window: requested range + 12-week lookback for rolling avgs ─
expanded AS (
  SELECT f.*
  FROM base_filtered f
  CROSS JOIN date_bounds d
  WHERE f.week_start BETWEEN date_add('week', -12, d.start_date) AND d.end_date
    AND f.year BETWEEN year(date_add('week', -12, d.start_date)) AND year(d.end_date)
),

-- ─── 4. Compute momentum via window functions ─────────────────────────────
with_momentum AS (
  SELECT
    e.*,
    LAG(e.my_click_share, 1) OVER w                                        AS prev_week_share,
    e.my_click_share - LAG(e.my_click_share, 1) OVER w                    AS wow_delta,
    AVG(e.my_click_share) OVER (
      PARTITION BY e.search_term, e.asin, e.marketplace_country_code, e.company_id
      ORDER BY e.week_start
      ROWS BETWEEN 3 PRECEDING AND CURRENT ROW
    )                                                                       AS avg_share_l4w,
    AVG(e.my_click_share) OVER (
      PARTITION BY e.search_term, e.asin, e.marketplace_country_code, e.company_id
      ORDER BY e.week_start
      ROWS BETWEEN 11 PRECEDING AND CURRENT ROW
    )                                                                       AS avg_share_l12w
  FROM expanded e
  WINDOW w AS (
    PARTITION BY e.search_term, e.asin, e.marketplace_country_code, e.company_id
    ORDER BY e.week_start
  )
),

-- ─── 5. Trim to actual date range + label momentum signal ─────────────────
windowed AS (
  SELECT
    m.*,
    CASE
      WHEN m.wow_delta IS NULL                                        THEN 'new'
      WHEN m.wow_delta > 0 AND m.avg_share_l4w > m.avg_share_l12w    THEN 'accelerating'
      WHEN m.wow_delta > 0                                            THEN 'growing'
      WHEN m.wow_delta < 0 AND m.avg_share_l4w < m.avg_share_l12w    THEN 'collapsing'
      WHEN m.wow_delta < 0                                            THEN 'declining'
      ELSE 'stable'
    END AS momentum_signal
  FROM with_momentum m
  CROSS JOIN date_bounds d
  WHERE m.week_start BETWEEN d.start_date AND d.end_date
),

-- ─── 6. Pick latest week per (search_term, asin, marketplace) ──────────────
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

-- ─── 7. Enrich with computed fields ────────────────────────────────────────
enriched AS (
  SELECT
    c.search_term,
    c.company                  AS company_name,
    c.marketplace_country_code AS marketplace,
    c.currency,
    c.rank_1_department        AS category,
    c.volume                   AS search_volume,
    c.week_start               AS period_start,
    date_add('day', 6, c.week_start) AS period_end,

    -- My position context
    c.asin                     AS my_asin,
    c.brand                    AS my_brand,
    c.my_click_share,
    c.prev_week_share,
    ROUND(c.wow_delta, 6)      AS wow_delta,
    ROUND(c.avg_share_l4w, 6)  AS avg_share_l4w,
    ROUND(c.avg_share_l12w, 6) AS avg_share_l12w,
    c.momentum_signal,

    -- Product classification
    c.revenue_abcd_class,
    c.pareto_abc_class,
    c.asin_class,
    c.product_family,
    ROUND(c.revenue_share, 4)  AS revenue_share,

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

SELECT
  ROW_NUMBER() OVER (ORDER BY {{sort_column}} {{sort_direction}} NULLS LAST) AS rank,
  e.*
FROM enriched e
CROSS JOIN params p
WHERE
  -- Optional momentum signal filter (applied post-computation)
  (cardinality(p.momentum_signals) = 0
   OR any_match(p.momentum_signals, s -> lower(s) = lower(e.momentum_signal)))
  -- Tool-specific min thresholds
  AND (p.min_click_share = 0 OR COALESCE(e.my_click_share, 0) >= p.min_click_share)
  AND (p.min_search_volume = 0 OR COALESCE(e.search_volume, 0) >= p.min_search_volume)
ORDER BY {{sort_column}} {{sort_direction}} NULLS LAST
LIMIT {{limit_top_n}};
