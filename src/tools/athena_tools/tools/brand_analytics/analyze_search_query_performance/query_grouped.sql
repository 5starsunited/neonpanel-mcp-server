-- Tool query (GROUPED variant) for search_query_performance_snapshot.
-- Produces weighted aggregations over the chosen group_by dimensions.
-- Skips per-row signals/thresholds — those only make sense at row level.

WITH params AS (
    SELECT
        {{limit_top_n}} AS limit_top_n,
        {{start_date_sql}} AS start_date,
        {{end_date_sql}} AS end_date,
        CAST({{periods_back}} AS INTEGER) AS periods_back,

        {{company_ids_array}} AS company_ids,
        transform({{company_ids_array}}, x -> CAST(x AS VARCHAR)) AS company_ids_str,

        {{marketplaces_array}} AS marketplaces,
        {{search_terms_array}} AS search_terms,
        {{parent_asins_array}} AS parent_asins,
        {{asins_array}} AS asins,
        {{product_families_array}} AS product_families,
        {{row_types_array}} AS row_types,
        CASE
            WHEN cardinality({{revenue_abcd_class_array}}) = 0 THEN ARRAY['A','B']
            ELSE {{revenue_abcd_class_array}}
        END AS revenue_abcd_class,
        {{pareto_abc_class_array}} AS pareto_abc_class
),

{{term_intents_cte_sql}},

raw AS (
    SELECT
        company,
        marketplace,
        marketplace_country_code,
        parent_asin,
        revenue_abcd_class,
        pareto_abc_class,
        brand,
        asin,
        searchquerydata_searchquery,
        searchquerydata_searchqueryscore,
        searchquerydata_searchqueryvolume,
        impressiondata_totalqueryimpressioncount,
        impressiondata_asinimpressioncount,
        clickdata_totalclickcount,
        clickdata_asinclickcount,
        clickdata_asinmedianclickprice_amount,
        cartadddata_totalcartaddcount,
        cartadddata_asincartaddcount,
        purchasedata_totalpurchasecount,
        purchasedata_asinpurchasecount,
        purchasedata_asinmedianpurchaseprice_amount,
        kpi_ctr_advantage,
        company_id,
        week_start,
        year,
        row_type,
        product_family
    FROM "{{catalog}}"."brand_analytics_iceberg"."search_query_performance_snapshot"
),

filtered AS (
    SELECT
        r.*,
        ti.intent_ids,
        ti.primary_intent_id,
        ti.primary_intent_label
    FROM raw r
    CROSS JOIN params p
    LEFT JOIN term_intents ti
        ON CAST(ti.company_id AS VARCHAR) = r.company_id
       AND ti.term_norm  = lower(r.searchquerydata_searchquery)
    WHERE
        contains(p.company_ids_str, r.company_id)
        AND (cardinality(p.search_terms) = 0 OR any_match(p.search_terms, t -> lower(t) = lower(r.searchquerydata_searchquery)))
        AND ({{intent_terms_filter_sql}})
        AND (
            cardinality(p.marketplaces) = 0
            OR any_match(
                p.marketplaces,
                m -> lower(m) IN (lower(r.marketplace_country_code), lower(r.marketplace))
            )
        )
        AND (cardinality(p.parent_asins) = 0 OR any_match(p.parent_asins, a -> lower(a) = lower(r.parent_asin)))
        AND (cardinality(p.asins) = 0 OR any_match(p.asins, a -> lower(a) = lower(r.asin)))
        AND (cardinality(p.product_families) = 0 OR any_match(p.product_families, f -> lower(f) = lower(r.product_family)))
        AND (cardinality(p.row_types) = 0 OR any_match(p.row_types, rt -> lower(rt) = lower(r.row_type)))
        AND (cardinality(p.revenue_abcd_class) = 0 OR any_match(p.revenue_abcd_class, c -> upper(c) = upper(r.revenue_abcd_class)))
        AND (cardinality(p.pareto_abc_class) = 0 OR any_match(p.pareto_abc_class, c -> upper(c) = upper(r.pareto_abc_class)))
),

latest AS (
    SELECT max(week_start) AS latest_week
    FROM filtered
),

