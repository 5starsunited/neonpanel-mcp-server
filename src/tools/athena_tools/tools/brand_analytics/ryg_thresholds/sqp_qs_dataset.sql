-- Full QuickSight-ready query for search_query_performance_snapshot
WITH raw AS (
    SELECT *
    FROM "AwsDataCatalog"."brand_analytics_iceberg"."search_query_performance_snapshot"
),

-- Step 1: Reconstruct Trend Metrics removed from DDL
trends AS (
    SELECT 
        *,
        -- Impression Share WoW, 4W, 12W
        kpi_impression_share - LAG(kpi_impression_share, 1) OVER (PARTITION BY company_id, asin, searchquerydata_searchquery ORDER BY week_start) AS kpi_impression_share_wow,
        kpi_impression_share - LAG(kpi_impression_share, 4) OVER (PARTITION BY company_id, asin, searchquerydata_searchquery ORDER BY week_start) AS kpi_impression_share_wolast4,
        kpi_impression_share - LAG(kpi_impression_share, 12) OVER (PARTITION BY company_id, asin, searchquerydata_searchquery ORDER BY week_start) AS kpi_impression_share_wolast12,
        
        -- Click Share WoW, 4W, 12W
        kpi_click_share - LAG(kpi_click_share, 1) OVER (PARTITION BY company_id, asin, searchquerydata_searchquery ORDER BY week_start) AS kpi_click_share_wow,
        kpi_click_share - LAG(kpi_click_share, 4) OVER (PARTITION BY company_id, asin, searchquerydata_searchquery ORDER BY week_start) AS kpi_click_share_wolast4,
        kpi_click_share - LAG(kpi_click_share, 12) OVER (PARTITION BY company_id, asin, searchquerydata_searchquery ORDER BY week_start) AS kpi_click_share_wolast12,
        
        -- Cart Add Rate WoW, 4W, 12W
        kpi_cart_add_rate - LAG(kpi_cart_add_rate, 1) OVER (PARTITION BY company_id, asin, searchquerydata_searchquery ORDER BY week_start) AS kpi_cart_add_rate_wow,
        kpi_cart_add_rate - LAG(kpi_cart_add_rate, 4) OVER (PARTITION BY company_id, asin, searchquerydata_searchquery ORDER BY week_start) AS kpi_cart_add_rate_wolast4,
        kpi_cart_add_rate - LAG(kpi_cart_add_rate, 12) OVER (PARTITION BY company_id, asin, searchquerydata_searchquery ORDER BY week_start) AS kpi_cart_add_rate_wolast12,
        
        -- Purchase Rate WoW, 4W, 12W
        kpi_purchase_rate - LAG(kpi_purchase_rate, 1) OVER (PARTITION BY company_id, asin, searchquerydata_searchquery ORDER BY week_start) AS kpi_purchase_rate_wow,
        kpi_purchase_rate - LAG(kpi_purchase_rate, 4) OVER (PARTITION BY company_id, asin, searchquerydata_searchquery ORDER BY week_start) AS kpi_purchase_rate_wolast4,
        kpi_purchase_rate - LAG(kpi_purchase_rate, 12) OVER (PARTITION BY company_id, asin, searchquerydata_searchquery ORDER BY week_start) AS kpi_purchase_rate_wolast12,
        
        -- CTR Advantage WoW, 4W, 12W
        kpi_ctr_advantage - LAG(kpi_ctr_advantage, 1) OVER (PARTITION BY company_id, asin, searchquerydata_searchquery ORDER BY week_start) AS kpi_ctr_advantage_wow,
        kpi_ctr_advantage - LAG(kpi_ctr_advantage, 4) OVER (PARTITION BY company_id, asin, searchquerydata_searchquery ORDER BY week_start) AS kpi_ctr_advantage_wolast4,
        kpi_ctr_advantage - LAG(kpi_ctr_advantage, 12) OVER (PARTITION BY company_id, asin, searchquerydata_searchquery ORDER BY week_start) AS kpi_ctr_advantage_wolast12
    FROM raw
),

