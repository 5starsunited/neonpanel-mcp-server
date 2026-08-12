-- Tool: brand_analytics_get_keyword_funnel_metrics (GROUPED variant)
-- Produces weighted aggregations over the chosen group_by dimensions.
-- Skips WoW trends and per-row metrics — only roll-ups + weighted KPIs.
--
-- Pre-aggregation rationale:
--   • In SQP, `*_total*` columns are at (company × keyword × marketplace × week)
--     grain, repeated per ASIN. We collapse to that grain first (MAX for totals,
--     SUM for brand metrics) so the outer aggregation does not double-count.

WITH {{asin_class_cte_sql}},

{{term_intents_cte_sql}},

raw AS (
  SELECT
    sqp.company_id AS company_id,
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
  {{asin_class_join_sql}}
  LEFT JOIN etl.ba_marketplaces AS marketplace
    ON sqp.marketplace_id = marketplace.marketplace_id
  WHERE
    has({{company_ids_array}}, sqp.company_id)
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
    AND (
      length({{marketplaces_array}}) = 0
      OR arrayExists(
           m -> lower(m) IN (lower(ifNull(marketplace.country_code, '')), lower(ifNull(marketplace.marketplace_name, ''))),
           {{marketplaces_array}}
         )
    )
    AND (length({{asins_array}}) = 0 OR arrayExists(a -> lower(a) = lower(sqp.asin), {{asins_array}}))
    AND (length({{brands_array}}) = 0 OR arrayExists(b -> lower(b) = lower(ifNull(sqp.brand, '')), {{brands_array}}))
    AND (length({{product_families_array}}) = 0
         OR arrayExists(f -> lower(f) = lower(ifNull(sqp.product_family, '')), {{product_families_array}}))
    AND (length({{revenue_abcd_class_array}}) = 0
         OR arrayExists(c -> upper(c) = upper(ifNull(cls.revenue_abcd_class, '')), {{revenue_abcd_class_array}}))
    AND (length({{pareto_abc_class_array}}) = 0
         OR arrayExists(c -> upper(c) = upper(ifNull(cls.pareto_abc_class, '')), {{pareto_abc_class_array}}))
),

date_bounds AS (
  SELECT
    ifNull({{start_date_sql}}, addWeeks(max(week_start), -1 * ({{periods_back}} - 1))) AS start_date,
    ifNull({{end_date_sql}}, max(week_start)) AS end_date
  FROM raw
),

windowed AS (
  SELECT *
  FROM raw
  WHERE week_start >= (SELECT start_date FROM date_bounds)
    AND week_start <= (SELECT end_date FROM date_bounds)
),

-- Collapse to (company × keyword × marketplace × week) grain so that
-- total_* (per-keyword) is taken via MAX, while brand_* (per-ASIN) is summed.
kw_period AS (
  SELECT
    w.company_id                        AS company_id,
    w.marketplace                       AS marketplace_country_code,
    w.search_query                      AS keyword,
    w.week_start                        AS week_start,
    MAX(w.search_query_volume)          AS search_query_volume,
    MAX(w.search_query_score)           AS search_query_score,
    MAX(w.total_query_impression_count) AS total_impressions,
    MAX(w.total_click_count)            AS total_clicks,
    MAX(w.total_cart_add_count)         AS total_cart_adds,
    MAX(w.total_purchase_count)         AS total_purchases,
    SUM(w.asin_impression_count)        AS brand_impressions,
    SUM(w.asin_click_count)             AS brand_clicks,
    SUM(w.asin_cart_add_count)          AS brand_cart_adds,
    SUM(w.asin_purchase_count)          AS brand_purchases
  FROM windowed w
  GROUP BY
    w.company_id,
    w.marketplace,
    w.search_query,
    w.week_start
),

