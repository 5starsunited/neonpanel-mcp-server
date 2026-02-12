-- Tool query for search_catalog_performance_snapshot
-- Provides KPI signals (strength/weakness/opportunity/threshold) and trend deltas for catalog-level performance.

WITH params AS (
    SELECT
        {{limit_top_n}} AS limit_top_n,
        {{start_date_sql}} AS start_date,
        {{end_date_sql}} AS end_date,
        CAST({{periods_back}} AS INTEGER) AS periods_back,

        -- REQUIRED (authorization + partition pruning)
        {{company_ids_array}} AS company_ids,

        -- OPTIONAL filters (empty array => no filter)
        {{marketplaces_array}} AS marketplaces,
        {{parent_asins_array}} AS parent_asins,
        {{asins_array}} AS asins,
        {{row_types_array}} AS row_types,
        CASE
            WHEN cardinality({{revenue_abcd_class_array}}) = 0 THEN ARRAY['A','B']
            ELSE {{revenue_abcd_class_array}}
        END AS revenue_abcd_class,
        {{pareto_abc_class_array}} AS pareto_abc_class,
        {{strength_colors_array}} AS strength_colors,
        {{weakness_colors_array}} AS weakness_colors,
        {{opportunity_colors_array}} AS opportunity_colors,
        {{threshold_colors_array}} AS threshold_colors,
        {{click_trend_colors_array}} AS click_trend_colors,
        {{cart_add_trend_colors_array}} AS cart_add_trend_colors,
        {{purchase_trend_colors_array}} AS purchase_trend_colors
),

raw AS (
    SELECT *
    FROM "{{catalog}}"."brand_analytics_iceberg"."search_catalog_performance_snapshot"
),

base_child AS (
    SELECT
        r.company,
        r.marketplace,
        r.marketplace_country_code,
        r.parent_asin,
        r.revenue_abcd_class,
        r.pareto_abc_class,
        r.brand,
        r.revenue_share,
        r.title,
        r.asin,
        r.week_start,
        r.year,
        r.report_date,
        r.startdate,
        r.enddate,
        r.impressiondata_impressioncount,
        r.clickdata_clickcount,
        r.cartadddata_cartaddcount,
        r.purchasedata_purchasecount,
        r.clickdata_clickrate,
        r.purchasedata_conversionrate,
        r.purchasedata_searchtrafficsales_amount,
        r.purchasedata_searchtrafficsales_currencycode,
        r.cartadddata_onedayshippingcartaddcount,
        r.cartadddata_samedayshippingcartaddcount,
        r.cartadddata_twodayshippingcartaddcount,
        r.clickdata_onedayshippingclickcount,
        r.clickdata_samedayshippingclickcount,
        r.clickdata_twodayshippingclickcount,
        r.purchasedata_onedayshippingpurchasecount,
        r.purchasedata_samedayshippingpurchasecount,
        r.purchasedata_twodayshippingpurchasecount,
        r.impressiondata_onedayshippingimpressioncount,
        r.impressiondata_samedayshippingimpressioncount,
        r.impressiondata_twodayshippingimpressioncount,
        r.company_id,
        r.amazon_seller_id,
        r.kpi_click_rate,
        r.kpi_cart_add_rate,
        r.kpi_purchase_rate,
        r.kpi_sales_per_click,
        r.kpi_sales_per_impression,
        'child' AS row_type
    FROM raw r
    CROSS JOIN params p
    WHERE
        contains(p.company_ids, r.company_id)
        AND (
            cardinality(p.marketplaces) = 0
            OR any_match(
                p.marketplaces,
                input -> lower(input) IN (
                    lower(r.marketplace_country_code),
                    lower(r.marketplace)
                )
            )
        )
        AND (cardinality(p.asins) = 0 OR any_match(p.asins, a -> lower(a) = lower(r.asin)))
        AND (cardinality(p.parent_asins) = 0 OR any_match(p.parent_asins, a -> lower(a) = lower(r.parent_asin)))
        AND (cardinality(p.revenue_abcd_class) = 0 OR any_match(p.revenue_abcd_class, c -> upper(c) = upper(r.revenue_abcd_class)))
        AND (cardinality(p.pareto_abc_class) = 0 OR any_match(p.pareto_abc_class, c -> upper(c) = upper(r.pareto_abc_class)))
        AND lower(r.row_type) = 'child'
),