-- Step 2: Pareto ABC by impressions per (ASIN, week, company)
pareto_impressions AS (
    SELECT
        t.*,
        SUM(t.impressiondata_asinimpressioncount) OVER (
            PARTITION BY t.company_id, t.asin, t.week_start
        ) AS total_asin_impressions,
        SUM(t.impressiondata_asinimpressioncount) OVER (
            PARTITION BY t.company_id, t.asin, t.week_start
            ORDER BY t.impressiondata_asinimpressioncount DESC
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS cumulative_impressions
    FROM trends t
),

pareto_class AS (
    SELECT
        p.*,
        CASE
            WHEN p.total_asin_impressions = 0 OR p.total_asin_impressions IS NULL THEN 'C'
            WHEN (p.cumulative_impressions - p.impressiondata_asinimpressioncount)
                 / NULLIF(CAST(p.total_asin_impressions AS DOUBLE), 0) < 0.80 THEN 'A'
            WHEN (p.cumulative_impressions - p.impressiondata_asinimpressioncount)
                 / NULLIF(CAST(p.total_asin_impressions AS DOUBLE), 0) < 0.95 THEN 'B'
            ELSE 'C'
        END AS pareto_impression_class
    FROM pareto_impressions p
),

cvr_base AS (
    SELECT
        pc.*,
        CASE
            WHEN pc.clickdata_totalsamedayshippingclickcount = 0 THEN NULL
            ELSE CAST(pc.purchasedata_totalsamedayshippingpurchasecount AS DOUBLE) / pc.clickdata_totalsamedayshippingclickcount
        END AS cvr_same_day,
        CASE
            WHEN pc.clickdata_totalonedayshippingclickcount = 0 THEN NULL
            ELSE CAST(pc.purchasedata_totalonedayshippingpurchasecount AS DOUBLE) / pc.clickdata_totalonedayshippingclickcount
        END AS cvr_one_day,
        CASE
            WHEN pc.clickdata_totaltwodayshippingclickcount = 0 THEN NULL
            ELSE CAST(pc.purchasedata_totaltwodayshippingpurchasecount AS DOUBLE) / pc.clickdata_totaltwodayshippingclickcount
        END AS cvr_two_day,
        CASE
            WHEN pc.clickdata_totalsamedayshippingclickcount = 0 OR pc.clickdata_totaltwodayshippingclickcount = 0 THEN NULL
            ELSE (CAST(pc.purchasedata_totalsamedayshippingpurchasecount AS DOUBLE) / pc.clickdata_totalsamedayshippingclickcount)
                / NULLIF((CAST(pc.purchasedata_totaltwodayshippingpurchasecount AS DOUBLE) / pc.clickdata_totaltwodayshippingclickcount), 0)
        END AS cvr_same_vs_two_ratio,
        CASE
            WHEN pc.clickdata_totalonedayshippingclickcount = 0 OR pc.clickdata_totaltwodayshippingclickcount = 0 THEN NULL
            ELSE (CAST(pc.purchasedata_totalonedayshippingpurchasecount AS DOUBLE) / pc.clickdata_totalonedayshippingclickcount)
                / NULLIF((CAST(pc.purchasedata_totaltwodayshippingpurchasecount AS DOUBLE) / pc.clickdata_totaltwodayshippingclickcount), 0)
        END AS cvr_one_vs_two_ratio
    FROM pareto_class pc
),

-- ── N. Deduplicate thresholds: latest row wins per (company_id, tool, signal_group, metric, color) ──
ryg_deduped AS (
    SELECT
        company_id, tool, signal_group, metric, color, threshold_value
    FROM (
        SELECT *,
            ROW_NUMBER() OVER (
                PARTITION BY COALESCE(CAST(company_id AS VARCHAR), '__default__'),
                             tool, signal_group, metric, color
                ORDER BY updated_at DESC
            ) AS rn
        FROM "AwsDataCatalog"."brand_analytics_iceberg"."ryg_thresholds"
        WHERE tool IN ('sqp', 'global')
    )
    WHERE rn = 1
),

-- ── N+1. Per-company threshold pivot (override wins over default) ────────────
company_thresholds AS (
    SELECT
        c.company_id,

        -- STRENGTH (sqp)
        COALESCE(MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool='sqp' AND t.signal_group='strength'    AND t.metric='click_share'      AND t.color='green'  THEN t.threshold_value END),
                 MAX(CASE WHEN t.company_id IS NULL     AND t.tool='sqp' AND t.signal_group='strength'    AND t.metric='click_share'      AND t.color='green'  THEN t.threshold_value END)) AS str_cs_green,
        COALESCE(MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool='sqp' AND t.signal_group='strength'    AND t.metric='purchase_rate'    AND t.color='green'  THEN t.threshold_value END),
                 MAX(CASE WHEN t.company_id IS NULL     AND t.tool='sqp' AND t.signal_group='strength'    AND t.metric='purchase_rate'    AND t.color='green'  THEN t.threshold_value END)) AS str_pr_green,
        COALESCE(MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool='sqp' AND t.signal_group='strength'    AND t.metric='click_share'      AND t.color='yellow' THEN t.threshold_value END),
                 MAX(CASE WHEN t.company_id IS NULL     AND t.tool='sqp' AND t.signal_group='strength'    AND t.metric='click_share'      AND t.color='yellow' THEN t.threshold_value END)) AS str_cs_yellow,
        COALESCE(MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool='sqp' AND t.signal_group='strength'    AND t.metric='purchase_rate'    AND t.color='yellow' THEN t.threshold_value END),
                 MAX(CASE WHEN t.company_id IS NULL     AND t.tool='sqp' AND t.signal_group='strength'    AND t.metric='purchase_rate'    AND t.color='yellow' THEN t.threshold_value END)) AS str_pr_yellow,

        -- WEAKNESS (sqp)
        COALESCE(MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool='sqp' AND t.signal_group='weakness'    AND t.metric='delta'            AND t.color='red'    THEN t.threshold_value END),
                 MAX(CASE WHEN t.company_id IS NULL     AND t.tool='sqp' AND t.signal_group='weakness'    AND t.metric='delta'            AND t.color='red'    THEN t.threshold_value END)) AS wk_delta,
        COALESCE(MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool='sqp' AND t.signal_group='weakness'    AND t.metric='click_share'      AND t.color='red'    THEN t.threshold_value END),
                 MAX(CASE WHEN t.company_id IS NULL     AND t.tool='sqp' AND t.signal_group='weakness'    AND t.metric='click_share'      AND t.color='red'    THEN t.threshold_value END)) AS wk_cs_red,
        COALESCE(MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool='sqp' AND t.signal_group='weakness'    AND t.metric='impression_share' AND t.color='yellow' THEN t.threshold_value END),
                 MAX(CASE WHEN t.company_id IS NULL     AND t.tool='sqp' AND t.signal_group='weakness'    AND t.metric='impression_share' AND t.color='yellow' THEN t.threshold_value END)) AS wk_is_yellow,
        COALESCE(MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool='sqp' AND t.signal_group='weakness'    AND t.metric='cart_add_rate'    AND t.color='yellow' THEN t.threshold_value END),
                 MAX(CASE WHEN t.company_id IS NULL     AND t.tool='sqp' AND t.signal_group='weakness'    AND t.metric='cart_add_rate'    AND t.color='yellow' THEN t.threshold_value END)) AS wk_car_yellow,

        -- OPPORTUNITY (sqp)
        COALESCE(MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool='sqp' AND t.signal_group='opportunity' AND t.metric='cvr_ratio'        AND t.color='green'  THEN t.threshold_value END),
                 MAX(CASE WHEN t.company_id IS NULL     AND t.tool='sqp' AND t.signal_group='opportunity' AND t.metric='cvr_ratio'        AND t.color='green'  THEN t.threshold_value END)) AS opp_cvr_green,
        COALESCE(MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool='sqp' AND t.signal_group='opportunity' AND t.metric='impression_share' AND t.color='green'  THEN t.threshold_value END),
                 MAX(CASE WHEN t.company_id IS NULL     AND t.tool='sqp' AND t.signal_group='opportunity' AND t.metric='impression_share' AND t.color='green'  THEN t.threshold_value END)) AS opp_is_green,
        COALESCE(MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool='sqp' AND t.signal_group='opportunity' AND t.metric='impression_share' AND t.color='yellow' THEN t.threshold_value END),
                 MAX(CASE WHEN t.company_id IS NULL     AND t.tool='sqp' AND t.signal_group='opportunity' AND t.metric='impression_share' AND t.color='yellow' THEN t.threshold_value END)) AS opp_is_yellow,
        COALESCE(MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool='sqp' AND t.signal_group='opportunity' AND t.metric='ctr_advantage'   AND t.color='green'  THEN t.threshold_value END),
                 MAX(CASE WHEN t.company_id IS NULL     AND t.tool='sqp' AND t.signal_group='opportunity' AND t.metric='ctr_advantage'   AND t.color='green'  THEN t.threshold_value END)) AS opp_ctr_green,

        -- CEILING (sqp)
        COALESCE(MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool='sqp' AND t.signal_group='ceiling'     AND t.metric='impression_share' AND t.color='red'    THEN t.threshold_value END),
                 MAX(CASE WHEN t.company_id IS NULL     AND t.tool='sqp' AND t.signal_group='ceiling'     AND t.metric='impression_share' AND t.color='red'    THEN t.threshold_value END)) AS ceil_is_red,
        COALESCE(MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool='sqp' AND t.signal_group='ceiling'     AND t.metric='impression_share' AND t.color='yellow' THEN t.threshold_value END),
                 MAX(CASE WHEN t.company_id IS NULL     AND t.tool='sqp' AND t.signal_group='ceiling'     AND t.metric='impression_share' AND t.color='yellow' THEN t.threshold_value END)) AS ceil_is_yellow,
        COALESCE(MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool='sqp' AND t.signal_group='ceiling'     AND t.metric='ctr_advantage'    AND t.color='red'    THEN t.threshold_value END),
                 MAX(CASE WHEN t.company_id IS NULL     AND t.tool='sqp' AND t.signal_group='ceiling'     AND t.metric='ctr_advantage'    AND t.color='red'    THEN t.threshold_value END)) AS ceil_ctr_red,
        COALESCE(MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool='sqp' AND t.signal_group='ceiling'     AND t.metric='ctr_advantage'    AND t.color='yellow' THEN t.threshold_value END),
                 MAX(CASE WHEN t.company_id IS NULL     AND t.tool='sqp' AND t.signal_group='ceiling'     AND t.metric='ctr_advantage'    AND t.color='yellow' THEN t.threshold_value END)) AS ceil_ctr_yellow,

        -- GLOBAL TREND
        COALESCE(MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool='global' AND t.signal_group='trend' AND t.metric='delta' AND t.color='green' THEN t.threshold_value END),
                 MAX(CASE WHEN t.company_id IS NULL     AND t.tool='global' AND t.signal_group='trend' AND t.metric='delta' AND t.color='green' THEN t.threshold_value END)) AS trend_green,
        COALESCE(MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool='global' AND t.signal_group='trend' AND t.metric='delta' AND t.color='red'   THEN t.threshold_value END),
                 MAX(CASE WHEN t.company_id IS NULL     AND t.tool='global' AND t.signal_group='trend' AND t.metric='delta' AND t.color='red'   THEN t.threshold_value END)) AS trend_red

    FROM (
        SELECT DISTINCT CAST(company_id AS BIGINT) AS company_id
        FROM "AwsDataCatalog"."brand_analytics_iceberg"."search_query_performance_snapshot"
    ) c
    LEFT JOIN ryg_deduped t
        ON (t.company_id = c.company_id OR t.company_id IS NULL)
    GROUP BY c.company_id
),

