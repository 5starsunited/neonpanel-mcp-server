-- QuickSight-ready query for search_query_performance_snapshot
-- No template parameters – all filtering is done via QuickSight filters/parameters.
-- Human-friendly column aliases for dashboard consumption.

WITH raw AS (
    SELECT *
    FROM "AwsDataCatalog"."brand_analytics_iceberg"."search_query_performance_snapshot"
),

-- ─── Compute WoW / WoLast4 / WoLast12 deltas via window functions ──────────
-- These KPIs were removed from the snapshot table; compute on the fly.
with_deltas AS (
    SELECT
        r.*,
        r.kpi_impression_share - LAG(r.kpi_impression_share) OVER (
            PARTITION BY r.company_id, r.marketplace_country_code, r.searchquerydata_searchquery, r.row_type, r.parent_asin, r.asin
            ORDER BY r.week_start
        ) AS kpi_impression_share_wow,
        r.kpi_impression_share - AVG(r.kpi_impression_share) OVER (
            PARTITION BY r.company_id, r.marketplace_country_code, r.searchquerydata_searchquery, r.row_type, r.parent_asin, r.asin
            ORDER BY r.week_start
            ROWS BETWEEN 4 PRECEDING AND 1 PRECEDING
        ) AS kpi_impression_share_wolast4,
        r.kpi_impression_share - AVG(r.kpi_impression_share) OVER (
            PARTITION BY r.company_id, r.marketplace_country_code, r.searchquerydata_searchquery, r.row_type, r.parent_asin, r.asin
            ORDER BY r.week_start
            ROWS BETWEEN 12 PRECEDING AND 1 PRECEDING
        ) AS kpi_impression_share_wolast12,
        r.kpi_click_share - LAG(r.kpi_click_share) OVER (
            PARTITION BY r.company_id, r.marketplace_country_code, r.searchquerydata_searchquery, r.row_type, r.parent_asin, r.asin
            ORDER BY r.week_start
        ) AS kpi_click_share_wow,
        r.kpi_click_share - AVG(r.kpi_click_share) OVER (
            PARTITION BY r.company_id, r.marketplace_country_code, r.searchquerydata_searchquery, r.row_type, r.parent_asin, r.asin
            ORDER BY r.week_start
            ROWS BETWEEN 4 PRECEDING AND 1 PRECEDING
        ) AS kpi_click_share_wolast4,
        r.kpi_click_share - AVG(r.kpi_click_share) OVER (
            PARTITION BY r.company_id, r.marketplace_country_code, r.searchquerydata_searchquery, r.row_type, r.parent_asin, r.asin
            ORDER BY r.week_start
            ROWS BETWEEN 12 PRECEDING AND 1 PRECEDING
        ) AS kpi_click_share_wolast12,
        r.kpi_cart_add_rate - LAG(r.kpi_cart_add_rate) OVER (
            PARTITION BY r.company_id, r.marketplace_country_code, r.searchquerydata_searchquery, r.row_type, r.parent_asin, r.asin
            ORDER BY r.week_start
        ) AS kpi_cart_add_rate_wow,
        r.kpi_cart_add_rate - AVG(r.kpi_cart_add_rate) OVER (
            PARTITION BY r.company_id, r.marketplace_country_code, r.searchquerydata_searchquery, r.row_type, r.parent_asin, r.asin
            ORDER BY r.week_start
            ROWS BETWEEN 4 PRECEDING AND 1 PRECEDING
        ) AS kpi_cart_add_rate_wolast4,
        r.kpi_cart_add_rate - AVG(r.kpi_cart_add_rate) OVER (
            PARTITION BY r.company_id, r.marketplace_country_code, r.searchquerydata_searchquery, r.row_type, r.parent_asin, r.asin
            ORDER BY r.week_start
            ROWS BETWEEN 12 PRECEDING AND 1 PRECEDING
        ) AS kpi_cart_add_rate_wolast12,
        r.kpi_purchase_rate - LAG(r.kpi_purchase_rate) OVER (
            PARTITION BY r.company_id, r.marketplace_country_code, r.searchquerydata_searchquery, r.row_type, r.parent_asin, r.asin
            ORDER BY r.week_start
        ) AS kpi_purchase_rate_wow,
        r.kpi_purchase_rate - AVG(r.kpi_purchase_rate) OVER (
            PARTITION BY r.company_id, r.marketplace_country_code, r.searchquerydata_searchquery, r.row_type, r.parent_asin, r.asin
            ORDER BY r.week_start
            ROWS BETWEEN 4 PRECEDING AND 1 PRECEDING
        ) AS kpi_purchase_rate_wolast4,
        r.kpi_purchase_rate - AVG(r.kpi_purchase_rate) OVER (
            PARTITION BY r.company_id, r.marketplace_country_code, r.searchquerydata_searchquery, r.row_type, r.parent_asin, r.asin
            ORDER BY r.week_start
            ROWS BETWEEN 12 PRECEDING AND 1 PRECEDING
        ) AS kpi_purchase_rate_wolast12,
        r.kpi_ctr_advantage - LAG(r.kpi_ctr_advantage) OVER (
            PARTITION BY r.company_id, r.marketplace_country_code, r.searchquerydata_searchquery, r.row_type, r.parent_asin, r.asin
            ORDER BY r.week_start
        ) AS kpi_ctr_advantage_wow,
        r.kpi_ctr_advantage - AVG(r.kpi_ctr_advantage) OVER (
            PARTITION BY r.company_id, r.marketplace_country_code, r.searchquerydata_searchquery, r.row_type, r.parent_asin, r.asin
            ORDER BY r.week_start
            ROWS BETWEEN 4 PRECEDING AND 1 PRECEDING
        ) AS kpi_ctr_advantage_wolast4,
        r.kpi_ctr_advantage - AVG(r.kpi_ctr_advantage) OVER (
            PARTITION BY r.company_id, r.marketplace_country_code, r.searchquerydata_searchquery, r.row_type, r.parent_asin, r.asin
            ORDER BY r.week_start
            ROWS BETWEEN 12 PRECEDING AND 1 PRECEDING
        ) AS kpi_ctr_advantage_wolast12
    FROM raw r
),

