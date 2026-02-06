-- Tool query for search_query_performance_snapshot
-- Provides KPI signals (strength/weakness/opportunity/threshold) as JSON for fast tool consumption.

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
        {{search_terms_array}} AS search_terms,
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
        {{impression_trend_colors_array}} AS impression_trend_colors,
        {{click_trend_colors_array}} AS click_trend_colors,
        {{cart_add_trend_colors_array}} AS cart_add_trend_colors,
        {{purchase_trend_colors_array}} AS purchase_trend_colors,
        {{ctr_advantage_trend_colors_array}} AS ctr_advantage_trend_colors
),

raw AS (
    SELECT *
    FROM "{{catalog}}"."sp_api_iceberg"."search_query_performance_snapshot"
),

filtered AS (
    SELECT r.*
    FROM raw r
    CROSS JOIN params p
    WHERE
        contains(p.company_ids, r.company_id)
        AND (cardinality(p.search_terms) = 0 OR any_match(p.search_terms, t -> lower(t) = lower(r.searchquerydata_searchquery)))
        AND (
            cardinality(p.marketplaces) = 0
            OR any_match(
                p.marketplaces,
                m -> lower(m) IN (lower(r.marketplace_country_code), lower(r.marketplace))
            )
        )
        AND (cardinality(p.parent_asins) = 0 OR any_match(p.parent_asins, a -> lower(a) = lower(r.parent_asin)))
        AND (cardinality(p.asins) = 0 OR any_match(p.asins, a -> lower(a) = lower(r.asin)))
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
    SELECT f.*
    FROM filtered f
    CROSS JOIN window_bounds d
    WHERE f.week_start BETWEEN d.lookback_start AND d.end_date
      AND f.year BETWEEN year(d.lookback_start) AND year(d.end_date)
),

