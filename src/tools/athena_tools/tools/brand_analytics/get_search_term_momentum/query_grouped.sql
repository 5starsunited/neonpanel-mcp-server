-- Tool: brand_analytics_get_search_term_momentum (grouped)
-- Purpose: Portfolio/group-level weekly search term momentum from the smart snapshot.
-- Notes:
-- - company_id filtering is REQUIRED for authorization + partition pruning.
-- - This query first de-duplicates ASIN-week rows, then aggregates to the requested group.
-- - search_volume is term-level and is de-duplicated with MAX; it is not summed across ASINs.
-- - Momentum fields are recomputed from weekly grouped portfolio click share.

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
    {{pareto_abc_class_array}}         AS pareto_abc_class,
    {{product_families_array}}         AS product_families,
    {{momentum_signals_array}}        AS momentum_signals,

    -- Tool-specific thresholds
    CAST({{weak_leader_max_conversion_share}} AS DOUBLE)  AS weak_leader_max_conversion_share,
    CAST({{weak_leader_min_search_volume}} AS DOUBLE)     AS weak_leader_min_search_volume,
    CAST({{min_click_share}} AS DOUBLE)                   AS min_click_share,
    CAST({{min_search_volume}} AS DOUBLE)                 AS min_search_volume
),

term_intents AS (
  -- Placeholder CTE: without search_term_to_intent mapping, we return NULLs
  -- to maintain schema compatibility while grouped query executes
  SELECT
    CAST(NULL AS BIGINT) AS company_id,
    CAST(NULL AS VARCHAR) AS term_norm,
    CAST(NULL AS VARCHAR) AS primary_intent_id,
    CAST(NULL AS VARCHAR) AS primary_intent_label
  WHERE FALSE
),

base_filtered AS (
  SELECT s.*
  FROM "{{catalog}}"."brand_analytics_iceberg"."search_term_smart_snapshot" s
  CROSS JOIN params p
  WHERE
    contains(p.company_ids, s.company_id)
    AND s.year >= year(current_date) - 2

    AND (
      cardinality(p.search_terms) = 0
      OR (
        CASE p.match_type
          WHEN 'exact' THEN
            any_match(p.search_terms, t -> lower(t) = lower(s.search_term))
          WHEN 'starts_with' THEN
            any_match(p.search_terms, t -> lower(s.search_term) LIKE lower(t) || '%')
          ELSE
            any_match(p.search_terms, t -> lower(s.search_term) LIKE '%' || lower(t) || '%')
        END
      )
    )

    AND (cardinality(p.marketplaces) = 0
         OR any_match(p.marketplaces,
            m -> lower(m) IN (lower(s.marketplace_country_code), lower(s.marketplace), lower(s.country))))

    AND (cardinality(p.categories) = 0
         OR any_match(p.categories, c ->
              lower(c) IN (lower(s.rank_1_department), lower(s.rank_2_department), lower(s.rank_3_department))))

    AND (cardinality(p.brands) = 0
         OR any_match(p.brands, b -> lower(b) = lower(s.brand)))

    AND (cardinality(p.asins) = 0
         OR any_match(p.asins, a -> lower(a) = lower(s.asin)))

    AND (cardinality(p.revenue_abcd_class) = 0
         OR any_match(p.revenue_abcd_class, c -> upper(c) = upper(s.revenue_abcd_class)))

    AND (cardinality(p.pareto_abc_class) = 0
         OR any_match(p.pareto_abc_class, c -> upper(c) = upper(s.pareto_abc_class)))

    AND (cardinality(p.product_families) = 0
         OR any_match(p.product_families, f -> lower(f) = lower(s.product_family)))

    AND (
      (cardinality(p.asins) = 0 AND cardinality(p.competitor_asins) = 0)
      OR any_match(p.asins, a -> lower(a) = lower(s.asin))
      OR any_match(p.competitor_asins, a -> lower(a) IN (
           lower(s.rank_1_asin), lower(s.rank_2_asin), lower(s.rank_3_asin)
         ))
    )
),

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

term_volumes AS (
  SELECT search_term, MAX(volume) AS max_vol
  FROM base_filtered f
  CROSS JOIN date_bounds d
  WHERE f.week_start BETWEEN d.start_date AND d.end_date
  GROUP BY search_term
),

top_terms AS (
  SELECT search_term
  FROM (
    SELECT search_term,
           ROW_NUMBER() OVER (ORDER BY max_vol DESC NULLS LAST) AS rn
    FROM term_volumes
  )
  CROSS JOIN params p
  WHERE rn <= GREATEST(p.limit_top_n * 10, 2000)
),

expanded AS (
  SELECT f.*
  FROM base_filtered f
  CROSS JOIN date_bounds d
  INNER JOIN top_terms tt ON f.search_term = tt.search_term
  WHERE f.week_start BETWEEN date_add('week', -12, d.start_date) AND d.end_date
    AND f.year BETWEEN year(date_add('week', -12, d.start_date)) AND year(d.end_date)
),