-- Pareto ABC by impressions per (ASIN, week, company)
-- A = search terms driving the first 80% of ASIN impressions
-- B = next 15%  (80–95%)
-- C = remaining 5%
pareto_impressions AS (
    SELECT
        r.company_id,
        r.asin,
        r.week_start,
        r.searchquerydata_searchquery,
        r.impressiondata_asinimpressioncount,
        SUM(r.impressiondata_asinimpressioncount) OVER (
            PARTITION BY r.company_id, r.asin, r.week_start
        ) AS total_asin_impressions,
        SUM(r.impressiondata_asinimpressioncount) OVER (
            PARTITION BY r.company_id, r.asin, r.week_start
            ORDER BY r.impressiondata_asinimpressioncount DESC
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS cumulative_impressions
    FROM with_deltas r
),

pareto_class AS (
    SELECT
        p.company_id,
        p.asin,
        p.week_start,
        p.searchquerydata_searchquery,
        CASE
            WHEN p.total_asin_impressions = 0 OR p.total_asin_impressions IS NULL THEN 'C'
            WHEN (p.cumulative_impressions - p.impressiondata_asinimpressioncount)
                 / p.total_asin_impressions < 0.80 THEN 'A'
            WHEN (p.cumulative_impressions - p.impressiondata_asinimpressioncount)
                 / p.total_asin_impressions < 0.95 THEN 'B'
            ELSE 'C'
        END AS pareto_impression_class
    FROM pareto_impressions p
),

cvr_base AS (
    SELECT
        r.*,
        pc.pareto_impression_class,
        -- Delivery speed CVR (purchase per click)
        CASE
            WHEN r.clickdata_totalsamedayshippingclickcount = 0 THEN NULL
            ELSE r.purchasedata_totalsamedayshippingpurchasecount / r.clickdata_totalsamedayshippingclickcount
        END AS cvr_same_day,
        CASE
            WHEN r.clickdata_totalonedayshippingclickcount = 0 THEN NULL
            ELSE r.purchasedata_totalonedayshippingpurchasecount / r.clickdata_totalonedayshippingclickcount
        END AS cvr_one_day,
        CASE
            WHEN r.clickdata_totaltwodayshippingclickcount = 0 THEN NULL
            ELSE r.purchasedata_totaltwodayshippingpurchasecount / r.clickdata_totaltwodayshippingclickcount
        END AS cvr_two_day,
        CASE
            WHEN r.clickdata_totalsamedayshippingclickcount = 0
                OR r.clickdata_totaltwodayshippingclickcount = 0
                OR r.purchasedata_totaltwodayshippingpurchasecount IS NULL
                OR r.purchasedata_totalsamedayshippingpurchasecount IS NULL
                THEN NULL
            ELSE (r.purchasedata_totalsamedayshippingpurchasecount / r.clickdata_totalsamedayshippingclickcount)
                / (r.purchasedata_totaltwodayshippingpurchasecount / r.clickdata_totaltwodayshippingclickcount)
        END AS cvr_same_vs_two_ratio,
        CASE
            WHEN r.clickdata_totalonedayshippingclickcount = 0
                OR r.clickdata_totaltwodayshippingclickcount = 0
                OR r.purchasedata_totaltwodayshippingpurchasecount IS NULL
                OR r.purchasedata_totalonedayshippingpurchasecount IS NULL
                THEN NULL
            ELSE (r.purchasedata_totalonedayshippingpurchasecount / r.clickdata_totalonedayshippingclickcount)
                / (r.purchasedata_totaltwodayshippingpurchasecount / r.clickdata_totaltwodayshippingclickcount)
        END AS cvr_one_vs_two_ratio
    FROM with_deltas r
    LEFT JOIN pareto_class pc
        ON  pc.company_id                    = r.company_id
        AND pc.asin                          = r.asin
        AND pc.week_start                    = r.week_start
        AND pc.searchquerydata_searchquery   = r.searchquerydata_searchquery
),

signal_base AS (
    SELECT
        w.*,
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
    FROM cvr_base w
),

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
        END AS impression_trend_signal,
        CASE
            WHEN sb.kpi_click_share_wow > 0.02
             AND sb.kpi_click_share_wolast4 > 0.02
             AND sb.kpi_click_share_wolast12 > 0.02 THEN 'green'
            WHEN sb.kpi_click_share_wow < -0.02
             AND sb.kpi_click_share_wolast4 < -0.02
             AND sb.kpi_click_share_wolast12 < -0.02 THEN 'red'
            ELSE 'yellow'
        END AS click_trend_signal,
        CASE
            WHEN sb.kpi_cart_add_rate_wow > 0.02
             AND sb.kpi_cart_add_rate_wolast4 > 0.02
             AND sb.kpi_cart_add_rate_wolast12 > 0.02 THEN 'green'
            WHEN sb.kpi_cart_add_rate_wow < -0.02
             AND sb.kpi_cart_add_rate_wolast4 < -0.02
             AND sb.kpi_cart_add_rate_wolast12 < -0.02 THEN 'red'
            ELSE 'yellow'
        END AS cart_add_trend_signal,
        CASE
            WHEN sb.kpi_purchase_rate_wow > 0.02
             AND sb.kpi_purchase_rate_wolast4 > 0.02
             AND sb.kpi_purchase_rate_wolast12 > 0.02 THEN 'green'
            WHEN sb.kpi_purchase_rate_wow < -0.02
             AND sb.kpi_purchase_rate_wolast4 < -0.02
             AND sb.kpi_purchase_rate_wolast12 < -0.02 THEN 'red'
            ELSE 'yellow'
        END AS purchase_trend_signal,
        CASE
            WHEN sb.kpi_ctr_advantage_wow > 0.02
             AND sb.kpi_ctr_advantage_wolast4 > 0.02
             AND sb.kpi_ctr_advantage_wolast12 > 0.02 THEN 'green'
            WHEN sb.kpi_ctr_advantage_wow < -0.02
             AND sb.kpi_ctr_advantage_wolast4 < -0.02
             AND sb.kpi_ctr_advantage_wolast12 < -0.02 THEN 'red'
            ELSE 'yellow'
        END AS ctr_advantage_trend_signal
    FROM signal_base sb
)

