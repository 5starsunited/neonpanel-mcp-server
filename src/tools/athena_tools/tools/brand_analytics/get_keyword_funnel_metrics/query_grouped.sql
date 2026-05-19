-- Tool: brand_analytics_get_keyword_funnel_metrics (GROUPED variant)
-- Produces weighted aggregations over the chosen group_by dimensions.
-- Skips WoW trends and per-row metrics — only roll-ups + weighted KPIs.
--
-- Pre-aggregation rationale:
--   • In SQP, `*_total*` columns are at (company × keyword × marketplace × week)
--     grain, repeated per ASIN. We collapse to that grain first (MAX for totals,
--     SUM for brand metrics) so the outer aggregation does not double-count.

WITH params AS (
  SELECT
    {{limit_top_n}}                   AS limit_top_n,
    {{start_date_sql}}                AS start_date,
    {{end_date_sql}}                  AS end_date,
    CAST({{periods_back}} AS INTEGER) AS periods_back,

    {{company_ids_array}}             AS company_ids,
    transform({{company_ids_array}}, x -> CAST(x AS VARCHAR)) AS company_ids_str,

    {{keywords_array}}                AS keywords,
    {{match_type_sql}}                AS match_type,

    {{marketplaces_array}}            AS marketplaces,
    {{asins_array}}                   AS asins,
    {{brands_array}}                  AS brands,
    {{product_families_array}}         AS product_families,
    {{revenue_abcd_class_array}}       AS revenue_abcd_class,
    {{pareto_abc_class_array}}         AS pareto_abc_class,

    CAST({{min_search_frequency_rank}} AS INTEGER) AS min_search_frequency_rank,
    CAST({{min_impressions}} AS INTEGER)           AS min_impressions
),

{{term_intents_cte_sql}},

raw AS (
  SELECT r.*
  FROM "{{catalog}}"."brand_analytics_iceberg"."search_query_performance_snapshot" r
  CROSS JOIN params p
  WHERE
    contains(p.company_ids_str, r.company_id)
    AND (
      cardinality(p.keywords) = 0
      OR (
        CASE p.match_type
          WHEN 'exact' THEN
            any_match(p.keywords, k -> lower(k) = lower(r.searchquerydata_searchquery))
          WHEN 'starts_with' THEN
            any_match(p.keywords, k -> lower(r.searchquerydata_searchquery) LIKE lower(k) || '%')
          ELSE
            any_match(p.keywords, k -> lower(r.searchquerydata_searchquery) LIKE '%' || lower(k) || '%')
        END
      )
    )
    AND ({{intent_terms_filter_sql}})
    AND (
      cardinality(p.marketplaces) = 0
      OR any_match(
        p.marketplaces,
        m -> lower(m) IN (lower(r.marketplace_country_code), lower(r.marketplace))
      )
    )
    AND (cardinality(p.asins) = 0 OR any_match(p.asins, a -> lower(a) = lower(r.asin)))
    AND (cardinality(p.brands) = 0 OR any_match(p.brands, b -> lower(b) = lower(r.brand)))
    AND (cardinality(p.product_families) = 0
         OR any_match(p.product_families, f -> lower(f) = lower(r.product_family)))
    AND (cardinality(p.revenue_abcd_class) = 0
         OR any_match(p.revenue_abcd_class, c -> upper(c) = upper(r.revenue_abcd_class)))
    AND (cardinality(p.pareto_abc_class) = 0
         OR any_match(p.pareto_abc_class, c -> upper(c) = upper(r.pareto_abc_class)))
    AND r.row_type = 'child'
),

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