latest AS (
    SELECT max(week_start) AS latest_week
    FROM base_child
),

date_bounds AS (
    SELECT
        COALESCE(
            p.start_date,
            date_add('week', -1 * (p.periods_back - 1), l.latest_week)
        ) AS start_date,
        COALESCE(
            p.end_date,
            l.latest_week
        ) AS end_date
    FROM params p
    CROSS JOIN latest l
),

window_bounds AS (
    SELECT
        start_date,
        end_date,
        date_add('week', -12, start_date) AS lookback_start
    FROM date_bounds
),

windowed AS (
    SELECT b.*
    FROM base_child b
    CROSS JOIN window_bounds d
    WHERE b.week_start BETWEEN d.lookback_start AND d.end_date
      AND b.year BETWEEN year(d.lookback_start) AND year(d.end_date)
),

parent_agg AS (
    SELECT
        company,
        marketplace,
        marketplace_country_code,
        parent_asin,
        MAX(revenue_abcd_class) AS revenue_abcd_class,
        MAX(pareto_abc_class) AS pareto_abc_class,
        MAX(brand) AS brand,
        SUM(revenue_share) AS revenue_share,
        CAST(NULL AS VARCHAR) AS title,
        parent_asin AS asin,
        week_start,
        year,
        MAX(report_date) AS report_date,
        MAX(startdate) AS startdate,
        MAX(enddate) AS enddate,
        SUM(impressiondata_impressioncount) AS impressiondata_impressioncount,
        SUM(clickdata_clickcount) AS clickdata_clickcount,
        SUM(cartadddata_cartaddcount) AS cartadddata_cartaddcount,
        SUM(purchasedata_purchasecount) AS purchasedata_purchasecount,
        CASE
            WHEN SUM(impressiondata_impressioncount) = 0 THEN NULL
            ELSE SUM(clickdata_clickcount) / SUM(impressiondata_impressioncount)
        END AS clickdata_clickrate,
        CASE
            WHEN SUM(clickdata_clickcount) = 0 THEN NULL
            ELSE SUM(purchasedata_purchasecount) / SUM(clickdata_clickcount)
        END AS purchasedata_conversionrate,
        SUM(purchasedata_searchtrafficsales_amount) AS purchasedata_searchtrafficsales_amount,
        MAX(purchasedata_searchtrafficsales_currencycode) AS purchasedata_searchtrafficsales_currencycode,
        SUM(cartadddata_onedayshippingcartaddcount) AS cartadddata_onedayshippingcartaddcount,
        SUM(cartadddata_samedayshippingcartaddcount) AS cartadddata_samedayshippingcartaddcount,
        SUM(cartadddata_twodayshippingcartaddcount) AS cartadddata_twodayshippingcartaddcount,
        SUM(clickdata_onedayshippingclickcount) AS clickdata_onedayshippingclickcount,
        SUM(clickdata_samedayshippingclickcount) AS clickdata_samedayshippingclickcount,
        SUM(clickdata_twodayshippingclickcount) AS clickdata_twodayshippingclickcount,
        SUM(purchasedata_onedayshippingpurchasecount) AS purchasedata_onedayshippingpurchasecount,
        SUM(purchasedata_samedayshippingpurchasecount) AS purchasedata_samedayshippingpurchasecount,
        SUM(purchasedata_twodayshippingpurchasecount) AS purchasedata_twodayshippingpurchasecount,
        SUM(impressiondata_onedayshippingimpressioncount) AS impressiondata_onedayshippingimpressioncount,
        SUM(impressiondata_samedayshippingimpressioncount) AS impressiondata_samedayshippingimpressioncount,
        SUM(impressiondata_twodayshippingimpressioncount) AS impressiondata_twodayshippingimpressioncount,
        MAX(company_id) AS company_id,
        MAX(amazon_seller_id) AS amazon_seller_id,
        -- KPI base calculations
        CASE
            WHEN SUM(impressiondata_impressioncount) = 0 THEN NULL
            ELSE SUM(clickdata_clickcount) / SUM(impressiondata_impressioncount)
        END AS kpi_click_rate,
        CASE
            WHEN SUM(impressiondata_impressioncount) = 0 THEN NULL
            ELSE SUM(cartadddata_cartaddcount) / SUM(impressiondata_impressioncount)
        END AS kpi_cart_add_rate,
        CASE
            WHEN SUM(clickdata_clickcount) = 0 THEN NULL
            ELSE SUM(purchasedata_purchasecount) / SUM(clickdata_clickcount)
        END AS kpi_purchase_rate,
        CASE
            WHEN SUM(clickdata_clickcount) = 0 THEN NULL
            ELSE SUM(purchasedata_searchtrafficsales_amount) / SUM(clickdata_clickcount)
        END AS kpi_sales_per_click,
        CASE
            WHEN SUM(impressiondata_impressioncount) = 0 THEN NULL
            ELSE SUM(purchasedata_searchtrafficsales_amount) / SUM(impressiondata_impressioncount)
        END AS kpi_sales_per_impression,
        'parent' AS row_type
    FROM windowed
    GROUP BY
        company,
        marketplace,
        marketplace_country_code,
        parent_asin,
        week_start,
        year
),

