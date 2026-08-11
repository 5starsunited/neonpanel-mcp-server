-- Tool: brand_analytics_get_conversion_leak_analysis
-- Purpose: ASIN-level funnel diagnostics identifying where potential buyers drop off.
-- Source: etl.ba_search_query_performance (ClickHouse) -- the BA SQP serving view
-- enriched with catalog attributes and rolling-30-day revenue classes (migration 0046).
-- Applies Chapter 1 diagnostic framework (Scenario A/B/C/D) at the ASIN level.
--
-- NOTE on revenue_abcd_class / pareto_abc_class: these are as-of rolling-30-day
-- classes from etl.sku_classification_last30_by_marketplace, not the class that was
-- in effect during a past report week.

WITH raw AS (
    SELECT
        sqp.asin AS asin,
        sqp.parent_asin AS parent_asin,
        sqp.brand AS brand,
        sqp.title AS title,
        sqp.product_family AS product_family,
        sqp.revenue_abcd_class AS revenue_abcd_class,
        sqp.pareto_abc_class AS pareto_abc_class,
        sqp.week_start AS week_start,
        sqp.search_query AS search_query,
        ifNull(marketplace.country_code, '') AS marketplace,
        ifNull(sqp.asin_impression_count, 0) AS asin_impression_count,
        ifNull(sqp.asin_click_count, 0) AS asin_click_count,
        ifNull(sqp.asin_cart_add_count, 0) AS asin_cart_add_count,
        ifNull(sqp.asin_purchase_count, 0) AS asin_purchase_count,
        ifNull(sqp.total_query_impression_count, 0) AS total_query_impression_count,
        ifNull(sqp.total_click_count, 0) AS total_click_count,
        ifNull(sqp.total_cart_add_count, 0) AS total_cart_add_count,
        ifNull(sqp.total_purchase_count, 0) AS total_purchase_count
    FROM etl.ba_search_query_performance AS sqp
    LEFT JOIN etl.ba_marketplaces AS marketplace
        ON sqp.marketplace_id = marketplace.marketplace_id
    WHERE
        has({{company_ids_array}}, sqp.company_id)
        AND (
            length({{marketplaces_array}}) = 0
            OR arrayExists(
                m -> lower(m) IN (lower(ifNull(marketplace.country_code, '')), lower(ifNull(marketplace.marketplace_name, ''))),
                {{marketplaces_array}}
            )
        )
        AND (length({{asins_array}}) = 0 OR arrayExists(a -> lower(a) = lower(sqp.asin), {{asins_array}}))
        AND (length({{parent_asins_array}}) = 0 OR arrayExists(a -> lower(a) = lower(ifNull(sqp.parent_asin, '')), {{parent_asins_array}}))
        AND (length({{brands_array}}) = 0 OR arrayExists(b -> lower(b) = lower(ifNull(sqp.brand, '')), {{brands_array}}))
        AND (length({{revenue_abcd_class_array}}) = 0 OR arrayExists(c -> upper(c) = upper(ifNull(sqp.revenue_abcd_class, '')), {{revenue_abcd_class_array}}))
        AND (length({{pareto_abc_class_array}}) = 0 OR arrayExists(c -> upper(c) = upper(ifNull(sqp.pareto_abc_class, '')), {{pareto_abc_class_array}}))
),

date_bounds AS (
    SELECT
        ifNull({{start_date_sql}}, addWeeks(max(week_start), -1 * ({{periods_back}} - 1))) AS start_date,
        ifNull({{end_date_sql}}, max(week_start)) AS end_date
    FROM raw
),

filtered AS (
    SELECT *
    FROM raw
    WHERE week_start >= (SELECT start_date FROM date_bounds)
      AND week_start <= (SELECT end_date FROM date_bounds)
),