asin_weekly AS (
  SELECT
    e.company_id,
    MAX(e.company) AS company_name,
    e.marketplace_country_code AS marketplace,
    MAX(e.currency) AS currency,
    e.search_term,
    e.week_start,
    e.asin,
    MAX(e.brand) AS my_brand,
    MAX(e.product_family) AS product_family,
    MAX(e.revenue_abcd_class) AS revenue_abcd_class,
    MAX(e.pareto_abc_class) AS pareto_abc_class,
    MAX(e.asin_class) AS asin_class,
    MAX(e.rank_1_department) AS category,
    MAX(e.volume) AS search_volume,
    MAX(e.my_click_share) AS my_click_share,
    MAX(e.revenue_share) AS revenue_share,
    MAX(e.rank_1_asin) AS rank_1_asin,
    MAX(e.rank_1_itemname) AS rank_1_itemname,
    MAX(e.rank_1_department) AS rank_1_department,
    MAX(e.rank_1_clickshare) AS rank_1_clickshare,
    MAX(e.rank_1_conversionshare) AS rank_1_conversionshare,
    MAX(e.rank_2_asin) AS rank_2_asin,
    MAX(e.rank_2_itemname) AS rank_2_itemname,
    MAX(e.rank_2_department) AS rank_2_department,
    MAX(e.rank_2_clickshare) AS rank_2_clickshare,
    MAX(e.rank_2_conversionshare) AS rank_2_conversionshare,
    MAX(e.rank_3_asin) AS rank_3_asin,
    MAX(e.rank_3_itemname) AS rank_3_itemname,
    MAX(e.rank_3_department) AS rank_3_department,
    MAX(e.rank_3_clickshare) AS rank_3_clickshare,
    MAX(e.rank_3_conversionshare) AS rank_3_conversionshare,
    MAX(ti.primary_intent_id)    AS primary_intent_id,
    MAX(ti.primary_intent_label) AS primary_intent_label
  FROM expanded e
  LEFT JOIN term_intents ti
    ON ti.company_id = e.company_id
   AND ti.term_norm  = lower(e.search_term)
  GROUP BY
    e.company_id,
    e.marketplace_country_code,
    e.search_term,
    e.week_start,
    e.asin
),

weekly_grouped AS (
  SELECT
    MAX(aw.primary_intent_label) AS primary_intent_label,
    {{group_by_select_clause}},
    aw.week_start AS period_start,
    date_add('day', 6, aw.week_start) AS period_end,
    MAX(aw.currency) AS currency,
    MAX(aw.company_name) AS company_name,
    COUNT(DISTINCT aw.company_id) AS company_count,
    COUNT(DISTINCT aw.marketplace) AS marketplace_count,
    MAX(aw.search_volume) AS search_volume,
    LEAST(1.0, SUM(COALESCE(aw.my_click_share, 0.0))) AS portfolio_click_share,
    SUM(COALESCE(aw.my_click_share, 0.0)) AS portfolio_click_share_uncapped,
    LEAST(1.0, SUM(COALESCE(aw.my_click_share, 0.0))) AS my_click_share,
    AVG(aw.my_click_share) AS avg_asin_click_share,
    MAX(aw.my_click_share) AS max_asin_click_share,
    COUNT(DISTINCT aw.asin) AS asin_count,
    array_join(slice(array_sort(array_distinct(array_agg(CAST(aw.asin AS VARCHAR)))), 1, 25), ',') AS portfolio_asins,
    MAX_BY(aw.asin, COALESCE(aw.my_click_share, -1.0)) AS top_asin_by_click_share,
    SUM(COALESCE(aw.revenue_share, 0.0)) AS total_revenue_share,
    MAX(aw.rank_1_asin) AS rank_1_asin,
    MAX(aw.rank_1_itemname) AS rank_1_itemname,
    MAX(aw.rank_1_department) AS rank_1_department,
    MAX(aw.rank_1_clickshare) AS rank_1_clickshare,
    MAX(aw.rank_1_conversionshare) AS rank_1_conversionshare,
    MAX(aw.rank_2_asin) AS rank_2_asin,
    MAX(aw.rank_2_itemname) AS rank_2_itemname,
    MAX(aw.rank_2_department) AS rank_2_department,
    MAX(aw.rank_2_clickshare) AS rank_2_clickshare,
    MAX(aw.rank_2_conversionshare) AS rank_2_conversionshare,
    MAX(aw.rank_3_asin) AS rank_3_asin,
    MAX(aw.rank_3_itemname) AS rank_3_itemname,
    MAX(aw.rank_3_department) AS rank_3_department,
    MAX(aw.rank_3_clickshare) AS rank_3_clickshare,
    MAX(aw.rank_3_conversionshare) AS rank_3_conversionshare
  FROM asin_weekly aw
  GROUP BY {{group_by_clause}}, aw.week_start
),