-- Enrich each (keyword × period) row with primary intent.
-- term_intents has one row per (company × term_norm); flatten across companies.
enriched AS (
  SELECT
    k.*,
    ti.primary_intent_id AS primary_intent_id,
    ti.primary_intent_label AS primary_intent_label
  FROM kw_period k
  LEFT JOIN (
    SELECT
      term_norm AS term_norm,
      any(primary_intent_id)    AS primary_intent_id,
      any(primary_intent_label) AS primary_intent_label
    FROM term_intents
    GROUP BY term_norm
  ) AS ti ON ti.term_norm = lower(k.keyword)
  WHERE
    ({{min_search_frequency_rank}} = 0 OR k.search_query_score <= {{min_search_frequency_rank}})
    AND ({{min_impressions}} = 0 OR COALESCE(k.total_impressions, 0) >= {{min_impressions}})
),

aggregated AS (
  SELECT
    {{group_by_select_clause}},
    COUNT(*)                                                          AS row_count,
    uniqExact(w.keyword)                                              AS keyword_count,
    uniqExact(w.company_id)                                           AS company_count,
    uniqExact(w.marketplace_country_code)                             AS marketplace_count,
    uniqExact(w.week_start)                                           AS week_count,

    SUM(w.search_query_volume)                                        AS total_search_volume,
    SUM(w.total_impressions)                                          AS total_impressions,
    SUM(w.total_clicks)                                               AS total_clicks,
    SUM(w.total_cart_adds)                                            AS total_cart_adds,
    SUM(w.total_purchases)                                            AS total_purchases,
    SUM(w.brand_impressions)                                          AS brand_impressions,
    SUM(w.brand_clicks)                                               AS brand_clicks,
    SUM(w.brand_cart_adds)                                            AS brand_cart_adds,
    SUM(w.brand_purchases)                                            AS brand_purchases,

    -- Weighted brand shares (SUM(brand) / SUM(total))
    SUM(w.brand_impressions) * 1.0 / nullIf(SUM(w.total_impressions), 0) AS brand_impression_share,
    SUM(w.brand_clicks)      * 1.0 / nullIf(SUM(w.total_clicks), 0)      AS brand_click_share,
    SUM(w.brand_cart_adds)   * 1.0 / nullIf(SUM(w.total_cart_adds), 0)   AS brand_cart_add_share,
    SUM(w.brand_purchases)   * 1.0 / nullIf(SUM(w.total_purchases), 0)   AS brand_purchase_share,

    -- Market-level funnel rates (weighted)
    SUM(w.total_clicks)     * 1.0 / nullIf(SUM(w.total_impressions), 0) AS market_impression_to_click_rate,
    SUM(w.total_cart_adds)  * 1.0 / nullIf(SUM(w.total_clicks), 0)      AS market_click_to_cart_rate,
    SUM(w.total_purchases)  * 1.0 / nullIf(SUM(w.total_cart_adds), 0)   AS market_cart_to_purchase_rate,
    SUM(w.total_purchases)  * 1.0 / nullIf(SUM(w.total_impressions), 0) AS market_impression_to_purchase_rate,

    -- Brand-level funnel rates (weighted)
    SUM(w.brand_clicks)     * 1.0 / nullIf(SUM(w.brand_impressions), 0) AS brand_impression_to_click_rate,
    SUM(w.brand_cart_adds)  * 1.0 / nullIf(SUM(w.brand_clicks), 0)      AS brand_click_to_cart_rate,
    SUM(w.brand_purchases)  * 1.0 / nullIf(SUM(w.brand_cart_adds), 0)   AS brand_cart_to_purchase_rate,
    SUM(w.brand_purchases)  * 1.0 / nullIf(SUM(w.brand_impressions), 0) AS brand_impression_to_purchase_rate,

    -- Volume-weighted score
    SUM(w.search_query_score * w.search_query_volume) * 1.0
      / nullIf(SUM(w.search_query_volume), 0)                         AS weighted_search_query_score
  FROM enriched w
  GROUP BY {{group_by_clause}}
)

SELECT *
FROM aggregated
ORDER BY total_search_volume DESC NULLS LAST
LIMIT {{limit_top_n}};
