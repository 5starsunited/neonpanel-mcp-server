-- Tool: brand_analytics_get_competitive_landscape
-- Purpose: Top 3 clicked products per search term (Brand Analytics Search Terms Report).
-- Notes:
-- - company_id filtering is REQUIRED for authorization + partition pruning.
-- - This query uses the Brand Analytics Search Terms Iceberg table.
-- - Time windows are computed from explicit start/end dates or the latest available period.

WITH params AS (
  SELECT
    {{limit_top_n}} AS top_results,
    {{periodicity_sql}} AS periodicity,
    CAST({{periods_back}} AS INTEGER) AS periods_back,
    {{start_date_sql}} AS start_date,
    {{end_date_sql}} AS end_date,

    -- REQUIRED (authorization + partition pruning)
    {{company_ids_array}} AS company_ids,

    -- OPTIONAL filters (empty array => no filter)
    {{search_terms_array}} AS search_terms,
    {{competitor_asins_array}} AS competitor_asins,
    {{my_asins_array}} AS my_asins,
    {{marketplaces_array}} AS marketplaces,
    {{categories_array}} AS categories,

    -- Tool-specific configuration
    CAST({{weak_leader_max_conversion_share}} AS DOUBLE) AS weak_leader_max_conversion_share,
    CAST({{weak_leader_min_search_volume_rank}} AS BIGINT) AS weak_leader_min_search_volume_rank,
    {{weak_leader_require_my_presence}} AS weak_leader_require_my_presence
),

raw AS (
  SELECT
    CAST(date AS DATE) AS report_date,
    searchterm,
    searchfrequencyrank,
    clickedasin,
    clickeditemname,
    clicksharerank,
    clickshare,
    conversionshare,
    departmentname,
    lower(rspec_marketplaceids) AS marketplace,
    CAST(ingest_company_id AS BIGINT) AS company_id
  FROM "{{catalog}}"."sp_api_iceberg"."brand_analytics_search_terms_report"
),

filtered AS (
  SELECT r.*
  FROM raw r
  CROSS JOIN params p
  WHERE
    contains(p.company_ids, r.company_id)
    AND (cardinality(p.marketplaces) = 0 OR any_match(p.marketplaces, m -> lower(m) = r.marketplace))
    AND (cardinality(p.categories) = 0 OR any_match(p.categories, c -> lower(c) = lower(r.departmentname)))
    AND (cardinality(p.search_terms) = 0 OR any_match(p.search_terms, t -> lower(t) = lower(r.searchterm)))
),

latest AS (
  SELECT max(report_date) AS latest_date
  FROM filtered
),

date_bounds AS (
  SELECT
    COALESCE(
      p.start_date,
      date_add(
        p.periodicity,
        -1 * (p.periods_back - 1),
        date_trunc(p.periodicity, l.latest_date)
      )
    ) AS start_date,
    COALESCE(
      p.end_date,
      date_add('day', -1, date_add(p.periodicity, 1, date_trunc(p.periodicity, l.latest_date)))
    ) AS end_date
  FROM params p
  CROSS JOIN latest l
),

windowed AS (
  SELECT
    f.*,
    CASE
      WHEN p.periodicity = 'week' THEN date_trunc('week', f.report_date)
      WHEN p.periodicity = 'month' THEN date_trunc('month', f.report_date)
      ELSE date_trunc('quarter', f.report_date)
    END AS period_start
  FROM filtered f
  CROSS JOIN params p
  CROSS JOIN date_bounds d
  WHERE f.report_date BETWEEN d.start_date AND d.end_date
),

aggregated AS (
  SELECT
    searchterm AS search_term,
    MIN(searchfrequencyrank) AS search_frequency_rank,
    period_start,
    date_add(
      'day',
      -1,
      date_add(
        CASE
          WHEN p.periodicity = 'week' THEN 'week'
          WHEN p.periodicity = 'month' THEN 'month'
          ELSE 'quarter'
        END,
        1,
        period_start
      )
    ) AS period_end,
    clickedasin AS asin,
    MAX(clickeditemname) AS title,
    CAST(NULL AS VARCHAR) AS brand,
    MIN(clicksharerank) AS click_share_rank,
    AVG(COALESCE(clickshare, 0.0)) AS click_share,
    AVG(COALESCE(conversionshare, 0.0)) AS conversion_share
  FROM windowed w
  CROSS JOIN params p
  GROUP BY 1, 3, 5, 7
),

ranked_base AS (
  SELECT
    a.*,
    row_number() OVER (
      PARTITION BY search_term, period_start
      ORDER BY click_share_rank ASC NULLS LAST, click_share DESC
    ) AS position
  FROM aggregated a
),

