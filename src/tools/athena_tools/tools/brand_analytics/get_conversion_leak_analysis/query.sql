-- Tool: brand_analytics_get_conversion_leak_analysis
-- Purpose: ASIN-level funnel diagnostics identifying where potential buyers drop off.
-- Uses SQP snapshot for brand-level metrics and compares to market rates.
-- Applies Chapter 1 diagnostic framework (Scenario A/B/C/D) at the ASIN level.

WITH params AS (
    SELECT
        {{limit_top_n}}                   AS limit_top_n,
        {{start_date_sql}}                AS start_date,
        {{end_date_sql}}                  AS end_date,
        CAST({{periods_back}} AS INTEGER) AS periods_back,

        -- REQUIRED
        {{company_ids_array}}             AS company_ids,
        transform({{company_ids_array}}, x -> CAST(x AS VARCHAR)) AS company_ids_str,

        -- Filters
        {{marketplaces_array}}            AS marketplaces,
        {{asins_array}}                   AS asins,
        {{parent_asins_array}}            AS parent_asins,
        {{brands_array}}                  AS brands,
        {{revenue_abcd_class_array}}      AS revenue_abcd_class,
        {{pareto_abc_class_array}}        AS pareto_abc_class,

        -- Leak thresholds
        CAST({{impression_to_click_min}} AS DOUBLE) AS impression_to_click_min,
        CAST({{click_to_cart_min}} AS DOUBLE)       AS click_to_cart_min,
        CAST({{cart_to_purchase_min}} AS DOUBLE)    AS cart_to_purchase_min
),