final_base AS (
    SELECT * FROM windowed
    UNION ALL
    SELECT * FROM parent_agg
),

with_deltas AS (
    SELECT
        fb.*,
        fb.kpi_click_rate - LAG(fb.kpi_click_rate) OVER (
            PARTITION BY fb.company_id, fb.marketplace_country_code, fb.row_type, fb.parent_asin, fb.asin
            ORDER BY fb.week_start
        ) AS kpi_click_rate_wow,
        fb.kpi_click_rate - AVG(fb.kpi_click_rate) OVER (
            PARTITION BY fb.company_id, fb.marketplace_country_code, fb.row_type, fb.parent_asin, fb.asin
            ORDER BY fb.week_start
            ROWS BETWEEN 4 PRECEDING AND 1 PRECEDING
        ) AS kpi_click_rate_wolast4,
        fb.kpi_click_rate - AVG(fb.kpi_click_rate) OVER (
            PARTITION BY fb.company_id, fb.marketplace_country_code, fb.row_type, fb.parent_asin, fb.asin
            ORDER BY fb.week_start
            ROWS BETWEEN 12 PRECEDING AND 1 PRECEDING
        ) AS kpi_click_rate_wolast12,
        fb.kpi_cart_add_rate - LAG(fb.kpi_cart_add_rate) OVER (
            PARTITION BY fb.company_id, fb.marketplace_country_code, fb.row_type, fb.parent_asin, fb.asin
            ORDER BY fb.week_start
        ) AS kpi_cart_add_rate_wow,
        fb.kpi_cart_add_rate - AVG(fb.kpi_cart_add_rate) OVER (
            PARTITION BY fb.company_id, fb.marketplace_country_code, fb.row_type, fb.parent_asin, fb.asin
            ORDER BY fb.week_start
            ROWS BETWEEN 4 PRECEDING AND 1 PRECEDING
        ) AS kpi_cart_add_rate_wolast4,
        fb.kpi_cart_add_rate - AVG(fb.kpi_cart_add_rate) OVER (
            PARTITION BY fb.company_id, fb.marketplace_country_code, fb.row_type, fb.parent_asin, fb.asin
            ORDER BY fb.week_start
            ROWS BETWEEN 12 PRECEDING AND 1 PRECEDING
        ) AS kpi_cart_add_rate_wolast12,
        fb.kpi_purchase_rate - LAG(fb.kpi_purchase_rate) OVER (
            PARTITION BY fb.company_id, fb.marketplace_country_code, fb.row_type, fb.parent_asin, fb.asin
            ORDER BY fb.week_start
        ) AS kpi_purchase_rate_wow,
        fb.kpi_purchase_rate - AVG(fb.kpi_purchase_rate) OVER (
            PARTITION BY fb.company_id, fb.marketplace_country_code, fb.row_type, fb.parent_asin, fb.asin
            ORDER BY fb.week_start
            ROWS BETWEEN 4 PRECEDING AND 1 PRECEDING
        ) AS kpi_purchase_rate_wolast4,
        fb.kpi_purchase_rate - AVG(fb.kpi_purchase_rate) OVER (
            PARTITION BY fb.company_id, fb.marketplace_country_code, fb.row_type, fb.parent_asin, fb.asin
            ORDER BY fb.week_start
            ROWS BETWEEN 12 PRECEDING AND 1 PRECEDING
        ) AS kpi_purchase_rate_wolast12
    FROM final_base fb
),