ranked AS (
  SELECT
    rb.*,
    lag(rb.click_share) OVER (PARTITION BY rb.search_term, rb.asin ORDER BY rb.period_start) AS click_share_prev,
    lag(rb.conversion_share) OVER (PARTITION BY rb.search_term, rb.asin ORDER BY rb.period_start) AS conversion_share_prev,
    lag(rb.position) OVER (PARTITION BY rb.search_term, rb.asin ORDER BY rb.period_start) AS prev_position
  FROM ranked_base rb
),

top3 AS (
  SELECT
    r.*
  FROM ranked r
  WHERE r.position <= 3
),

per_term AS (
  SELECT
    t.search_term,
    t.search_frequency_rank,
    t.period_start,
    t.period_end,
    array_agg(
      CAST(
        ROW(
          t.position,
          t.asin,
          t.title,
          t.brand,
          contains(p.my_asins, t.asin) AS is_mine,
          t.click_share,
          (t.click_share - COALESCE(t.click_share_prev, t.click_share)) AS click_share_trend,
          t.conversion_share,
          (t.conversion_share - COALESCE(t.conversion_share_prev, t.conversion_share)) AS conversion_share_trend,
          CASE
            WHEN t.prev_position IS NULL THEN 0
            ELSE t.prev_position - t.position
          END
        ) AS ROW(
          position INTEGER,
          asin VARCHAR,
          title VARCHAR,
          brand VARCHAR,
          is_mine BOOLEAN,
          click_share DOUBLE,
          click_share_trend DOUBLE,
          conversion_share DOUBLE,
          conversion_share_trend DOUBLE,
          position_change INTEGER
        )
      )
      ORDER BY t.position
    ) AS top_3_products,
    MIN(CASE WHEN contains(p.my_asins, t.asin) THEN t.position END) AS my_position,
    MAX(CASE WHEN t.position = 1 THEN t.conversion_share END) AS leader_conversion_share,
    MAX(CASE WHEN t.position = 1 THEN t.click_share END) AS leader_click_share,
    MAX(CASE WHEN contains(p.my_asins, t.asin) THEN t.click_share END) AS my_click_share,
    MAX(CASE WHEN contains(p.my_asins, t.asin) THEN t.conversion_share END) AS my_conversion_share,
    MAX(CASE WHEN contains(p.competitor_asins, t.asin) THEN 1 ELSE 0 END) AS has_competitor
  FROM top3 t
  CROSS JOIN params p
  GROUP BY 1, 2, 3, 4
)

SELECT
  p.search_term,
  p.search_frequency_rank,
  CAST(p.period_start AS DATE) AS period_start,
  CAST(p.period_end AS DATE) AS period_end,
  p.top_3_products,
  p.my_position,
  CAST(
    ROW(
      CASE
        WHEN p.leader_conversion_share IS NULL THEN false
        WHEN p.leader_conversion_share <= params.weak_leader_max_conversion_share
          AND p.search_frequency_rank <= params.weak_leader_min_search_volume_rank
          AND (NOT params.weak_leader_require_my_presence OR p.my_position IS NOT NULL)
          THEN true
        ELSE false
      END,
      COALESCE(p.leader_conversion_share, 0.0),
      CASE
        WHEN p.leader_conversion_share IS NULL THEN 0.0
        ELSE
          GREATEST(0.0, (1.0 - p.leader_conversion_share))
          * (1.0 / (1.0 + CAST(p.search_frequency_rank AS DOUBLE)))
          * 100000.0
      END,
      CASE
        WHEN p.leader_conversion_share IS NULL THEN 'insufficient_data'
        WHEN p.leader_conversion_share <= params.weak_leader_max_conversion_share THEN 'optimize_listing_to_displace'
        ELSE 'monitor_competitor_strength'
      END
    ) AS ROW(
      is_weak_leader BOOLEAN,
      leader_conversion_share DOUBLE,
      displacement_opportunity_score DOUBLE,
      recommended_action VARCHAR
    )
  ) AS weak_leader_analysis,
  CAST(
    ROW(
      CASE
        WHEN p.my_click_share IS NULL THEN NULL
        ELSE p.leader_click_share - p.my_click_share
      END,
      CASE
        WHEN p.my_conversion_share IS NULL THEN NULL
        ELSE p.leader_conversion_share - p.my_conversion_share
      END,
      CAST(NULL AS BIGINT)
    ) AS ROW(
      click_share_to_leader DOUBLE,
      conversion_share_to_leader DOUBLE,
      estimated_clicks_if_leader BIGINT
    )
  ) AS share_gaps
FROM per_term p
CROSS JOIN params
WHERE
  (cardinality(params.competitor_asins) = 0 OR p.has_competitor = 1)
ORDER BY p.search_frequency_rank ASC
LIMIT params.top_results;