SELECT
    -- Identity / Dimensions
    f."company"                                                      AS "Company",
    f.company_id                                                     AS "Company ID",
    f.marketplace                                                    AS "Marketplace",
    f.marketplace_country_code                                       AS "Country Code",
    f.brand                                                          AS "Brand",
    f.title                                                          AS "Product Title",
    f.parent_asin                                                    AS "Parent ASIN",
    f.asin                                                           AS "ASIN",
    f.row_type                                                       AS "Row Type",
    f.revenue_abcd_class                                             AS "Revenue ABCD Class",
    f.pareto_abc_class                                               AS "Pareto ABC Class (Revenue)",
    f.pareto_impression_class                                         AS "Pareto ABC Class (Impressions)",
    f.revenue_share                                                  AS "Revenue Share",
    f.week_start                                                     AS "Week Start",
    f.year                                                           AS "Year",
    f.startdate                                                      AS "Report Start Date",
    f.enddate                                                        AS "Report End Date",

    -- Search Query
    f.searchquerydata_searchquery                                    AS "Search Query",
    f.searchquerydata_searchqueryscore                               AS "Search Query Score",
    f.searchquerydata_searchqueryvolume                              AS "Search Query Volume",

    -- Impressions
    f.impressiondata_totalqueryimpressioncount                       AS "Total Query Impressions",
    f.impressiondata_asinimpressioncount                             AS "ASIN Impressions",
    f.impressiondata_asinimpressionshare                             AS "ASIN Impression Share",

    -- Clicks
    f.clickdata_totalclickcount                                      AS "Total Clicks",
    f.clickdata_totalclickrate                                       AS "Total Click Rate",
    f.clickdata_asinclickcount                                       AS "ASIN Clicks",
    f.clickdata_asinclickshare                                       AS "ASIN Click Share",
    f.clickdata_totalmedianclickprice_amount                         AS "Total Median Click Price",
    f.clickdata_totalmedianclickprice_currencycode                   AS "Total Median Click Price Currency",
    f.clickdata_asinmedianclickprice_amount                          AS "ASIN Median Click Price",
    f.clickdata_asinmedianclickprice_currencycode                    AS "ASIN Median Click Price Currency",
    f.clickdata_totalsamedayshippingclickcount                       AS "Same-Day Shipping Clicks",
    f.clickdata_totalonedayshippingclickcount                        AS "1-Day Shipping Clicks",
    f.clickdata_totaltwodayshippingclickcount                        AS "2-Day Shipping Clicks",

    -- Cart Adds
    f.cartadddata_totalcartaddcount                                  AS "Total Cart Adds",
    f.cartadddata_totalcartaddrate                                   AS "Total Cart Add Rate",
    f.cartadddata_asincartaddcount                                   AS "ASIN Cart Adds",
    f.cartadddata_asincartaddshare                                   AS "ASIN Cart Add Share",
    f.cartadddata_totalmediancartaddprice_amount                     AS "Total Median Cart Add Price",
    f.cartadddata_totalmediancartaddprice_currencycode               AS "Total Median Cart Add Price Currency",
    f.cartadddata_asinmediancartaddprice_amount                      AS "ASIN Median Cart Add Price",
    f.cartadddata_asinmediancartaddprice_currencycode                AS "ASIN Median Cart Add Price Currency",
    f.cartadddata_totalsamedayshippingcartaddcount                   AS "Same-Day Shipping Cart Adds",
    f.cartadddata_totalonedayshippingcartaddcount                    AS "1-Day Shipping Cart Adds",
    f.cartadddata_totaltwodayshippingcartaddcount                    AS "2-Day Shipping Cart Adds",

    -- Purchases
    f.purchasedata_totalpurchasecount                                AS "Total Purchases",
    f.purchasedata_totalpurchaserate                                 AS "Total Purchase Rate",
    f.purchasedata_asinpurchasecount                                 AS "ASIN Purchases",
    f.purchasedata_asinpurchaseshare                                 AS "ASIN Purchase Share",
    f.purchasedata_totalmedianpurchaseprice_amount                   AS "Total Median Purchase Price",
    f.purchasedata_totalmedianpurchaseprice_currencycode             AS "Total Median Purchase Price Currency",
    f.purchasedata_asinmedianpurchaseprice_amount                    AS "ASIN Median Purchase Price",
    f.purchasedata_asinmedianpurchaseprice_currencycode              AS "ASIN Median Purchase Price Currency",
    f.purchasedata_totalsamedayshippingpurchasecount                 AS "Same-Day Shipping Purchases",
    f.purchasedata_totalonedayshippingpurchasecount                  AS "1-Day Shipping Purchases",
    f.purchasedata_totaltwodayshippingpurchasecount                  AS "2-Day Shipping Purchases",

    -- Computed KPIs
    f.kpi_impression_share                                           AS "Impression Share",
    f.kpi_click_share                                                AS "Click Share",
    f.kpi_cart_add_rate                                               AS "Cart Add Rate",
    f.kpi_purchase_rate                                               AS "Purchase Rate",
    f.kpi_ctr_advantage                                               AS "CTR Advantage",

    -- WoW / WoLast4 / WoLast12 Trend Deltas
    f.kpi_impression_share_wow                                       AS "Impression Share WoW",
    f.kpi_impression_share_wolast4                                   AS "Impression Share vs Last 4W",
    f.kpi_impression_share_wolast12                                  AS "Impression Share vs Last 12W",
    f.kpi_click_share_wow                                            AS "Click Share WoW",
    f.kpi_click_share_wolast4                                        AS "Click Share vs Last 4W",
    f.kpi_click_share_wolast12                                       AS "Click Share vs Last 12W",
    f.kpi_cart_add_rate_wow                                          AS "Cart Add Rate WoW",
    f.kpi_cart_add_rate_wolast4                                      AS "Cart Add Rate vs Last 4W",
    f.kpi_cart_add_rate_wolast12                                     AS "Cart Add Rate vs Last 12W",
    f.kpi_purchase_rate_wow                                          AS "Purchase Rate WoW",
    f.kpi_purchase_rate_wolast4                                      AS "Purchase Rate vs Last 4W",
    f.kpi_purchase_rate_wolast12                                     AS "Purchase Rate vs Last 12W",
    f.kpi_ctr_advantage_wow                                          AS "CTR Advantage WoW",
    f.kpi_ctr_advantage_wolast4                                      AS "CTR Advantage vs Last 4W",
    f.kpi_ctr_advantage_wolast12                                     AS "CTR Advantage vs Last 12W",

    -- Delivery Speed CVR
    f.cvr_same_day                                                   AS "Same-Day CVR",
    f.cvr_one_day                                                    AS "1-Day CVR",
    f.cvr_two_day                                                    AS "2-Day CVR",
    f.cvr_same_vs_two_ratio                                          AS "Same-Day vs 2-Day CVR Ratio",
    f.cvr_one_vs_two_ratio                                           AS "1-Day vs 2-Day CVR Ratio",

    -- Strength Signal
    f.strength_color                                                 AS "Strength Signal Color",
    f.strength_code                                                  AS "Strength Signal Code",
    f.strength_description                                           AS "Strength Signal Description",

    -- Weakness Signal
    f.weakness_color                                                 AS "Weakness Signal Color",
    f.weakness_code                                                  AS "Weakness Signal Code",
    f.weakness_description                                           AS "Weakness Signal Description",

    -- Opportunity Signal
    f.opportunity_color                                              AS "Opportunity Signal Color",
    f.opportunity_code                                               AS "Opportunity Signal Code",
    f.opportunity_description                                        AS "Opportunity Signal Description",

    -- Threshold Signal
    f.threshold_color                                                AS "Threshold Signal Color",
    f.threshold_code                                                 AS "Threshold Signal Code",
    f.threshold_description                                          AS "Threshold Signal Description",

    -- Trend Signals
    f.impression_trend_signal                                        AS "Impression Trend Signal",
    f.click_trend_signal                                             AS "Click Trend Signal",
    f.cart_add_trend_signal                                           AS "Cart Add Trend Signal",
    f.purchase_trend_signal                                           AS "Purchase Trend Signal",
    f.ctr_advantage_trend_signal                                      AS "CTR Advantage Trend Signal"

FROM final f
ORDER BY f.week_start DESC;
