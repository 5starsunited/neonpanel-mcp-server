-- Tool: brand_analytics_get_competitive_landscape (GROUPED variant)
-- Purpose: Phase C portfolio rollup across search_term / marketplace / category / intent.
-- Output shape: aggregations[] (one row per group bucket) — used when query.aggregation.group_by is non-empty.
-- Notes:
--   - Volume weighting uses 1/(1+search_frequency_rank) so popular keywords dominate.
--   - my_term_coverage_rate = distinct terms where any my_asin appears / distinct terms in bucket.

WITH params AS (
  SELECT
    {{limit_top_n}} AS top_results,
    {{periodicity_sql}} AS periodicity,
    CAST({{periods_back}} AS INTEGER) AS periods_back,
    {{start_date_sql}} AS start_date,
    {{end_date_sql}} AS end_date,
    {{company_ids_array}} AS company_ids,
    {{search_terms_array}} AS search_terms,
    {{competitor_asins_array}} AS competitor_asins,
    {{my_asins_array}} AS my_asins,
    {{marketplaces_array}} AS marketplaces,
    {{categories_array}} AS categories
),

{{term_intents_cte_sql}},

raw AS (
  SELECT
    CAST(date AS DATE) AS report_date,
    searchterm,
    searchfrequencyrank,
    clickedasin,
    clickeditemname,
    clickshare,
    conversionshare,
    departmentname,
    rspec_marketplaceids AS marketplace_ids,
    CAST(ingest_company_id AS BIGINT) AS company_id
  FROM "{{catalog}}"."sp_api_iceberg"."brand_analytics_search_terms_report"
),

marketplaces_dim AS (
  SELECT
    CAST(amazon_marketplace_id AS VARCHAR) AS amazon_marketplace_id,
    lower(country) AS country,
    lower(code) AS country_code,
    lower(name) AS marketplace,
    lower(domain) AS domain
  FROM "{{catalog}}"."neonpanel_iceberg"."amazon_marketplaces"
),

filtered AS (
  SELECT
    r.report_date,
    r.searchterm,
    r.searchfrequencyrank,
    r.clickedasin,
    r.clickshare,
    r.conversionshare,
    lower(r.departmentname) AS category,
    r.company_id,
    COALESCE(m.country_code, lower(t.marketplace_id)) AS marketplace
  FROM raw r
  CROSS JOIN params p
  CROSS JOIN UNNEST(r.marketplace_ids) AS t(marketplace_id)
  LEFT JOIN marketplaces_dim m
    ON lower(m.amazon_marketplace_id) = lower(t.marketplace_id)
  WHERE
    contains(p.company_ids, r.company_id)
    AND (
      cardinality(p.marketplaces) = 0
      OR any_match(
        p.marketplaces,
        input -> lower(input) IN (
          m.country,
          m.country_code,
          m.marketplace,
          m.domain,
          lower(t.marketplace_id)
        )
      )
    )
    AND (cardinality(p.categories) = 0 OR any_match(p.categories, c -> lower(c) = lower(r.departmentname)))
    AND (cardinality(p.search_terms) = 0 OR any_match(p.search_terms, st -> lower(st) = lower(r.searchterm)))
    AND ({{intent_terms_filter_sql}})
    AND (
      (cardinality(p.my_asins) = 0 AND cardinality(p.competitor_asins) = 0)
      OR any_match(p.my_asins, a -> lower(a) = lower(r.clickedasin))
      OR any_match(p.competitor_asins, a -> lower(a) = lower(r.clickedasin))
    )
),

latest AS (SELECT max(report_date) AS latest_date FROM filtered),

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

-- Flatten intents across companies on term_norm (mirrors pattern in main query).
term_intents_flat AS (
  SELECT
    term_norm,
    arbitrary(primary_intent_id)    AS primary_intent_id,
    arbitrary(primary_intent_label) AS primary_intent_label
  FROM term_intents
  GROUP BY term_norm
),

enriched AS (
  SELECT
    w.*,
    COALESCE(ti.primary_intent_id, '__UNCLASSIFIED__') AS primary_intent_id,
    ti.primary_intent_label                            AS primary_intent_label
  FROM windowed w
  LEFT JOIN term_intents_flat ti
    ON ti.term_norm = lower(w.searchterm)
),

aggregated AS (
  SELECT
    {{group_by_select_clause}},
    arbitrary(e.primary_intent_label) AS primary_intent_label,
    COUNT(*) AS row_count,
    COUNT(DISTINCT e.searchterm) AS term_count,
    COUNT(DISTINCT e.clickedasin) AS asin_count,
    COUNT(DISTINCT e.marketplace) AS marketplace_count,
    COUNT(DISTINCT e.period_start) AS period_count,
    SUM(1.0 / (1.0 + CAST(e.searchfrequencyrank AS DOUBLE))) AS volume_score,
    -- Volume-weighted shares (weight = 1/(1+SFR); popular keywords contribute more)
    SUM(COALESCE(e.clickshare, 0.0) * (1.0 / (1.0 + CAST(e.searchfrequencyrank AS DOUBLE))))
      / NULLIF(SUM(1.0 / (1.0 + CAST(e.searchfrequencyrank AS DOUBLE))), 0)
        AS click_share_weighted,
    SUM(COALESCE(e.conversionshare, 0.0) * (1.0 / (1.0 + CAST(e.searchfrequencyrank AS DOUBLE))))
      / NULLIF(SUM(1.0 / (1.0 + CAST(e.searchfrequencyrank AS DOUBLE))), 0)
        AS conversion_share_weighted,
    AVG(COALESCE(e.clickshare, 0.0)) AS click_share_avg,
    AVG(COALESCE(e.conversionshare, 0.0)) AS conversion_share_avg,
    AVG(CAST(e.searchfrequencyrank AS DOUBLE)) AS search_frequency_rank_avg,
    MIN(e.searchfrequencyrank) AS search_frequency_rank_min,
    -- My presence (distinct terms where any my_asin appears in this bucket)
    COUNT(DISTINCT CASE WHEN contains(p.my_asins, e.clickedasin) THEN e.searchterm END) AS my_term_count,
    COUNT(DISTINCT CASE WHEN contains(p.my_asins, e.clickedasin) THEN e.searchterm END) * 1.0
      / NULLIF(COUNT(DISTINCT e.searchterm), 0) AS my_term_coverage_rate,
    -- Competitor presence
    COUNT(DISTINCT CASE WHEN contains(p.competitor_asins, e.clickedasin) THEN e.searchterm END)
      AS competitor_term_count
  FROM enriched e
  CROSS JOIN params p
  GROUP BY {{group_by_clause}}
)

SELECT *
FROM aggregated
ORDER BY volume_score DESC NULLS LAST
LIMIT {{limit_top_n}};
