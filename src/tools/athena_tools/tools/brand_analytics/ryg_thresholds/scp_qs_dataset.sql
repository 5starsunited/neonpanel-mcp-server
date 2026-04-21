WITH

-- ── 0. Deduplicate thresholds: latest row wins per (company_id, tool, signal_group, metric, color) ──────
ryg_deduped AS (
    SELECT
        company_id,
        tool,
        signal_group,
        metric,
        color,
        threshold_value
    FROM (
        SELECT *,
            ROW_NUMBER() OVER (
                PARTITION BY COALESCE(CAST(company_id AS VARCHAR), '__default__'),
                             tool, signal_group, metric, color
                ORDER BY updated_at DESC
            ) AS rn
        FROM "brand_analytics_iceberg"."ryg_thresholds"
        WHERE tool IN ('scp', 'global')
    )
    WHERE rn = 1
),

-- ── 1. Pivot: one row per company_id with all needed threshold values ────────────────────────────────────
-- Prefer company-specific override (company_id = N); fall back to system default (company_id IS NULL).
company_thresholds AS (
    SELECT
        c.company_id,

        -- STRENGTH (scp)
        -- t.company_id IS NOT NULL → company override (join already guarantees it equals c.company_id)
        -- t.company_id IS NULL     → system default
        COALESCE(
            MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool = 'scp' AND t.signal_group = 'strength' AND t.metric = 'click_rate'    AND t.color = 'green'  THEN t.threshold_value END),
            MAX(CASE WHEN t.company_id IS NULL     AND t.tool = 'scp' AND t.signal_group = 'strength' AND t.metric = 'click_rate'    AND t.color = 'green'  THEN t.threshold_value END)
        ) AS str_cr_green,
        COALESCE(
            MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool = 'scp' AND t.signal_group = 'strength' AND t.metric = 'click_rate'    AND t.color = 'yellow' THEN t.threshold_value END),
            MAX(CASE WHEN t.company_id IS NULL     AND t.tool = 'scp' AND t.signal_group = 'strength' AND t.metric = 'click_rate'    AND t.color = 'yellow' THEN t.threshold_value END)
        ) AS str_cr_yellow,
        COALESCE(
            MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool = 'scp' AND t.signal_group = 'strength' AND t.metric = 'purchase_rate' AND t.color = 'green'  THEN t.threshold_value END),
            MAX(CASE WHEN t.company_id IS NULL     AND t.tool = 'scp' AND t.signal_group = 'strength' AND t.metric = 'purchase_rate' AND t.color = 'green'  THEN t.threshold_value END)
        ) AS str_pr_green,
        COALESCE(
            MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool = 'scp' AND t.signal_group = 'strength' AND t.metric = 'purchase_rate' AND t.color = 'yellow' THEN t.threshold_value END),
            MAX(CASE WHEN t.company_id IS NULL     AND t.tool = 'scp' AND t.signal_group = 'strength' AND t.metric = 'purchase_rate' AND t.color = 'yellow' THEN t.threshold_value END)
        ) AS str_pr_yellow,

        -- WEAKNESS (scp)
        COALESCE(
            MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool = 'scp' AND t.signal_group = 'weakness' AND t.metric = 'delta'         AND t.color = 'red'    THEN t.threshold_value END),
            MAX(CASE WHEN t.company_id IS NULL     AND t.tool = 'scp' AND t.signal_group = 'weakness' AND t.metric = 'delta'         AND t.color = 'red'    THEN t.threshold_value END)
        ) AS wk_delta_red,
        COALESCE(
            MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool = 'scp' AND t.signal_group = 'weakness' AND t.metric = 'click_rate'    AND t.color = 'red'    THEN t.threshold_value END),
            MAX(CASE WHEN t.company_id IS NULL     AND t.tool = 'scp' AND t.signal_group = 'weakness' AND t.metric = 'click_rate'    AND t.color = 'red'    THEN t.threshold_value END)
        ) AS wk_cr_red,
        COALESCE(
            MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool = 'scp' AND t.signal_group = 'weakness' AND t.metric = 'purchase_rate' AND t.color = 'red'    THEN t.threshold_value END),
            MAX(CASE WHEN t.company_id IS NULL     AND t.tool = 'scp' AND t.signal_group = 'weakness' AND t.metric = 'purchase_rate' AND t.color = 'red'    THEN t.threshold_value END)
        ) AS wk_pr_red,
        COALESCE(
            MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool = 'scp' AND t.signal_group = 'weakness' AND t.metric = 'cart_add_rate' AND t.color = 'yellow' THEN t.threshold_value END),
            MAX(CASE WHEN t.company_id IS NULL     AND t.tool = 'scp' AND t.signal_group = 'weakness' AND t.metric = 'cart_add_rate' AND t.color = 'yellow' THEN t.threshold_value END)
        ) AS wk_car_yellow,

        -- OPPORTUNITY (scp)
        COALESCE(
            MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool = 'scp' AND t.signal_group = 'opportunity' AND t.metric = 'cvr_ratio'     AND t.color = 'green'  THEN t.threshold_value END),
            MAX(CASE WHEN t.company_id IS NULL     AND t.tool = 'scp' AND t.signal_group = 'opportunity' AND t.metric = 'cvr_ratio'     AND t.color = 'green'  THEN t.threshold_value END)
        ) AS opp_cvr_green,
        COALESCE(
            MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool = 'scp' AND t.signal_group = 'opportunity' AND t.metric = 'purchase_rate' AND t.color = 'yellow' THEN t.threshold_value END),
            MAX(CASE WHEN t.company_id IS NULL     AND t.tool = 'scp' AND t.signal_group = 'opportunity' AND t.metric = 'purchase_rate' AND t.color = 'yellow' THEN t.threshold_value END)
        ) AS opp_pr_yellow,
        COALESCE(
            MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool = 'scp' AND t.signal_group = 'opportunity' AND t.metric = 'click_rate'    AND t.color = 'yellow' THEN t.threshold_value END),
            MAX(CASE WHEN t.company_id IS NULL     AND t.tool = 'scp' AND t.signal_group = 'opportunity' AND t.metric = 'click_rate'    AND t.color = 'yellow' THEN t.threshold_value END)
        ) AS opp_cr_yellow,

        -- CEILING (scp)
        COALESCE(
            MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool = 'scp' AND t.signal_group = 'ceiling' AND t.metric = 'click_rate'    AND t.color = 'red'    THEN t.threshold_value END),
            MAX(CASE WHEN t.company_id IS NULL     AND t.tool = 'scp' AND t.signal_group = 'ceiling' AND t.metric = 'click_rate'    AND t.color = 'red'    THEN t.threshold_value END)
        ) AS ceil_cr_red,
        COALESCE(
            MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool = 'scp' AND t.signal_group = 'ceiling' AND t.metric = 'click_rate'    AND t.color = 'yellow' THEN t.threshold_value END),
            MAX(CASE WHEN t.company_id IS NULL     AND t.tool = 'scp' AND t.signal_group = 'ceiling' AND t.metric = 'click_rate'    AND t.color = 'yellow' THEN t.threshold_value END)
        ) AS ceil_cr_yellow,
        COALESCE(
            MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool = 'scp' AND t.signal_group = 'ceiling' AND t.metric = 'purchase_rate' AND t.color = 'red'    THEN t.threshold_value END),
            MAX(CASE WHEN t.company_id IS NULL     AND t.tool = 'scp' AND t.signal_group = 'ceiling' AND t.metric = 'purchase_rate' AND t.color = 'red'    THEN t.threshold_value END)
        ) AS ceil_pr_red,
        COALESCE(
            MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool = 'scp' AND t.signal_group = 'ceiling' AND t.metric = 'purchase_rate' AND t.color = 'yellow' THEN t.threshold_value END),
            MAX(CASE WHEN t.company_id IS NULL     AND t.tool = 'scp' AND t.signal_group = 'ceiling' AND t.metric = 'purchase_rate' AND t.color = 'yellow' THEN t.threshold_value END)
        ) AS ceil_pr_yellow,

        -- GLOBAL TREND
        COALESCE(
            MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool = 'global' AND t.signal_group = 'trend' AND t.metric = 'delta' AND t.color = 'green' THEN t.threshold_value END),
            MAX(CASE WHEN t.company_id IS NULL     AND t.tool = 'global' AND t.signal_group = 'trend' AND t.metric = 'delta' AND t.color = 'green' THEN t.threshold_value END)
        ) AS trend_delta_green,
        COALESCE(
            MAX(CASE WHEN t.company_id IS NOT NULL AND t.tool = 'global' AND t.signal_group = 'trend' AND t.metric = 'delta' AND t.color = 'red'   THEN t.threshold_value END),
            MAX(CASE WHEN t.company_id IS NULL     AND t.tool = 'global' AND t.signal_group = 'trend' AND t.metric = 'delta' AND t.color = 'red'   THEN t.threshold_value END)
        ) AS trend_delta_red

    FROM (
        SELECT DISTINCT CAST(company_id AS BIGINT) AS company_id
        FROM "brand_analytics_iceberg"."search_catalog_performance_snapshot"
        WHERE lower(row_type) = 'child'
    ) c
    LEFT JOIN ryg_deduped t
        ON (t.company_id = c.company_id OR t.company_id IS NULL)
    GROUP BY c.company_id
),