-- Aggregate to ASIN level across all search terms within the time window
asin_agg AS (
    SELECT
        f.asin AS asin,
        f.parent_asin AS parent_asin,
        f.marketplace AS marketplace,
        MAX(f.title) AS title,
        MAX(f.brand) AS brand,
        MAX(f.revenue_abcd_class) AS revenue_abcd_class,
        MAX(f.pareto_abc_class) AS pareto_abc_class,
        MAX(f.product_family) AS product_family,
        MIN(f.week_start) AS period_start,
        MAX(f.week_start) AS period_end,

        -- Brand funnel totals (sum across all search terms)
        SUM(f.asin_impression_count) AS brand_impressions,
        SUM(f.asin_click_count) AS brand_clicks,
        SUM(f.asin_cart_add_count) AS brand_cart_adds,
        SUM(f.asin_purchase_count) AS brand_purchases,

        uniqExact(f.search_query) AS keyword_count,

        -- Weighted brand shares. An ASIN appears at most once per (week, search_query),
        -- so summing the market totals over its own rows visits each query-week exactly
        -- once. This is correct AT ASIN GRAIN ONLY -- summing market totals across ASINs
        -- double counts, which is what etl.ba_search_query_performance_portfolio_weekly
        -- exists to avoid.
        if(SUM(f.total_query_impression_count) > 0,
            SUM(f.asin_impression_count) / SUM(f.total_query_impression_count), NULL) AS avg_impression_share,
        if(SUM(f.total_click_count) > 0,
            SUM(f.asin_click_count) / SUM(f.total_click_count), NULL) AS avg_click_share,
        if(SUM(f.total_cart_add_count) > 0,
            SUM(f.asin_cart_add_count) / SUM(f.total_cart_add_count), NULL) AS avg_cart_add_share,
        if(SUM(f.total_purchase_count) > 0,
            SUM(f.asin_purchase_count) / SUM(f.total_purchase_count), NULL) AS avg_purchase_share,

        -- Market-level funnel rates (for category benchmark)
        if(SUM(f.total_query_impression_count) > 0,
            SUM(f.total_click_count) / SUM(f.total_query_impression_count), NULL) AS market_impression_to_click_rate,
        if(SUM(f.total_click_count) > 0,
            SUM(f.total_cart_add_count) / SUM(f.total_click_count), NULL) AS market_click_to_cart_rate,
        if(SUM(f.total_cart_add_count) > 0,
            SUM(f.total_purchase_count) / SUM(f.total_cart_add_count), NULL) AS market_cart_to_purchase_rate

    FROM filtered f
    GROUP BY f.asin, f.parent_asin, f.marketplace
),