signal_base AS (
    SELECT
        w.*,
                -- Delivery speed CVR (purchase per click)
                CASE
                        WHEN w.clickdata_totalsamedayshippingclickcount = 0 THEN NULL
                        ELSE w.purchasedata_totalsamedayshippingpurchasecount / w.clickdata_totalsamedayshippingclickcount
                END AS cvr_same_day,
                CASE
                        WHEN w.clickdata_totalonedayshippingclickcount = 0 THEN NULL
                        ELSE w.purchasedata_totalonedayshippingpurchasecount / w.clickdata_totalonedayshippingclickcount
                END AS cvr_one_day,
                CASE
                        WHEN w.clickdata_totaltwodayshippingclickcount = 0 THEN NULL
                        ELSE w.purchasedata_totaltwodayshippingpurchasecount / w.clickdata_totaltwodayshippingclickcount
                END AS cvr_two_day,
                CASE
                        WHEN w.clickdata_totalsamedayshippingclickcount = 0
                            OR w.clickdata_totaltwodayshippingclickcount = 0
                            OR w.purchasedata_totaltwodayshippingpurchasecount IS NULL
                            OR w.purchasedata_totalsamedayshippingpurchasecount IS NULL
                            THEN NULL
                        ELSE (w.purchasedata_totalsamedayshippingpurchasecount / w.clickdata_totalsamedayshippingclickcount)
                            / (w.purchasedata_totaltwodayshippingpurchasecount / w.clickdata_totaltwodayshippingclickcount)
                END AS cvr_same_vs_two_ratio,
                CASE
                        WHEN w.clickdata_totalonedayshippingclickcount = 0
                            OR w.clickdata_totaltwodayshippingclickcount = 0
                            OR w.purchasedata_totaltwodayshippingpurchasecount IS NULL
                            OR w.purchasedata_totalonedayshippingpurchasecount IS NULL
                            THEN NULL
                        ELSE (w.purchasedata_totalonedayshippingpurchasecount / w.clickdata_totalonedayshippingclickcount)
                            / (w.purchasedata_totaltwodayshippingpurchasecount / w.clickdata_totaltwodayshippingclickcount)
                END AS cvr_one_vs_two_ratio,
        -- Strength signal
        CASE
            WHEN w.kpi_click_share IS NULL OR w.kpi_purchase_rate IS NULL THEN NULL
            WHEN w.kpi_click_share >= 0.12 AND w.kpi_purchase_rate >= 0.09 THEN 'green'
            WHEN w.kpi_click_share >= 0.08 AND w.kpi_purchase_rate >= 0.07 THEN 'yellow'
            ELSE 'red'
        END AS strength_color,
        CASE
            WHEN w.kpi_click_share IS NULL OR w.kpi_purchase_rate IS NULL THEN 'insufficient_data'
            WHEN w.kpi_click_share >= 0.12 AND w.kpi_purchase_rate >= 0.09 THEN 'strong_listing_and_intent'
            WHEN w.kpi_click_share >= 0.08 AND w.kpi_purchase_rate >= 0.07 THEN 'acceptable_performance'
            ELSE 'weak_click_or_conversion'
        END AS strength_code,
        CASE
            WHEN w.kpi_click_share IS NULL OR w.kpi_purchase_rate IS NULL THEN 'Not enough data to evaluate strength.'
            WHEN w.kpi_click_share >= 0.12 AND w.kpi_purchase_rate >= 0.09 THEN 'Strong clickability and purchase intent.'
            WHEN w.kpi_click_share >= 0.08 AND w.kpi_purchase_rate >= 0.07 THEN 'Performance is acceptable but not leading.'
            ELSE 'Underperforming click or purchase rates.'
        END AS strength_description,

        -- Weakness signal (priority order)
        CASE
            WHEN w.kpi_impression_share_wow < 0 AND w.kpi_click_share_wow < 0 THEN 'red'
            WHEN w.kpi_click_share < 0.08 AND w.kpi_impression_share >= 0.04 THEN 'red'
            WHEN w.kpi_click_share >= 0.12 AND w.kpi_purchase_rate < 0.07 THEN 'red'
            WHEN w.kpi_cart_add_rate < 0.12 OR w.kpi_purchase_rate < 0.07 THEN 'yellow'
            ELSE 'green'
        END AS weakness_color,
        CASE
            WHEN w.kpi_impression_share_wow < 0 AND w.kpi_click_share_wow < 0 THEN 'visibility_loss'
            WHEN w.kpi_click_share < 0.08 AND w.kpi_impression_share >= 0.04 THEN 'offer_weakness'
            WHEN w.kpi_click_share >= 0.12 AND w.kpi_purchase_rate < 0.07 THEN 'funnel_leakage'
            WHEN w.kpi_cart_add_rate < 0.12 OR w.kpi_purchase_rate < 0.07 THEN 'intent_mismatch'
            ELSE 'no_major_weakness'
        END AS weakness_code,
        CASE
            WHEN w.kpi_impression_share_wow < 0 AND w.kpi_click_share_wow < 0 THEN 'Visibility and clicks are declining week over week.'
            WHEN w.kpi_click_share < 0.08 AND w.kpi_impression_share >= 0.04 THEN 'Impressions are acceptable but click share is weak.'
            WHEN w.kpi_click_share >= 0.12 AND w.kpi_purchase_rate < 0.07 THEN 'Strong clicks but weak purchases suggest PDP/price issues.'
            WHEN w.kpi_cart_add_rate < 0.12 OR w.kpi_purchase_rate < 0.07 THEN 'Low cart add or purchase rate indicates intent mismatch.'
            ELSE 'No critical weakness detected.'
        END AS weakness_description,

        -- Opportunity signal
        CASE
            WHEN COALESCE(w.cvr_same_vs_two_ratio, 0) >= 1.3 OR COALESCE(w.cvr_one_vs_two_ratio, 0) >= 1.3 THEN 'green'
            WHEN w.kpi_impression_share < 0.04 AND w.kpi_ctr_advantage >= 1.2 THEN 'green'
            WHEN w.kpi_impression_share < 0.06 AND w.kpi_ctr_advantage >= 1.2 THEN 'yellow'
            ELSE 'red'
        END AS opportunity_color,
        CASE
            WHEN COALESCE(w.cvr_same_vs_two_ratio, 0) >= 1.3 OR COALESCE(w.cvr_one_vs_two_ratio, 0) >= 1.3 THEN 'fast_delivery_uplift'
            WHEN w.kpi_impression_share < 0.04 AND w.kpi_ctr_advantage >= 1.2 THEN 'visibility_gap'
            WHEN w.kpi_impression_share < 0.06 AND w.kpi_ctr_advantage >= 1.2 THEN 'moderate_visibility_gap'
            ELSE 'no_clear_opportunity'
        END AS opportunity_code,
        CASE
                        WHEN COALESCE(w.cvr_same_vs_two_ratio, 0) >= 1.3 OR COALESCE(w.cvr_one_vs_two_ratio, 0) >= 1.3
              THEN 'Fast-delivery conversion uplift; increasing same/one-day availability may raise profitability.'
            WHEN w.kpi_impression_share < 0.04 AND w.kpi_ctr_advantage >= 1.2 THEN 'High CTR advantage but low impressions: scale visibility.'
            WHEN w.kpi_impression_share < 0.06 AND w.kpi_ctr_advantage >= 1.2 THEN 'CTR advantage with moderate impressions: growth possible.'
            ELSE 'No clear visibility opportunity.'
        END AS opportunity_description,

        -- Threshold / ceiling signal
        CASE
            WHEN w.kpi_impression_share >= 0.06 AND w.kpi_ctr_advantage >= 1.5 THEN 'red'
            WHEN w.kpi_impression_share >= 0.05 AND w.kpi_ctr_advantage >= 1.2 THEN 'yellow'
            ELSE 'green'
        END AS threshold_color,
        CASE
            WHEN w.kpi_impression_share >= 0.06 AND w.kpi_ctr_advantage >= 1.5 THEN 'visibility_ceiling'
            WHEN w.kpi_impression_share >= 0.05 AND w.kpi_ctr_advantage >= 1.2 THEN 'approaching_ceiling'
            ELSE 'no_ceiling'
        END AS threshold_code,
        CASE
            WHEN w.kpi_impression_share >= 0.06 AND w.kpi_ctr_advantage >= 1.5 THEN 'Likely visibility ceiling; growth limited by distribution.'
            WHEN w.kpi_impression_share >= 0.05 AND w.kpi_ctr_advantage >= 1.2 THEN 'Approaching visibility ceiling.'
            ELSE 'No ceiling detected.'
        END AS threshold_description
    FROM windowed w
)