cvr_base AS (
    SELECT
        w.*,
        -- Delivery speed CVR (purchase per click)
        CASE
            WHEN w.clickdata_samedayshippingclickcount = 0 THEN NULL
            ELSE w.purchasedata_samedayshippingpurchasecount / w.clickdata_samedayshippingclickcount
        END AS cvr_same_day,
        CASE
            WHEN w.clickdata_onedayshippingclickcount = 0 THEN NULL
            ELSE w.purchasedata_onedayshippingpurchasecount / w.clickdata_onedayshippingclickcount
        END AS cvr_one_day,
        CASE
            WHEN w.clickdata_twodayshippingclickcount = 0 THEN NULL
            ELSE w.purchasedata_twodayshippingpurchasecount / w.clickdata_twodayshippingclickcount
        END AS cvr_two_day,
        CASE
            WHEN w.clickdata_samedayshippingclickcount = 0
                OR w.clickdata_twodayshippingclickcount = 0
                OR w.purchasedata_twodayshippingpurchasecount IS NULL
                OR w.purchasedata_samedayshippingpurchasecount IS NULL
                THEN NULL
            ELSE (w.purchasedata_samedayshippingpurchasecount / w.clickdata_samedayshippingclickcount)
                / (w.purchasedata_twodayshippingpurchasecount / w.clickdata_twodayshippingclickcount)
        END AS cvr_same_vs_two_ratio,
        CASE
            WHEN w.clickdata_onedayshippingclickcount = 0
                OR w.clickdata_twodayshippingclickcount = 0
                OR w.purchasedata_twodayshippingpurchasecount IS NULL
                OR w.purchasedata_onedayshippingpurchasecount IS NULL
                THEN NULL
            ELSE (w.purchasedata_onedayshippingpurchasecount / w.clickdata_onedayshippingclickcount)
                / (w.purchasedata_twodayshippingpurchasecount / w.clickdata_twodayshippingclickcount)
        END AS cvr_one_vs_two_ratio
    FROM with_deltas w
),