signal_base AS (
    SELECT
        w.*,
        -- Strength signal
        CASE
            WHEN w.kpi_click_share IS NULL OR w.kpi_purchase_rate IS NULL THEN NULL
            WHEN w.kpi_click_share >= thr.str_cs_green  AND w.kpi_purchase_rate >= thr.str_pr_green  THEN 'green'
            WHEN w.kpi_click_share >= thr.str_cs_yellow AND w.kpi_purchase_rate >= thr.str_pr_yellow THEN 'yellow'
            ELSE 'red'
        END AS strength_color,
        CASE
            WHEN w.kpi_click_share IS NULL OR w.kpi_purchase_rate IS NULL THEN 'insufficient_data'
            WHEN w.kpi_click_share >= thr.str_cs_green  AND w.kpi_purchase_rate >= thr.str_pr_green  THEN 'strong_listing_and_intent'
            WHEN w.kpi_click_share >= thr.str_cs_yellow AND w.kpi_purchase_rate >= thr.str_pr_yellow THEN 'acceptable_performance'
            ELSE 'weak_click_or_conversion'
        END AS strength_code,
        CASE
            WHEN w.kpi_click_share IS NULL OR w.kpi_purchase_rate IS NULL THEN 'Not enough data to evaluate strength.'
            WHEN w.kpi_click_share >= thr.str_cs_green  AND w.kpi_purchase_rate >= thr.str_pr_green  THEN 'Strong clickability and purchase intent.'
            WHEN w.kpi_click_share >= thr.str_cs_yellow AND w.kpi_purchase_rate >= thr.str_pr_yellow THEN 'Performance is acceptable but not leading.'
            ELSE 'Underperforming click or purchase rates.'
        END AS strength_description,

        -- Weakness signal
        CASE
            WHEN w.kpi_impression_share_wow < thr.wk_delta   AND w.kpi_click_share_wow < thr.wk_delta       THEN 'red'
            WHEN w.kpi_click_share < thr.wk_cs_red           AND w.kpi_impression_share >= thr.wk_is_yellow  THEN 'red'
            WHEN w.kpi_click_share >= thr.str_cs_green       AND w.kpi_purchase_rate < thr.str_pr_yellow     THEN 'red'
            WHEN w.kpi_cart_add_rate < thr.wk_car_yellow      OR w.kpi_purchase_rate < thr.str_pr_yellow     THEN 'yellow'
            ELSE 'green'
        END AS weakness_color,
        CASE
            WHEN w.kpi_impression_share_wow < thr.wk_delta   AND w.kpi_click_share_wow < thr.wk_delta       THEN 'visibility_loss'
            WHEN w.kpi_click_share < thr.wk_cs_red           AND w.kpi_impression_share >= thr.wk_is_yellow  THEN 'offer_weakness'
            WHEN w.kpi_click_share >= thr.str_cs_green       AND w.kpi_purchase_rate < thr.str_pr_yellow     THEN 'funnel_leakage'
            WHEN w.kpi_cart_add_rate < thr.wk_car_yellow      OR w.kpi_purchase_rate < thr.str_pr_yellow     THEN 'intent_mismatch'
            ELSE 'no_major_weakness'
        END AS weakness_code,
        CASE
            WHEN w.kpi_impression_share_wow < thr.wk_delta   AND w.kpi_click_share_wow < thr.wk_delta       THEN 'Visibility and clicks are declining week over week.'
            WHEN w.kpi_click_share < thr.wk_cs_red           AND w.kpi_impression_share >= thr.wk_is_yellow  THEN 'Impressions are acceptable but click share is weak.'
            WHEN w.kpi_click_share >= thr.str_cs_green       AND w.kpi_purchase_rate < thr.str_pr_yellow     THEN 'Strong clicks but weak purchases suggest PDP/price issues.'
            WHEN w.kpi_cart_add_rate < thr.wk_car_yellow      OR w.kpi_purchase_rate < thr.str_pr_yellow     THEN 'Low cart add or purchase rate indicates intent mismatch.'
            ELSE 'No critical weakness detected.'
        END AS weakness_description,

        -- Opportunity signal
        CASE
            WHEN COALESCE(w.cvr_same_vs_two_ratio, 0) >= thr.opp_cvr_green OR COALESCE(w.cvr_one_vs_two_ratio, 0) >= thr.opp_cvr_green THEN 'green'
            WHEN w.kpi_impression_share < thr.opp_is_green  AND w.kpi_ctr_advantage >= thr.opp_ctr_green THEN 'green'
            WHEN w.kpi_impression_share < thr.opp_is_yellow AND w.kpi_ctr_advantage >= thr.opp_ctr_green THEN 'yellow'
            ELSE 'red'
        END AS opportunity_color,
        CASE
            WHEN COALESCE(w.cvr_same_vs_two_ratio, 0) >= thr.opp_cvr_green OR COALESCE(w.cvr_one_vs_two_ratio, 0) >= thr.opp_cvr_green THEN 'fast_delivery_uplift'
            WHEN w.kpi_impression_share < thr.opp_is_green  AND w.kpi_ctr_advantage >= thr.opp_ctr_green THEN 'visibility_gap'
            WHEN w.kpi_impression_share < thr.opp_is_yellow AND w.kpi_ctr_advantage >= thr.opp_ctr_green THEN 'moderate_visibility_gap'
            ELSE 'no_clear_opportunity'
        END AS opportunity_code,
        CASE
            WHEN COALESCE(w.cvr_same_vs_two_ratio, 0) >= thr.opp_cvr_green OR COALESCE(w.cvr_one_vs_two_ratio, 0) >= thr.opp_cvr_green
              THEN 'Fast-delivery conversion uplift; increasing same/one-day availability may raise profitability.'
            WHEN w.kpi_impression_share < thr.opp_is_green  AND w.kpi_ctr_advantage >= thr.opp_ctr_green THEN 'High CTR advantage but low impressions: scale visibility.'
            WHEN w.kpi_impression_share < thr.opp_is_yellow AND w.kpi_ctr_advantage >= thr.opp_ctr_green THEN 'CTR advantage with moderate impressions: growth possible.'
            ELSE 'No clear visibility opportunity.'
        END AS opportunity_description,

        -- Ceiling signal
        CASE
            WHEN w.kpi_impression_share >= thr.ceil_is_red    AND w.kpi_ctr_advantage >= thr.ceil_ctr_red    THEN 'red'
            WHEN w.kpi_impression_share >= thr.ceil_is_yellow AND w.kpi_ctr_advantage >= thr.ceil_ctr_yellow THEN 'yellow'
            ELSE 'green'
        END AS threshold_color,
        CASE
            WHEN w.kpi_impression_share >= thr.ceil_is_red    AND w.kpi_ctr_advantage >= thr.ceil_ctr_red    THEN 'visibility_ceiling'
            WHEN w.kpi_impression_share >= thr.ceil_is_yellow AND w.kpi_ctr_advantage >= thr.ceil_ctr_yellow THEN 'approaching_ceiling'
            ELSE 'no_ceiling'
        END AS threshold_code,
        CASE
            WHEN w.kpi_impression_share >= thr.ceil_is_red    AND w.kpi_ctr_advantage >= thr.ceil_ctr_red    THEN 'Likely visibility ceiling; growth limited by distribution.'
            WHEN w.kpi_impression_share >= thr.ceil_is_yellow AND w.kpi_ctr_advantage >= thr.ceil_ctr_yellow THEN 'Approaching visibility ceiling.'
            ELSE 'No ceiling detected.'
        END AS threshold_description
    FROM cvr_base w
    JOIN company_thresholds thr ON thr.company_id = CAST(w.company_id AS BIGINT)
),