-- Collapse to (company × keyword × marketplace × week) grain so that
-- total_* (per-keyword) is taken via MAX, while brand_* (per-ASIN) is summed.
kw_period AS (
  SELECT
    w.company_id,
    w.marketplace_country_code,
    w.searchquerydata_searchquery                   AS keyword,
    w.week_start,
    MAX(w.searchquerydata_searchqueryvolume)        AS search_query_volume,
    MAX(w.searchquerydata_searchqueryscore)         AS search_query_score,
    MAX(w.impressiondata_totalqueryimpressioncount) AS total_impressions,
    MAX(w.clickdata_totalclickcount)                AS total_clicks,
    MAX(w.cartadddata_totalcartaddcount)            AS total_cart_adds,
    MAX(w.purchasedata_totalpurchasecount)          AS total_purchases,
    SUM(w.impressiondata_asinimpressioncount)       AS brand_impressions,
    SUM(w.clickdata_asinclickcount)                 AS brand_clicks,
    SUM(w.cartadddata_asincartaddcount)             AS brand_cart_adds,
    SUM(w.purchasedata_asinpurchasecount)           AS brand_purchases
  FROM windowed w
  GROUP BY
    w.company_id,
    w.marketplace_country_code,
    w.searchquerydata_searchquery,
    w.week_start
),

-- Enrich each (keyword × period) row with primary intent.
-- term_intents has one row per (company × term_norm); flatten across companies.
enriched AS (
  SELECT
    k.*,
    ti.primary_intent_id,
    ti.primary_intent_label
  FROM kw_period k
  LEFT JOIN (
    SELECT
      term_norm,
      arbitrary(primary_intent_id)    AS primary_intent_id,
      arbitrary(primary_intent_label) AS primary_intent_label
    FROM term_intents
    GROUP BY term_norm
  ) ti ON ti.term_norm = lower(k.keyword)
  CROSS JOIN params p
  WHERE
    (p.min_search_frequency_rank = 0 OR k.search_query_score <= p.min_search_frequency_rank)
    AND (p.min_impressions = 0 OR COALESCE(k.total_impressions, 0) >= p.min_impressions)
),

aggregated AS (
  SELECT
    {{group_by_select_clause}},
    COUNT(*)                                                          AS row_count,
    COUNT(DISTINCT w.keyword)                                         AS keyword_count,
    COUNT(DISTINCT w.company_id)                                      AS company_count,
    COUNT(DISTINCT w.marketplace_country_code)                        AS marketplace_count,
    COUNT(DISTINCT w.week_start)                                      AS week_count,

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
    SUM(w.brand_impressions) * 1.0 / NULLIF(SUM(w.total_impressions), 0) AS brand_impression_share,
    SUM(w.brand_clicks)      * 1.0 / NULLIF(SUM(w.total_clicks), 0)      AS brand_click_share,
    SUM(w.brand_cart_adds)   * 1.0 / NULLIF(SUM(w.total_cart_adds), 0)   AS brand_cart_add_share,
    SUM(w.brand_purchases)   * 1.0 / NULLIF(SUM(w.total_purchases), 0)   AS brand_purchase_share,

    -- Market-level funnel rates (weighted)
    SUM(w.total_clicks)     * 1.0 / NULLIF(SUM(w.total_impressions), 0) AS market_impression_to_click_rate,
    SUM(w.total_cart_adds)  * 1.0 / NULLIF(SUM(w.total_clicks), 0)      AS market_click_to_cart_rate,
    SUM(w.total_purchases)  * 1.0 / NULLIF(SUM(w.total_cart_adds), 0)   AS market_cart_to_purchase_rate,
    SUM(w.total_purchases)  * 1.0 / NULLIF(SUM(w.total_impressions), 0) AS market_impression_to_purchase_rate,

    -- Brand-level funnel rates (weighted)
    SUM(w.brand_clicks)     * 1.0 / NULLIF(SUM(w.brand_impressions), 0) AS brand_impression_to_click_rate,
    SUM(w.brand_cart_adds)  * 1.0 / NULLIF(SUM(w.brand_clicks), 0)      AS brand_click_to_cart_rate,
    SUM(w.brand_purchases)  * 1.0 / NULLIF(SUM(w.brand_cart_adds), 0)   AS brand_cart_to_purchase_rate,
    SUM(w.brand_purchases)  * 1.0 / NULLIF(SUM(w.brand_impressions), 0) AS brand_impression_to_purchase_rate,

    -- Volume-weighted score
    SUM(w.search_query_score * w.search_query_volume) * 1.0
      / NULLIF(SUM(w.search_query_volume), 0)                         AS weighted_search_query_score
  FROM enriched w
  GROUP BY {{group_by_clause}}
)

SELECT *
FROM aggregated
ORDER BY total_search_volume DESC NULLS LAST
LIMIT {{limit_top_n}};