-- ── 2. Source data ───────────────────────────────────────────────────────────
base_data AS (
    SELECT
        r.company AS "Company",
        r.marketplace AS "Marketplace",
        r.marketplace_country_code AS "Country Code",
        r.product_family AS "Product Family",
        r.parent_asin AS "Parent ASIN",
        r.asin AS "ASIN",
        r.brand AS "Brand",
        r.title AS "Product Title",
        r.revenue_abcd_class AS "Revenue ABCD Class",
        r.pareto_abc_class AS "Pareto ABC Class",
        r.week_start AS "Week Start Date",
        r.year AS "Year",
        r.report_date AS "Report Date",
        r.startdate AS "Period Start",
        r.enddate AS "Period End",
        -- Raw Metrics
        r.impressiondata_impressioncount AS "Total Impressions",
        r.clickdata_clickcount AS "Total Clicks",
        r.cartadddata_cartaddcount AS "Total Cart Adds",
        r.purchasedata_purchasecount AS "Total Purchases",
        r.purchasedata_searchtrafficsales_amount AS "Search Sales Amount",
        r.purchasedata_searchtrafficsales_currencycode AS "Currency",
        -- Delivery Speed Metrics
        r.cartadddata_onedayshippingcartaddcount AS "1d Shipping Cart Adds",
        r.cartadddata_samedayshippingcartaddcount AS "Same Day Shipping Cart Adds",
        r.cartadddata_twodayshippingcartaddcount AS "2d Shipping Cart Adds",
        r.clickdata_onedayshippingclickcount AS "1d Shipping Clicks",
        r.clickdata_samedayshippingclickcount AS "Same Day Shipping Clicks",
        r.clickdata_twodayshippingclickcount AS "2d Shipping Clicks",
        r.purchasedata_onedayshippingpurchasecount AS "1d Shipping Purchases",
        r.purchasedata_samedayshippingpurchasecount AS "Same Day Shipping Purchases",
        r.purchasedata_twodayshippingpurchasecount AS "2d Shipping Purchases",
        r.impressiondata_onedayshippingimpressioncount AS "1d Shipping Impressions",
        r.impressiondata_samedayshippingimpressioncount AS "Same Day Shipping Impressions",
        r.impressiondata_twodayshippingimpressioncount AS "2d Shipping Impressions",
        -- KPIs
        r.kpi_click_rate AS "KPI Click Rate",
        r.kpi_cart_add_rate AS "KPI Cart Add Rate",
        r.kpi_purchase_rate AS "KPI Purchase Rate",
        r.kpi_sales_per_click AS "Sales Per Click",
        r.kpi_sales_per_impression AS "Sales Per Impression",
        r.company_id AS "Company ID",
        r.row_type AS "Row Type"
    FROM "brand_analytics_iceberg"."search_catalog_performance_snapshot" r
    WHERE lower(r.row_type) = 'child'
),