-- Compute funnel rates, leak severity, and diagnostic scenario
with_leaks AS (
    SELECT
        a.*,

        -- Brand funnel rates
        CASE WHEN a.brand_impressions > 0
            THEN a.brand_clicks * 1.0 / a.brand_impressions ELSE NULL END
            AS brand_impression_to_click_rate,
        CASE WHEN a.brand_clicks > 0
            THEN a.brand_cart_adds * 1.0 / a.brand_clicks ELSE NULL END
            AS brand_click_to_cart_rate,
        CASE WHEN a.brand_cart_adds > 0
            THEN a.brand_purchases * 1.0 / a.brand_cart_adds ELSE NULL END
            AS brand_cart_to_purchase_rate,
        CASE WHEN a.brand_impressions > 0
            THEN a.brand_purchases * 1.0 / a.brand_impressions ELSE NULL END
            AS brand_overall_conversion_rate,

        -- Click-through efficiency (BCS ÷ BIS)
        CASE WHEN a.avg_impression_share IS NOT NULL AND a.avg_impression_share > 0
            THEN a.avg_click_share / a.avg_impression_share ELSE NULL END
            AS click_through_efficiency,

        -- Conversion efficiency (BCVS ÷ BCS)
        CASE WHEN a.avg_click_share IS NOT NULL AND a.avg_click_share > 0
            THEN a.avg_purchase_share / a.avg_click_share ELSE NULL END
            AS conversion_efficiency,

        -- Leak detection vs thresholds
        CASE
            WHEN a.brand_impressions = 0 THEN NULL
            WHEN (a.brand_clicks * 1.0 / a.brand_impressions) < {{impression_to_click_min}} THEN 'leak'
            ELSE 'ok'
        END AS impression_to_click_status,
        CASE
            WHEN a.brand_clicks = 0 THEN NULL
            WHEN (a.brand_cart_adds * 1.0 / a.brand_clicks) < {{click_to_cart_min}} THEN 'leak'
            ELSE 'ok'
        END AS click_to_cart_status,
        CASE
            WHEN a.brand_cart_adds = 0 THEN NULL
            WHEN (a.brand_purchases * 1.0 / a.brand_cart_adds) < {{cart_to_purchase_min}} THEN 'leak'
            ELSE 'ok'
        END AS cart_to_purchase_status,

        -- Leak severity scores (how far below threshold, 0-1 scale)
        CASE
            WHEN a.brand_impressions = 0 THEN 0
            WHEN (a.brand_clicks * 1.0 / a.brand_impressions) >= {{impression_to_click_min}} THEN 0
            ELSE ROUND(({{impression_to_click_min}} - (a.brand_clicks * 1.0 / a.brand_impressions)) / nullIf({{impression_to_click_min}}, 0), 3)
        END AS impression_to_click_severity,
        CASE
            WHEN a.brand_clicks = 0 THEN 0
            WHEN (a.brand_cart_adds * 1.0 / a.brand_clicks) >= {{click_to_cart_min}} THEN 0
            ELSE ROUND(({{click_to_cart_min}} - (a.brand_cart_adds * 1.0 / a.brand_clicks)) / nullIf({{click_to_cart_min}}, 0), 3)
        END AS click_to_cart_severity,
        CASE
            WHEN a.brand_cart_adds = 0 THEN 0
            WHEN (a.brand_purchases * 1.0 / a.brand_cart_adds) >= {{cart_to_purchase_min}} THEN 0
            ELSE ROUND(({{cart_to_purchase_min}} - (a.brand_purchases * 1.0 / a.brand_cart_adds)) / nullIf({{cart_to_purchase_min}}, 0), 3)
        END AS cart_to_purchase_severity,

        -- Lost volume at each stage
        CASE
            WHEN a.brand_impressions = 0 OR (a.brand_clicks * 1.0 / a.brand_impressions) >= {{impression_to_click_min}} THEN 0
            ELSE toInt64(ROUND(a.brand_impressions * {{impression_to_click_min}} - a.brand_clicks))
        END AS impression_to_click_lost_volume,
        CASE
            WHEN a.brand_clicks = 0 OR (a.brand_cart_adds * 1.0 / a.brand_clicks) >= {{click_to_cart_min}} THEN 0
            ELSE toInt64(ROUND(a.brand_clicks * {{click_to_cart_min}} - a.brand_cart_adds))
        END AS click_to_cart_lost_volume,
        CASE
            WHEN a.brand_cart_adds = 0 OR (a.brand_purchases * 1.0 / a.brand_cart_adds) >= {{cart_to_purchase_min}} THEN 0
            ELSE toInt64(ROUND(a.brand_cart_adds * {{cart_to_purchase_min}} - a.brand_purchases))
        END AS cart_to_purchase_lost_volume,

        -- Diagnostic scenario (Chapter 1 framework applied at ASIN level)
        CASE
            WHEN a.avg_impression_share IS NULL THEN 'insufficient_data'
            WHEN a.avg_impression_share < 0.05 THEN 'A_visibility'
            WHEN a.avg_impression_share > 0 AND a.avg_click_share / a.avg_impression_share < 0.6 THEN 'B_creative'
            WHEN a.avg_click_share > 0 AND a.avg_purchase_share / a.avg_click_share < 0.6 THEN 'C_conversion'
            ELSE 'D_protect'
        END AS diagnostic_scenario,
        CASE
            WHEN a.avg_impression_share IS NULL
                THEN 'Not enough data to classify.'
            WHEN a.avg_impression_share < 0.05
                THEN 'Scenario A — Low Visibility: Avg impression share is ' || toString(ROUND(a.avg_impression_share * 100, 1)) || '%. This ASIN is barely appearing in search. Fix advertising/SEO before optimizing the listing.'
            WHEN a.avg_impression_share > 0 AND a.avg_click_share / a.avg_impression_share < 0.6
                THEN 'Scenario B — Visual Competition: ASIN appears in search but loses the click. Click-through efficiency=' || toString(ROUND(a.avg_click_share / a.avg_impression_share, 2)) || '. Improve main image, title, review count, or price positioning.'
            WHEN a.avg_click_share > 0 AND a.avg_purchase_share / a.avg_click_share < 0.6
                THEN 'Scenario C — Listing Conversion: ASIN wins clicks but fails to convert. Conversion efficiency=' || toString(ROUND(a.avg_purchase_share / a.avg_click_share, 2)) || '. Fix detail page: secondary images, bullets, A+ content, reviews, pricing.'
            ELSE 'Scenario D — Protect & Scale: Funnel is healthy. Defend position and scale. Monitor for share erosion.'
        END AS diagnostic_scenario_description,

        -- Diagnostic hints per leak stage
        CASE WHEN a.brand_impressions > 0 AND (a.brand_clicks * 1.0 / a.brand_impressions) < {{impression_to_click_min}}
            THEN 'Impression-to-click leak: Main image may be weak vs competitors, title not communicating value in first 80 chars, star rating or review count below competitive set, or price appears high in search results.'
            ELSE NULL
        END AS impression_to_click_hint,
        CASE WHEN a.brand_clicks > 0 AND (a.brand_cart_adds * 1.0 / a.brand_clicks) < {{click_to_cart_min}}
            THEN 'Click-to-cart leak: Detail page not converting browsers. Check secondary images (sizing, lifestyle, comparison), bullet points (address top objections from 3-star reviews), A+ content quality, and price competitiveness on the detail page.'
            ELSE NULL
        END AS click_to_cart_hint,
        CASE WHEN a.brand_cart_adds > 0 AND (a.brand_purchases * 1.0 / a.brand_cart_adds) < {{cart_to_purchase_min}}
            THEN 'Cart-to-purchase leak: Shoppers add to cart but abandon. Check Buy Box consistency, shipping speed/cost, coupon availability, and whether competitors are undercutting at checkout. Also check for Subscribe & Save availability.'
            ELSE NULL
        END AS cart_to_purchase_hint

    FROM asin_agg a
),