final AS (
    SELECT
        sb.*,
        CASE
            WHEN sb.kpi_impression_share_wow > thr.trend_green AND sb.kpi_impression_share_wolast4 > thr.trend_green AND sb.kpi_impression_share_wolast12 > thr.trend_green THEN 'green'
            WHEN sb.kpi_impression_share_wow < thr.trend_red   AND sb.kpi_impression_share_wolast4 < thr.trend_red   AND sb.kpi_impression_share_wolast12 < thr.trend_red   THEN 'red'
            ELSE 'yellow'
        END AS impression_trend_signal,
        CASE
            WHEN sb.kpi_click_share_wow > thr.trend_green AND sb.kpi_click_share_wolast4 > thr.trend_green AND sb.kpi_click_share_wolast12 > thr.trend_green THEN 'green'
            WHEN sb.kpi_click_share_wow < thr.trend_red   AND sb.kpi_click_share_wolast4 < thr.trend_red   AND sb.kpi_click_share_wolast12 < thr.trend_red   THEN 'red'
            ELSE 'yellow'
        END AS click_trend_signal,
        CASE
            WHEN sb.kpi_cart_add_rate_wow > thr.trend_green AND sb.kpi_cart_add_rate_wolast4 > thr.trend_green AND sb.kpi_cart_add_rate_wolast12 > thr.trend_green THEN 'green'
            WHEN sb.kpi_cart_add_rate_wow < thr.trend_red   AND sb.kpi_cart_add_rate_wolast4 < thr.trend_red   AND sb.kpi_cart_add_rate_wolast12 < thr.trend_red   THEN 'red'
            ELSE 'yellow'
        END AS cart_add_trend_signal,
        CASE
            WHEN sb.kpi_purchase_rate_wow > thr.trend_green AND sb.kpi_purchase_rate_wolast4 > thr.trend_green AND sb.kpi_purchase_rate_wolast12 > thr.trend_green THEN 'green'
            WHEN sb.kpi_purchase_rate_wow < thr.trend_red   AND sb.kpi_purchase_rate_wolast4 < thr.trend_red   AND sb.kpi_purchase_rate_wolast12 < thr.trend_red   THEN 'red'
            ELSE 'yellow'
        END AS purchase_trend_signal,
        CASE
            WHEN sb.kpi_ctr_advantage_wow > thr.trend_green AND sb.kpi_ctr_advantage_wolast4 > thr.trend_green AND sb.kpi_ctr_advantage_wolast12 > thr.trend_green THEN 'green'
            WHEN sb.kpi_ctr_advantage_wow < thr.trend_red   AND sb.kpi_ctr_advantage_wolast4 < thr.trend_red   AND sb.kpi_ctr_advantage_wolast12 < thr.trend_red   THEN 'red'
            ELSE 'yellow'
        END AS ctr_advantage_trend_signal
    FROM signal_base sb
    JOIN company_thresholds thr ON thr.company_id = CAST(sb.company_id AS BIGINT)
)