-- ── 3. Delta calculations ────────────────────────────────────────────────────
with_deltas AS (
    SELECT
        b.*,
        -- Click Rate Deltas (Calculated via Window Functions)
        b."KPI Click Rate" - LAG(b."KPI Click Rate") OVER (PARTITION BY b."Company ID", b."Country Code", b."ASIN" ORDER BY b."Week Start Date") AS "Click Rate WoW",
        b."KPI Click Rate" - AVG(b."KPI Click Rate") OVER (PARTITION BY b."Company ID", b."Country Code", b."ASIN" ORDER BY b."Week Start Date" ROWS BETWEEN 4 PRECEDING AND 1 PRECEDING) AS "Click Rate vs Last 4w",
        b."KPI Click Rate" - AVG(b."KPI Click Rate") OVER (PARTITION BY b."Company ID", b."Country Code", b."ASIN" ORDER BY b."Week Start Date" ROWS BETWEEN 12 PRECEDING AND 1 PRECEDING) AS "Click Rate vs Last 12w",

        -- Cart Add Rate Deltas
        b."KPI Cart Add Rate" - LAG(b."KPI Cart Add Rate") OVER (PARTITION BY b."Company ID", b."Country Code", b."ASIN" ORDER BY b."Week Start Date") AS "Cart Add Rate WoW",
        b."KPI Cart Add Rate" - AVG(b."KPI Cart Add Rate") OVER (PARTITION BY b."Company ID", b."Country Code", b."ASIN" ORDER BY b."Week Start Date" ROWS BETWEEN 4 PRECEDING AND 1 PRECEDING) AS "Cart Add Rate vs Last 4w",
        b."KPI Cart Add Rate" - AVG(b."KPI Cart Add Rate") OVER (PARTITION BY b."Company ID", b."Country Code", b."ASIN" ORDER BY b."Week Start Date" ROWS BETWEEN 12 PRECEDING AND 1 PRECEDING) AS "Cart Add Rate vs Last 12w",

        -- Purchase Rate Deltas
        b."KPI Purchase Rate" - LAG(b."KPI Purchase Rate") OVER (PARTITION BY b."Company ID", b."Country Code", b."ASIN" ORDER BY b."Week Start Date") AS "Purchase Rate WoW",
        b."KPI Purchase Rate" - AVG(b."KPI Purchase Rate") OVER (PARTITION BY b."Company ID", b."Country Code", b."ASIN" ORDER BY b."Week Start Date" ROWS BETWEEN 4 PRECEDING AND 1 PRECEDING) AS "Purchase Rate vs Last 4w",
        b."KPI Purchase Rate" - AVG(b."KPI Purchase Rate") OVER (PARTITION BY b."Company ID", b."Country Code", b."ASIN" ORDER BY b."Week Start Date" ROWS BETWEEN 12 PRECEDING AND 1 PRECEDING) AS "Purchase Rate vs Last 12w",

        -- Delivery Speed CVR Ratios
        CASE
            WHEN b."Same Day Shipping Clicks" > 0 AND b."2d Shipping Clicks" > 0
            THEN (CAST(b."Same Day Shipping Purchases" AS DOUBLE) / b."Same Day Shipping Clicks") / NULLIF(CAST(b."2d Shipping Purchases" AS DOUBLE) / b."2d Shipping Clicks", 0)
            ELSE NULL
        END AS "Same Day vs 2d CVR Ratio",
        CASE
            WHEN b."1d Shipping Clicks" > 0 AND b."2d Shipping Clicks" > 0
            THEN (CAST(b."1d Shipping Purchases" AS DOUBLE) / b."1d Shipping Clicks") / NULLIF(CAST(b."2d Shipping Purchases" AS DOUBLE) / b."2d Shipping Clicks", 0)
            ELSE NULL
        END AS "1d vs 2d CVR Ratio"
    FROM base_data b
)