final AS (
    SELECT
        w.*,
        -- Composite leak score (0-100, weighted: impression=25%, click=35%, cart=40%)
        ROUND(
            (COALESCE(w.impression_to_click_severity, 0) * 25
             + COALESCE(w.click_to_cart_severity, 0) * 35
             + COALESCE(w.cart_to_purchase_severity, 0) * 40),
            1
        ) AS total_leak_score,
        -- Worst leak stage
        CASE
            WHEN GREATEST(
                COALESCE(w.impression_to_click_severity, 0),
                COALESCE(w.click_to_cart_severity, 0),
                COALESCE(w.cart_to_purchase_severity, 0)
            ) = 0 THEN 'none'
            WHEN COALESCE(w.impression_to_click_severity, 0) >= COALESCE(w.click_to_cart_severity, 0)
                 AND COALESCE(w.impression_to_click_severity, 0) >= COALESCE(w.cart_to_purchase_severity, 0) THEN 'impression_to_click'
            WHEN COALESCE(w.click_to_cart_severity, 0) >= COALESCE(w.cart_to_purchase_severity, 0) THEN 'click_to_cart'
            ELSE 'cart_to_purchase'
        END AS worst_leak_stage
    FROM with_leaks w
)

SELECT *
FROM final
ORDER BY {{sort_column}} {{sort_direction}} NULLS LAST
LIMIT {{limit_top_n}};