date_bounds AS (
    SELECT
        COALESCE(p.start_date, date_add('week', -1 * (p.periods_back - 1), l.latest_week)) AS start_date,
        COALESCE(p.end_date, l.latest_week) AS end_date
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

aggregated AS (
    SELECT
        {{group_by_select_clause}},

        -- Sample-size counts
        COUNT(*)                                            AS row_count,
        COUNT(DISTINCT w.searchquerydata_searchquery)       AS term_count,
        COUNT(DISTINCT w.asin)                              AS asin_count,
        COUNT(DISTINCT w.week_start)                        AS week_count,
        COUNT(DISTINCT w.company_id)                        AS company_count,
        COUNT(DISTINCT w.marketplace_country_code)          AS marketplace_count,

        -- Totals (market)
        SUM(COALESCE(w.impressiondata_totalqueryimpressioncount, 0)) AS total_impressions,
        SUM(COALESCE(w.clickdata_totalclickcount, 0))                AS total_clicks,
        SUM(COALESCE(w.cartadddata_totalcartaddcount, 0))            AS total_cart_adds,
        SUM(COALESCE(w.purchasedata_totalpurchasecount, 0))          AS total_purchases,
        SUM(COALESCE(w.searchquerydata_searchqueryvolume, 0))        AS total_search_volume,

        -- Brand (your)
        SUM(COALESCE(w.impressiondata_asinimpressioncount, 0)) AS brand_impressions,
        SUM(COALESCE(w.clickdata_asinclickcount, 0))           AS brand_clicks,
        SUM(COALESCE(w.cartadddata_asincartaddcount, 0))       AS brand_cart_adds,
        SUM(COALESCE(w.purchasedata_asinpurchasecount, 0))     AS brand_purchases,

        -- Weighted KPIs — shares (brand vs market)
        SUM(COALESCE(w.impressiondata_asinimpressioncount, 0))
          / NULLIF(SUM(COALESCE(w.impressiondata_totalqueryimpressioncount, 0)), 0) AS impression_share,
        SUM(COALESCE(w.clickdata_asinclickcount, 0))
          / NULLIF(SUM(COALESCE(w.clickdata_totalclickcount, 0)), 0)               AS click_share,
        SUM(COALESCE(w.cartadddata_asincartaddcount, 0))
          / NULLIF(SUM(COALESCE(w.cartadddata_totalcartaddcount, 0)), 0)           AS cart_add_share,
        SUM(COALESCE(w.purchasedata_asinpurchasecount, 0))
          / NULLIF(SUM(COALESCE(w.purchasedata_totalpurchasecount, 0)), 0)         AS purchase_share,

        -- Weighted KPIs — funnel rates (within your brand)
        SUM(COALESCE(w.clickdata_asinclickcount, 0))
          / NULLIF(SUM(COALESCE(w.impressiondata_asinimpressioncount, 0)), 0)      AS click_rate,
        SUM(COALESCE(w.cartadddata_asincartaddcount, 0))
          / NULLIF(SUM(COALESCE(w.clickdata_asinclickcount, 0)), 0)                AS cart_add_rate,
        SUM(COALESCE(w.purchasedata_asinpurchasecount, 0))
          / NULLIF(SUM(COALESCE(w.clickdata_asinclickcount, 0)), 0)                AS purchase_rate,

        -- Weighted CTR advantage (weighted by market impressions)
        SUM(COALESCE(w.kpi_ctr_advantage, 0) * COALESCE(w.impressiondata_totalqueryimpressioncount, 0))
          / NULLIF(SUM(COALESCE(w.impressiondata_totalqueryimpressioncount, 0)), 0) AS ctr_advantage,

        -- Weighted search query score (weighted by search volume)
        SUM(COALESCE(w.searchquerydata_searchqueryscore, 0) * COALESCE(w.searchquerydata_searchqueryvolume, 0))
          / NULLIF(SUM(COALESCE(w.searchquerydata_searchqueryvolume, 0)), 0)       AS search_query_score,

        -- Weighted average prices (weighted by per-row count)
        SUM(COALESCE(w.purchasedata_asinmedianpurchaseprice_amount, 0) * COALESCE(w.purchasedata_asinpurchasecount, 0))
          / NULLIF(SUM(COALESCE(w.purchasedata_asinpurchasecount, 0)), 0)          AS weighted_avg_purchase_price,
        SUM(COALESCE(w.clickdata_asinmedianclickprice_amount, 0) * COALESCE(w.clickdata_asinclickcount, 0))
          / NULLIF(SUM(COALESCE(w.clickdata_asinclickcount, 0)), 0)                AS weighted_avg_click_price
    FROM windowed w
    GROUP BY {{group_by_clause}}
)

SELECT *
FROM aggregated
ORDER BY total_search_volume DESC NULLS LAST
LIMIT {{limit_top_n}};