raw AS (
    SELECT r.*
    FROM "{{catalog}}"."brand_analytics_iceberg"."search_query_performance_snapshot" r
    CROSS JOIN params p
    WHERE
        contains(p.company_ids_str, r.company_id)
        AND r.row_type = 'child'
        AND (
            cardinality(p.marketplaces) = 0
            OR any_match(p.marketplaces, m -> lower(m) IN (lower(r.marketplace_country_code), lower(r.marketplace)))
        )
        AND (cardinality(p.asins) = 0 OR any_match(p.asins, a -> lower(a) = lower(r.asin)))
        AND (cardinality(p.parent_asins) = 0 OR any_match(p.parent_asins, a -> lower(a) = lower(r.parent_asin)))
        AND (cardinality(p.brands) = 0 OR any_match(p.brands, b -> lower(b) = lower(r.brand)))
        AND (cardinality(p.revenue_abcd_class) = 0 OR any_match(p.revenue_abcd_class, c -> upper(c) = upper(r.revenue_abcd_class)))
        AND (cardinality(p.pareto_abc_class) = 0 OR any_match(p.pareto_abc_class, c -> upper(c) = upper(r.pareto_abc_class)))
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

filtered AS (
    SELECT r.*
    FROM raw r
    CROSS JOIN date_bounds d
    WHERE r.week_start BETWEEN d.start_date AND d.end_date
      AND r.year BETWEEN year(d.start_date) AND year(d.end_date)
),

-- Aggregate to ASIN level across all search terms within the time window
asin_agg AS (
    SELECT
        f.asin,
        f.parent_asin,
        MAX(f.title) AS title,
        MAX(f.brand) AS brand,
        f.marketplace_country_code AS marketplace,
        MAX(f.revenue_abcd_class) AS revenue_abcd_class,
        MAX(f.pareto_abc_class) AS pareto_abc_class,
        MAX(f.product_family) AS product_family,
        MIN(f.week_start) AS period_start,
        MAX(f.week_start) AS period_end,

        -- Brand funnel totals (sum across all search terms)
        SUM(f.impressiondata_asinimpressioncount) AS brand_impressions,
        SUM(f.clickdata_asinclickcount) AS brand_clicks,
        SUM(f.cartadddata_asincartaddcount) AS brand_cart_adds,
        SUM(f.purchasedata_asinpurchasecount) AS brand_purchases,

        -- Market funnel totals (use MAX per search term per week, then sum)
        -- This avoids double-counting market totals across ASINs
        COUNT(DISTINCT f.searchquerydata_searchquery) AS keyword_count,

        -- Weighted brand shares
        CASE WHEN SUM(f.impressiondata_totalqueryimpressioncount) > 0
            THEN SUM(f.impressiondata_asinimpressioncount) * 1.0 / SUM(f.impressiondata_totalqueryimpressioncount)
            ELSE NULL END AS avg_impression_share,
        CASE WHEN SUM(f.clickdata_totalclickcount) > 0
            THEN SUM(f.clickdata_asinclickcount) * 1.0 / SUM(f.clickdata_totalclickcount)
            ELSE NULL END AS avg_click_share,
        CASE WHEN SUM(f.cartadddata_totalcartaddcount) > 0
            THEN SUM(f.cartadddata_asincartaddcount) * 1.0 / SUM(f.cartadddata_totalcartaddcount)
            ELSE NULL END AS avg_cart_add_share,
        CASE WHEN SUM(f.purchasedata_totalpurchasecount) > 0
            THEN SUM(f.purchasedata_asinpurchasecount) * 1.0 / SUM(f.purchasedata_totalpurchasecount)
            ELSE NULL END AS avg_purchase_share,

        -- Market-level funnel rates (for category benchmark)
        CASE WHEN SUM(f.impressiondata_totalqueryimpressioncount) > 0
            THEN SUM(f.clickdata_totalclickcount) * 1.0 / SUM(f.impressiondata_totalqueryimpressioncount)
            ELSE NULL END AS market_impression_to_click_rate,
        CASE WHEN SUM(f.clickdata_totalclickcount) > 0
            THEN SUM(f.cartadddata_totalcartaddcount) * 1.0 / SUM(f.clickdata_totalclickcount)
            ELSE NULL END AS market_click_to_cart_rate,
        CASE WHEN SUM(f.cartadddata_totalcartaddcount) > 0
            THEN SUM(f.purchasedata_totalpurchasecount) * 1.0 / SUM(f.cartadddata_totalcartaddcount)
            ELSE NULL END AS market_cart_to_purchase_rate

    FROM filtered f
    GROUP BY f.asin, f.parent_asin, f.marketplace_country_code
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
            WHEN (a.brand_clicks * 1.0 / a.brand_impressions) < p.impression_to_click_min THEN 'leak'
            ELSE 'ok'
        END AS impression_to_click_status,
        CASE
            WHEN a.brand_clicks = 0 THEN NULL
            WHEN (a.brand_cart_adds * 1.0 / a.brand_clicks) < p.click_to_cart_min THEN 'leak'
            ELSE 'ok'
        END AS click_to_cart_status,
        CASE
            WHEN a.brand_cart_adds = 0 THEN NULL
            WHEN (a.brand_purchases * 1.0 / a.brand_cart_adds) < p.cart_to_purchase_min THEN 'leak'
            ELSE 'ok'
        END AS cart_to_purchase_status,

        -- Leak severity scores (how far below threshold, 0-1 scale)
        CASE
            WHEN a.brand_impressions = 0 THEN 0
            WHEN (a.brand_clicks * 1.0 / a.brand_impressions) >= p.impression_to_click_min THEN 0
            ELSE ROUND((p.impression_to_click_min - (a.brand_clicks * 1.0 / a.brand_impressions)) / NULLIF(p.impression_to_click_min, 0), 3)
        END AS impression_to_click_severity,
        CASE
            WHEN a.brand_clicks = 0 THEN 0
            WHEN (a.brand_cart_adds * 1.0 / a.brand_clicks) >= p.click_to_cart_min THEN 0
            ELSE ROUND((p.click_to_cart_min - (a.brand_cart_adds * 1.0 / a.brand_clicks)) / NULLIF(p.click_to_cart_min, 0), 3)
        END AS click_to_cart_severity,
        CASE
            WHEN a.brand_cart_adds = 0 THEN 0
            WHEN (a.brand_purchases * 1.0 / a.brand_cart_adds) >= p.cart_to_purchase_min THEN 0
            ELSE ROUND((p.cart_to_purchase_min - (a.brand_purchases * 1.0 / a.brand_cart_adds)) / NULLIF(p.cart_to_purchase_min, 0), 3)
        END AS cart_to_purchase_severity,

        -- Lost volume at each stage
        CASE
            WHEN a.brand_impressions = 0 OR (a.brand_clicks * 1.0 / a.brand_impressions) >= p.impression_to_click_min THEN 0
            ELSE CAST(ROUND(a.brand_impressions * p.impression_to_click_min - a.brand_clicks) AS BIGINT)
        END AS impression_to_click_lost_volume,
        CASE
            WHEN a.brand_clicks = 0 OR (a.brand_cart_adds * 1.0 / a.brand_clicks) >= p.click_to_cart_min THEN 0
            ELSE CAST(ROUND(a.brand_clicks * p.click_to_cart_min - a.brand_cart_adds) AS BIGINT)
        END AS click_to_cart_lost_volume,
        CASE
            WHEN a.brand_cart_adds = 0 OR (a.brand_purchases * 1.0 / a.brand_cart_adds) >= p.cart_to_purchase_min THEN 0
            ELSE CAST(ROUND(a.brand_cart_adds * p.cart_to_purchase_min - a.brand_purchases) AS BIGINT)
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
                THEN 'Scenario A — Low Visibility: Avg impression share is ' || CAST(ROUND(a.avg_impression_share * 100, 1) AS VARCHAR) || '%. This ASIN is barely appearing in search. Fix advertising/SEO before optimizing the listing.'
            WHEN a.avg_impression_share > 0 AND a.avg_click_share / a.avg_impression_share < 0.6
                THEN 'Scenario B — Visual Competition: ASIN appears in search but loses the click. Click-through efficiency=' || CAST(ROUND(a.avg_click_share / a.avg_impression_share, 2) AS VARCHAR) || '. Improve main image, title, review count, or price positioning.'
            WHEN a.avg_click_share > 0 AND a.avg_purchase_share / a.avg_click_share < 0.6
                THEN 'Scenario C — Listing Conversion: ASIN wins clicks but fails to convert. Conversion efficiency=' || CAST(ROUND(a.avg_purchase_share / a.avg_click_share, 2) AS VARCHAR) || '. Fix detail page: secondary images, bullets, A+ content, reviews, pricing.'
            ELSE 'Scenario D — Protect & Scale: Funnel is healthy. Defend position and scale. Monitor for share erosion.'
        END AS diagnostic_scenario_description,

        -- Diagnostic hints per leak stage
        CASE WHEN a.brand_impressions > 0 AND (a.brand_clicks * 1.0 / a.brand_impressions) < p.impression_to_click_min
            THEN 'Impression-to-click leak: Main image may be weak vs competitors, title not communicating value in first 80 chars, star rating or review count below competitive set, or price appears high in search results.'
            ELSE NULL
        END AS impression_to_click_hint,
        CASE WHEN a.brand_clicks > 0 AND (a.brand_cart_adds * 1.0 / a.brand_clicks) < p.click_to_cart_min
            THEN 'Click-to-cart leak: Detail page not converting browsers. Check secondary images (sizing, lifestyle, comparison), bullet points (address top objections from 3-star reviews), A+ content quality, and price competitiveness on the detail page.'
            ELSE NULL
        END AS click_to_cart_hint,
        CASE WHEN a.brand_cart_adds > 0 AND (a.brand_purchases * 1.0 / a.brand_cart_adds) < p.cart_to_purchase_min
            THEN 'Cart-to-purchase leak: Shoppers add to cart but abandon. Check Buy Box consistency, shipping speed/cost, coupon availability, and whether competitors are undercutting at checkout. Also check for Subscribe & Save availability.'
            ELSE NULL
        END AS cart_to_purchase_hint

    FROM asin_agg a
    CROSS JOIN params p
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