final AS (
    SELECT
        sb.*,
        CASE
            WHEN sb.kpi_impression_share_wow > 0.02
             AND sb.kpi_impression_share_wolast4 > 0.02
             AND sb.kpi_impression_share_wolast12 > 0.02 THEN 'green'
            WHEN sb.kpi_impression_share_wow < -0.02
             AND sb.kpi_impression_share_wolast4 < -0.02
             AND sb.kpi_impression_share_wolast12 < -0.02 THEN 'red'
            ELSE 'yellow'
        END AS kpi_impression_share_trend_signal,
        CASE
            WHEN sb.kpi_click_share_wow > 0.02
             AND sb.kpi_click_share_wolast4 > 0.02
             AND sb.kpi_click_share_wolast12 > 0.02 THEN 'green'
            WHEN sb.kpi_click_share_wow < -0.02
             AND sb.kpi_click_share_wolast4 < -0.02
             AND sb.kpi_click_share_wolast12 < -0.02 THEN 'red'
            ELSE 'yellow'
        END AS kpi_click_share_trend_signal,
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
        CASE
            WHEN sb.kpi_ctr_advantage_wow > 0.02
             AND sb.kpi_ctr_advantage_wolast4 > 0.02
             AND sb.kpi_ctr_advantage_wolast12 > 0.02 THEN 'green'
            WHEN sb.kpi_ctr_advantage_wow < -0.02
             AND sb.kpi_ctr_advantage_wolast4 < -0.02
             AND sb.kpi_ctr_advantage_wolast12 < -0.02 THEN 'red'
            ELSE 'yellow'
        END AS kpi_ctr_advantage_trend_signal,
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
WHERE
    (cardinality(params.strength_colors) = 0 OR any_match(params.strength_colors, c -> lower(c) = lower(f.strength_color)))
    AND (cardinality(params.weakness_colors) = 0 OR any_match(params.weakness_colors, c -> lower(c) = lower(f.weakness_color)))
    AND (cardinality(params.opportunity_colors) = 0 OR any_match(params.opportunity_colors, c -> lower(c) = lower(f.opportunity_color)))
    AND (cardinality(params.threshold_colors) = 0 OR any_match(params.threshold_colors, c -> lower(c) = lower(f.threshold_color)))
    AND (cardinality(params.impression_trend_colors) = 0 OR any_match(params.impression_trend_colors, c -> lower(c) = lower(f.kpi_impression_share_trend_signal)))
    AND (cardinality(params.click_trend_colors) = 0 OR any_match(params.click_trend_colors, c -> lower(c) = lower(f.kpi_click_share_trend_signal)))
    AND (cardinality(params.cart_add_trend_colors) = 0 OR any_match(params.cart_add_trend_colors, c -> lower(c) = lower(f.kpi_cart_add_rate_trend_signal)))
    AND (cardinality(params.purchase_trend_colors) = 0 OR any_match(params.purchase_trend_colors, c -> lower(c) = lower(f.kpi_purchase_rate_trend_signal)))
    AND (cardinality(params.ctr_advantage_trend_colors) = 0 OR any_match(params.ctr_advantage_trend_colors, c -> lower(c) = lower(f.kpi_ctr_advantage_trend_signal)))
    CASE
        WHEN sb.kpi_impression_share_wow > 0.02
         AND sb.kpi_impression_share_wolast4 > 0.02
         AND sb.kpi_impression_share_wolast12 > 0.02 THEN 'green'
        WHEN sb.kpi_impression_share_wow < -0.02
         AND sb.kpi_impression_share_wolast4 < -0.02
         AND sb.kpi_impression_share_wolast12 < -0.02 THEN 'red'
        ELSE 'yellow'
    END AS kpi_impression_share_trend_signal,
    CASE
        WHEN sb.kpi_click_share_wow > 0.02
         AND sb.kpi_click_share_wolast4 > 0.02
         AND sb.kpi_click_share_wolast12 > 0.02 THEN 'green'
        WHEN sb.kpi_click_share_wow < -0.02
         AND sb.kpi_click_share_wolast4 < -0.02
         AND sb.kpi_click_share_wolast12 < -0.02 THEN 'red'
        ELSE 'yellow'
    END AS kpi_click_share_trend_signal,
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
    CASE
        WHEN sb.kpi_ctr_advantage_wow > 0.02
         AND sb.kpi_ctr_advantage_wolast4 > 0.02
         AND sb.kpi_ctr_advantage_wolast12 > 0.02 THEN 'green'
        WHEN sb.kpi_ctr_advantage_wow < -0.02
         AND sb.kpi_ctr_advantage_wolast4 < -0.02
         AND sb.kpi_ctr_advantage_wolast12 < -0.02 THEN 'red'
        ELSE 'yellow'
    END AS kpi_ctr_advantage_trend_signal,
    json_format(CAST(map(ARRAY['color','code','description'], ARRAY[sb.strength_color, sb.strength_code, sb.strength_description]) AS JSON)) AS strength_signal,
    json_format(CAST(map(ARRAY['color','code','description'], ARRAY[sb.weakness_color, sb.weakness_code, sb.weakness_description]) AS JSON)) AS weakness_signal,
    json_format(CAST(map(ARRAY['color','code','description'], ARRAY[sb.opportunity_color, sb.opportunity_code, sb.opportunity_description]) AS JSON)) AS opportunity_signal,
    json_format(CAST(map(ARRAY['color','code','description'], ARRAY[sb.threshold_color, sb.threshold_code, sb.threshold_description]) AS JSON)) AS threshold_signal
FROM signal_base sb
WHERE
    (cardinality(params.strength_colors) = 0 OR any_match(params.strength_colors, c -> lower(c) = lower(sb.strength_color)))
    AND (cardinality(params.weakness_colors) = 0 OR any_match(params.weakness_colors, c -> lower(c) = lower(sb.weakness_color)))
    AND (cardinality(params.opportunity_colors) = 0 OR any_match(params.opportunity_colors, c -> lower(c) = lower(sb.opportunity_color)))
    AND (cardinality(params.threshold_colors) = 0 OR any_match(params.threshold_colors, c -> lower(c) = lower(sb.threshold_color)))
ORDER BY sb.week_start DESC
LIMIT {{limit_top_n}};