SELECT
    -- Identity / Dimensions
    f.company                                                        AS "Company",
    f.company_id                                                     AS "Company ID",
    f.marketplace                                                    AS "Marketplace",
    f.product_family                                                 AS "Product Family",
    f.marketplace_country_code                                       AS "Country Code",
    f.brand                                                          AS "Brand",
    f.title                                                          AS "Product Title",
    f.parent_asin                                                    AS "Parent ASIN",
    f.asin                                                           AS "ASIN",
    f.row_type                                                       AS "Row Type",
    f.revenue_abcd_class                                             AS "Revenue ABCD Class",
    f.pareto_abc_class                                               AS "Pareto ABC Class (Revenue)",
    f.pareto_impression_class                                        AS "Pareto ABC Class (Impressions)",
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
    f.impressiondata_totalqueryimpressioncount                        AS "Total Query Impressions",
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
    f.kpi_cart_add_rate                                              AS "Cart Add Rate",
    f.kpi_purchase_rate                                              AS "Purchase Rate",
    f.kpi_ctr_advantage                                              AS "CTR Advantage",

    -- WoW / Trends
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
    f.cart_add_trend_signal                                          AS "Cart Add Trend Signal",
    f.purchase_trend_signal                                          AS "Purchase Trend Signal",
    f.ctr_advantage_trend_signal                                     AS "CTR Advantage Trend Signal"
FROM final f