-- ── 4. Apply signals using per-company thresholds ────────────────────────────
SELECT
    w.*,
    -- 1. STRENGTH SIGNAL
    CASE
        WHEN w."KPI Click Rate" >= thr.str_cr_green  AND w."KPI Purchase Rate" >= thr.str_pr_green  THEN 'green'
        WHEN w."KPI Click Rate" >= thr.str_cr_yellow AND w."KPI Purchase Rate" >= thr.str_pr_yellow THEN 'yellow'
        ELSE 'red'
    END AS "Strength Color",
    CASE
        WHEN w."KPI Click Rate" >= thr.str_cr_green  AND w."KPI Purchase Rate" >= thr.str_pr_green  THEN 'Strong Clickability and Conversion'
        WHEN w."KPI Click Rate" >= thr.str_cr_yellow AND w."KPI Purchase Rate" >= thr.str_pr_yellow THEN 'Acceptable Performance'
        ELSE 'Weak Click or Conversion'
    END AS "Strength Description",

    -- 2. WEAKNESS SIGNAL
    CASE
        WHEN w."Click Rate WoW"    < thr.wk_delta_red AND w."Purchase Rate WoW" < thr.wk_delta_red THEN 'red'
        WHEN w."KPI Click Rate"    < thr.wk_cr_red    OR  w."KPI Purchase Rate" < thr.wk_pr_red    THEN 'red'
        WHEN w."KPI Cart Add Rate" < thr.wk_car_yellow                                             THEN 'yellow'
        ELSE 'green'
    END AS "Weakness Color",
    CASE
        WHEN w."Click Rate WoW"    < thr.wk_delta_red AND w."Purchase Rate WoW" < thr.wk_delta_red THEN 'Engagement Decline'
        WHEN w."KPI Click Rate"    < thr.wk_cr_red                                                 THEN 'Low Click Rate'
        WHEN w."KPI Purchase Rate" < thr.wk_pr_red                                                 THEN 'Low Conversion Rate'
        WHEN w."KPI Cart Add Rate" < thr.wk_car_yellow                                             THEN 'Low Cart Add Rate'
        ELSE 'No Major Weakness'
    END AS "Weakness Code",

    -- 3. OPPORTUNITY SIGNAL
    CASE
        WHEN COALESCE(w."Same Day vs 2d CVR Ratio", 0) >= thr.opp_cvr_green
          OR COALESCE(w."1d vs 2d CVR Ratio",        0) >= thr.opp_cvr_green THEN 'green'
        WHEN w."KPI Purchase Rate" >= thr.opp_pr_yellow AND w."KPI Click Rate" >= thr.opp_cr_yellow THEN 'yellow'
        ELSE 'red'
    END AS "Opportunity Color",
    CASE
        WHEN COALESCE(w."Same Day vs 2d CVR Ratio", 0) >= thr.opp_cvr_green
          OR COALESCE(w."1d vs 2d CVR Ratio",        0) >= thr.opp_cvr_green THEN 'Fast Delivery Uplift Available'
        WHEN w."KPI Purchase Rate" >= thr.opp_pr_yellow AND w."KPI Click Rate" >= thr.opp_cr_yellow THEN 'Scale Traffic Potential'
        ELSE 'No Clear Opportunity'
    END AS "Opportunity Description",

    -- 4. CEILING SIGNAL
    CASE
        WHEN w."KPI Click Rate" >= thr.ceil_cr_red    AND w."KPI Purchase Rate" >= thr.ceil_pr_red    THEN 'red'
        WHEN w."KPI Click Rate" >= thr.ceil_cr_yellow AND w."KPI Purchase Rate" >= thr.ceil_pr_yellow THEN 'yellow'
        ELSE 'green'
    END AS "Ceiling Color",
    CASE
        WHEN w."KPI Click Rate" >= thr.ceil_cr_red    AND w."KPI Purchase Rate" >= thr.ceil_pr_red    THEN 'Likely Near Ceiling'
        WHEN w."KPI Click Rate" >= thr.ceil_cr_yellow AND w."KPI Purchase Rate" >= thr.ceil_pr_yellow THEN 'Approaching Ceiling'
        ELSE 'Growth Room Available'
    END AS "Ceiling Status",

    -- 5. TREND SIGNALS
    CASE
        WHEN w."Click Rate WoW" > thr.trend_delta_green AND w."Click Rate vs Last 4w" > thr.trend_delta_green AND w."Click Rate vs Last 12w" > thr.trend_delta_green THEN 'green'
        WHEN w."Click Rate WoW" < thr.trend_delta_red   AND w."Click Rate vs Last 4w" < thr.trend_delta_red   AND w."Click Rate vs Last 12w" < thr.trend_delta_red   THEN 'red'
        ELSE 'yellow'
    END AS "Click Trend Color",
    CASE
        WHEN w."Cart Add Rate WoW" > thr.trend_delta_green AND w."Cart Add Rate vs Last 4w" > thr.trend_delta_green AND w."Cart Add Rate vs Last 12w" > thr.trend_delta_green THEN 'green'
        WHEN w."Cart Add Rate WoW" < thr.trend_delta_red   AND w."Cart Add Rate vs Last 4w" < thr.trend_delta_red   AND w."Cart Add Rate vs Last 12w" < thr.trend_delta_red   THEN 'red'
        ELSE 'yellow'
    END AS "Cart Add Trend Color",
    CASE
        WHEN w."Purchase Rate WoW" > thr.trend_delta_green AND w."Purchase Rate vs Last 4w" > thr.trend_delta_green AND w."Purchase Rate vs Last 12w" > thr.trend_delta_green THEN 'green'
        WHEN w."Purchase Rate WoW" < thr.trend_delta_red   AND w."Purchase Rate vs Last 4w" < thr.trend_delta_red   AND w."Purchase Rate vs Last 12w" < thr.trend_delta_red   THEN 'red'
        ELSE 'yellow'
    END AS "Purchase Trend Color"

FROM with_deltas w
JOIN company_thresholds thr ON thr.company_id = CAST(w."Company ID" AS BIGINT)