with_momentum AS (
  SELECT
    g.*,
    LAG(g.my_click_share, 1) OVER w AS prev_week_share,
    g.my_click_share - LAG(g.my_click_share, 1) OVER w AS wow_delta,
    AVG(g.my_click_share) OVER (
      PARTITION BY {{partition_by_clause}}
      ORDER BY g.period_start
      ROWS BETWEEN 3 PRECEDING AND CURRENT ROW
    ) AS avg_share_l4w,
    AVG(g.my_click_share) OVER (
      PARTITION BY {{partition_by_clause}}
      ORDER BY g.period_start
      ROWS BETWEEN 11 PRECEDING AND CURRENT ROW
    ) AS avg_share_l12w
  FROM weekly_grouped g
  WINDOW w AS (
    PARTITION BY {{partition_by_clause}}
    ORDER BY g.period_start
  )
),

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
  WHERE m.period_start BETWEEN d.start_date AND d.end_date
),

current_rows AS (
  SELECT *
  FROM (
    SELECT w.*,
      ROW_NUMBER() OVER (
        PARTITION BY {{partition_by_clause}}
        ORDER BY w.period_start DESC
      ) AS rn
    FROM windowed w
  )
  WHERE rn = 1
),

enriched AS (
  SELECT
    c.*,
    ROUND(c.wow_delta, 6) AS wow_delta_rounded,
    ROUND(c.avg_share_l4w, 6) AS avg_share_l4w_rounded,
    ROUND(c.avg_share_l12w, 6) AS avg_share_l12w_rounded,
    CASE
      WHEN c.rank_1_conversionshare IS NULL THEN false
      WHEN c.rank_1_conversionshare <= p.weak_leader_max_conversion_share
        AND COALESCE(c.search_volume, 0) >= p.weak_leader_min_search_volume
        THEN true
      ELSE false
    END AS is_weak_leader,
    COALESCE(c.rank_1_conversionshare, 0.0) AS leader_conversion_share,
    CASE
      WHEN c.rank_1_conversionshare IS NULL THEN 0.0
      ELSE GREATEST(0.0, (1.0 - c.rank_1_conversionshare))
           * COALESCE(c.search_volume, 0)
           / 1000.0
    END AS displacement_opportunity_score,
    CASE
      WHEN c.my_click_share IS NOT NULL AND c.rank_1_clickshare IS NOT NULL
        THEN c.rank_1_clickshare - c.my_click_share
      ELSE NULL
    END AS click_share_to_leader
  FROM current_rows c
  CROSS JOIN params p
),

final_rows AS (
  SELECT
    {{final_group_by_select_clause}},
    e.period_start,
    e.period_end,
    e.currency,
    e.primary_intent_label,
    e.company_name,
    e.company_count,
    e.marketplace_count,
    e.search_volume,
    e.portfolio_click_share,
    e.portfolio_click_share_uncapped,
    e.my_click_share,
    e.prev_week_share,
    e.wow_delta_rounded AS wow_delta,
    e.avg_share_l4w_rounded AS avg_share_l4w,
    e.avg_share_l12w_rounded AS avg_share_l12w,
    e.momentum_signal,
    e.avg_asin_click_share,
    e.max_asin_click_share,
    e.asin_count,
    e.portfolio_asins,
    e.top_asin_by_click_share,
    e.total_revenue_share,
    e.rank_1_asin,
    e.rank_1_itemname,
    e.rank_1_department,
    e.rank_1_clickshare,
    e.rank_1_conversionshare,
    e.rank_2_asin,
    e.rank_2_itemname,
    e.rank_2_department,
    e.rank_2_clickshare,
    e.rank_2_conversionshare,
    e.rank_3_asin,
    e.rank_3_itemname,
    e.rank_3_department,
    e.rank_3_clickshare,
    e.rank_3_conversionshare,
    e.is_weak_leader,
    e.leader_conversion_share,
    e.displacement_opportunity_score,
    e.click_share_to_leader
  FROM enriched e
)

SELECT
  ROW_NUMBER() OVER (ORDER BY {{sort_column}} {{sort_direction}} NULLS LAST) AS rank,
  f.*
FROM final_rows f
CROSS JOIN params p
WHERE
  (cardinality(p.momentum_signals) = 0
   OR any_match(p.momentum_signals, s -> lower(s) = lower(f.momentum_signal)))
  AND (p.min_click_share = 0 OR COALESCE(f.my_click_share, 0) >= p.min_click_share)
  AND (p.min_search_volume = 0 OR COALESCE(f.search_volume, 0) >= p.min_search_volume)
ORDER BY {{sort_column}} {{sort_direction}} NULLS LAST
LIMIT {{limit_top_n}};