signal_base AS (
    SELECT
        w.*,
        -- Strength signal
        CASE
            WHEN w.kpi_click_rate IS NULL OR w.kpi_purchase_rate IS NULL THEN NULL
            WHEN w.kpi_click_rate >= 0.12 AND w.kpi_purchase_rate >= 0.09 THEN 'green'
            WHEN w.kpi_click_rate >= 0.08 AND w.kpi_purchase_rate >= 0.07 THEN 'yellow'
            ELSE 'red'
        END AS strength_color,
        CASE
            WHEN w.kpi_click_rate IS NULL OR w.kpi_purchase_rate IS NULL THEN 'insufficient_data'
            WHEN w.kpi_click_rate >= 0.12 AND w.kpi_purchase_rate >= 0.09 THEN 'strong_engagement_and_conversion'
            WHEN w.kpi_click_rate >= 0.08 AND w.kpi_purchase_rate >= 0.07 THEN 'acceptable_performance'
            ELSE 'weak_click_or_conversion'
        END AS strength_code,
        CASE
            WHEN w.kpi_click_rate IS NULL OR w.kpi_purchase_rate IS NULL THEN 'Not enough data to evaluate strength.'
            WHEN w.kpi_click_rate >= 0.12 AND w.kpi_purchase_rate >= 0.09 THEN 'Strong clickability and conversion.'
            WHEN w.kpi_click_rate >= 0.08 AND w.kpi_purchase_rate >= 0.07 THEN 'Performance is acceptable but not leading.'
            ELSE 'Underperforming click or conversion rate.'
        END AS strength_description,

        -- Weakness signal
        CASE
            WHEN w.kpi_click_rate_wow < -0.02 AND w.kpi_purchase_rate_wow < -0.02 THEN 'red'
            WHEN w.kpi_click_rate < 0.08 OR w.kpi_purchase_rate < 0.07 THEN 'red'
            WHEN w.kpi_cart_add_rate < 0.12 THEN 'yellow'
            ELSE 'green'
        END AS weakness_color,
        CASE
            WHEN w.kpi_click_rate_wow < -0.02 AND w.kpi_purchase_rate_wow < -0.02 THEN 'engagement_decline'
            WHEN w.kpi_click_rate < 0.08 THEN 'low_click_rate'
            WHEN w.kpi_purchase_rate < 0.07 THEN 'low_conversion_rate'
            WHEN w.kpi_cart_add_rate < 0.12 THEN 'low_cart_add_rate'
            ELSE 'no_major_weakness'
        END AS weakness_code,
        CASE
            WHEN w.kpi_click_rate_wow < -0.02 AND w.kpi_purchase_rate_wow < -0.02 THEN 'Clicks and purchases are declining week over week.'
            WHEN w.kpi_click_rate < 0.08 THEN 'Click rate is weak for this catalog item.'
            WHEN w.kpi_purchase_rate < 0.07 THEN 'Conversion rate is weak for this catalog item.'
            WHEN w.kpi_cart_add_rate < 0.12 THEN 'Cart add rate is below target.'
            ELSE 'No critical weakness detected.'
        END AS weakness_description,

        -- Opportunity signal
        CASE
            WHEN COALESCE(w.cvr_same_vs_two_ratio, 0) >= 1.3 OR COALESCE(w.cvr_one_vs_two_ratio, 0) >= 1.3 THEN 'green'
            WHEN w.kpi_purchase_rate >= 0.09 AND w.kpi_click_rate >= 0.08 THEN 'yellow'
            ELSE 'red'
        END AS opportunity_color,
        CASE
            WHEN COALESCE(w.cvr_same_vs_two_ratio, 0) >= 1.3 OR COALESCE(w.cvr_one_vs_two_ratio, 0) >= 1.3 THEN 'fast_delivery_uplift'
            WHEN w.kpi_purchase_rate >= 0.09 AND w.kpi_click_rate >= 0.08 THEN 'scale_traffic'
            ELSE 'no_clear_opportunity'
        END AS opportunity_code,
        CASE
            WHEN COALESCE(w.cvr_same_vs_two_ratio, 0) >= 1.3 OR COALESCE(w.cvr_one_vs_two_ratio, 0) >= 1.3
              THEN 'Fast-delivery conversion uplift; increase same/one-day availability if possible.'
            WHEN w.kpi_purchase_rate >= 0.09 AND w.kpi_click_rate >= 0.08 THEN 'Strong conversion with adequate clicks: consider scaling traffic.'
            ELSE 'No clear opportunity detected.'
        END AS opportunity_description,

        -- Threshold / ceiling signal
        CASE
            WHEN w.kpi_click_rate >= 0.16 AND w.kpi_purchase_rate >= 0.10 THEN 'red'
            WHEN w.kpi_click_rate >= 0.12 AND w.kpi_purchase_rate >= 0.09 THEN 'yellow'
            ELSE 'green'
        END AS threshold_color,
        CASE
            WHEN w.kpi_click_rate >= 0.16 AND w.kpi_purchase_rate >= 0.10 THEN 'conversion_ceiling'
            WHEN w.kpi_click_rate >= 0.12 AND w.kpi_purchase_rate >= 0.09 THEN 'approaching_ceiling'
            ELSE 'no_ceiling'
        END AS threshold_code,
        CASE
            WHEN w.kpi_click_rate >= 0.16 AND w.kpi_purchase_rate >= 0.10 THEN 'Likely near ceiling; growth may be limited by demand.'
            WHEN w.kpi_click_rate >= 0.12 AND w.kpi_purchase_rate >= 0.09 THEN 'Approaching ceiling; optimize for marginal gains.'
            ELSE 'No ceiling detected.'
        END AS threshold_description
    FROM cvr_base w
),

final AS (
    SELECT
        sb.*,
        CASE
            WHEN sb.kpi_click_rate_wow > 0.02
             AND sb.kpi_click_rate_wolast4 > 0.02
             AND sb.kpi_click_rate_wolast12 > 0.02 THEN 'green'
            WHEN sb.kpi_click_rate_wow < -0.02
             AND sb.kpi_click_rate_wolast4 < -0.02
             AND sb.kpi_click_rate_wolast12 < -0.02 THEN 'red'
            ELSE 'yellow'
        END AS kpi_click_rate_trend_signal,
        CASE
            WHEN sb.kpi_cart_add_rate_wow > 0.02
             AND sb.kpi_cart_add_rate_wolast4 > 0.02
             AND sb.kpi_cart_add_rate_wolast12 > 0.02 THEN 'green'
            WHEN sb.kpi_cart_add_rate_wow < -0.02
             AND sb.kpi_cart_add_rate_wolast4 < -0.02
             AND sb.kpi_cart_add_rate_wolast12 < -0.02 THEN 'red'
            ELSE 'yellow'
        END AS kpi_cart_add_rate_trend_signal,
        CASE
            WHEN sb.kpi_purchase_rate_wow > 0.02
             AND sb.kpi_purchase_rate_wolast4 > 0.02
             AND sb.kpi_purchase_rate_wolast12 > 0.02 THEN 'green'
            WHEN sb.kpi_purchase_rate_wow < -0.02
             AND sb.kpi_purchase_rate_wolast4 < -0.02
             AND sb.kpi_purchase_rate_wolast12 < -0.02 THEN 'red'
            ELSE 'yellow'
        END AS kpi_purchase_rate_trend_signal,
        json_format(CAST(map(ARRAY['color','code','description'], ARRAY[sb.strength_color, sb.strength_code, sb.strength_description]) AS JSON)) AS strength_signal,
        json_format(CAST(map(ARRAY['color','code','description'], ARRAY[sb.weakness_color, sb.weakness_code, sb.weakness_description]) AS JSON)) AS weakness_signal,
        json_format(CAST(map(ARRAY['color','code','description'], ARRAY[sb.opportunity_color, sb.opportunity_code, sb.opportunity_description]) AS JSON)) AS opportunity_signal,
        json_format(CAST(map(ARRAY['color','code','description'], ARRAY[sb.threshold_color, sb.threshold_code, sb.threshold_description]) AS JSON)) AS threshold_signal
    FROM signal_base sb
)

SELECT
    f.*
FROM final f
CROSS JOIN params
CROSS JOIN date_bounds d
WHERE
    f.week_start BETWEEN d.start_date AND d.end_date
    AND (cardinality(params.row_types) = 0 OR any_match(params.row_types, rt -> lower(rt) = lower(f.row_type)))
    AND (cardinality(params.strength_colors) = 0 OR any_match(params.strength_colors, c -> lower(c) = lower(f.strength_color)))
    AND (cardinality(params.weakness_colors) = 0 OR any_match(params.weakness_colors, c -> lower(c) = lower(f.weakness_color)))
    AND (cardinality(params.opportunity_colors) = 0 OR any_match(params.opportunity_colors, c -> lower(c) = lower(f.opportunity_color)))
    AND (cardinality(params.threshold_colors) = 0 OR any_match(params.threshold_colors, c -> lower(c) = lower(f.threshold_color)))
    AND (cardinality(params.click_trend_colors) = 0 OR any_match(params.click_trend_colors, c -> lower(c) = lower(f.kpi_click_rate_trend_signal)))
    AND (cardinality(params.cart_add_trend_colors) = 0 OR any_match(params.cart_add_trend_colors, c -> lower(c) = lower(f.kpi_cart_add_rate_trend_signal)))
    AND (cardinality(params.purchase_trend_colors) = 0 OR any_match(params.purchase_trend_colors, c -> lower(c) = lower(f.kpi_purchase_rate_trend_signal)))
ORDER BY f.week_start DESC
LIMIT {{limit_top_n}};
