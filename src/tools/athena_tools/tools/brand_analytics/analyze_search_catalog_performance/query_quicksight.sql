WITH base_data AS (
    SELECT
        r.company AS "Company Name",
        r.marketplace AS "Marketplace",
        r.marketplace_country_code AS "Country Code",
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

with_deltas AS (
    SELECT
        b.*,
        -- Click Rate Deltas (WoW, vs Last 4 Weeks, vs Last 12 Weeks)
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

        -- Delivery Speed CVR Ratios (Same Day vs 2-Day and 1-Day vs 2-Day)
        CASE 
            WHEN b."Same Day Shipping Clicks" > 0 AND b."2d Shipping Clicks" > 0 
            THEN (CAST(b."Same Day Shipping Purchases" AS DOUBLE) / b."Same Day Shipping Clicks") / (NULLIF(CAST(b."2d Shipping Purchases" AS DOUBLE) / b."2d Shipping Clicks", 0))
            ELSE NULL 
        END AS "Same Day vs 2d CVR Ratio",
        CASE 
            WHEN b."1d Shipping Clicks" > 0 AND b."2d Shipping Clicks" > 0 
            THEN (CAST(b."1d Shipping Purchases" AS DOUBLE) / b."1d Shipping Clicks") / (NULLIF(CAST(b."2d Shipping Purchases" AS DOUBLE) / b."2d Shipping Clicks", 0))
            ELSE NULL 
        END AS "1d vs 2d CVR Ratio"
    FROM base_data b
)

-- main SELECT
-- final_signals AS (
    SELECT
        w.*,
        -- 1. STRENGTH SIGNAL
        CASE
            WHEN w."KPI Click Rate" >= 0.12 AND w."KPI Purchase Rate" >= 0.09 THEN 'green'
            WHEN w."KPI Click Rate" >= 0.08 AND w."KPI Purchase Rate" >= 0.07 THEN 'yellow'
            ELSE 'red'
        END AS "Strength Color",
        CASE
            WHEN w."KPI Click Rate" >= 0.12 AND w."KPI Purchase Rate" >= 0.09 THEN 'Strong Clickability and Conversion'
            WHEN w."KPI Click Rate" >= 0.08 AND w."KPI Purchase Rate" >= 0.07 THEN 'Acceptable Performance'
            ELSE 'Weak Click or Conversion'
        END AS "Strength Description",

        -- 2. WEAKNESS SIGNAL
        CASE
            WHEN w."Click Rate WoW" < -0.02 AND w."Purchase Rate WoW" < -0.02 THEN 'red'
            WHEN w."KPI Click Rate" < 0.08 OR w."KPI Purchase Rate" < 0.07 THEN 'red'
            WHEN w."KPI Cart Add Rate" < 0.12 THEN 'yellow'
            ELSE 'green'
        END AS "Weakness Color",
        CASE
            WHEN w."Click Rate WoW" < -0.02 AND w."Purchase Rate WoW" < -0.02 THEN 'Engagement Decline'
            WHEN w."KPI Click Rate" < 0.08 THEN 'Low Click Rate'
            WHEN w."KPI Purchase Rate" < 0.07 THEN 'Low Conversion Rate'
            WHEN w."KPI Cart Add Rate" < 0.12 THEN 'Low Cart Add Rate'
            ELSE 'No Major Weakness'
        END AS "Weakness Code",

        -- 3. OPPORTUNITY SIGNAL
        CASE
            WHEN COALESCE(w."Same Day vs 2d CVR Ratio", 0) >= 1.3 OR COALESCE(w."1d vs 2d CVR Ratio", 0) >= 1.3 THEN 'green'
            WHEN w."KPI Purchase Rate" >= 0.09 AND w."KPI Click Rate" >= 0.08 THEN 'yellow'
            ELSE 'red'
        END AS "Opportunity Color",
        CASE
            WHEN COALESCE(w."Same Day vs 2d CVR Ratio", 0) >= 1.3 OR COALESCE(w."1d vs 2d CVR Ratio", 0) >= 1.3 THEN 'Fast Delivery Uplift Available'
            WHEN w."KPI Purchase Rate" >= 0.09 AND w."KPI Click Rate" >= 0.08 THEN 'Scale Traffic Potential'
            ELSE 'No Clear Opportunity'
        END AS "Opportunity Description",

        -- 4. THRESHOLD / CEILING SIGNAL
        CASE
            WHEN w."KPI Click Rate" >= 0.16 AND w."KPI Purchase Rate" >= 0.10 THEN 'red'
            WHEN w."KPI Click Rate" >= 0.12 AND w."KPI Purchase Rate" >= 0.09 THEN 'yellow'
            ELSE 'green'
        END AS "Ceiling Color",
        CASE
            WHEN w."KPI Click Rate" >= 0.16 AND w."KPI Purchase Rate" >= 0.10 THEN 'Likely Near Ceiling'
            WHEN w."KPI Click Rate" >= 0.12 AND w."KPI Purchase Rate" >= 0.09 THEN 'Approaching Ceiling'
            ELSE 'Growth Room Available'
        END AS "Ceiling Status",

        -- 5. TREND SIGNALS (The aggregated logic for click, cart, and purchase trends)
        CASE
            WHEN w."Click Rate WoW" > 0.02 AND w."Click Rate vs Last 4w" > 0.02 AND w."Click Rate vs Last 12w" > 0.02 THEN 'green'
            WHEN w."Click Rate WoW" < -0.02 AND w."Click Rate vs Last 4w" < -0.02 AND w."Click Rate vs Last 12w" < -0.02 THEN 'red'
            ELSE 'yellow'
        END AS "Click Trend Color",
        CASE
            WHEN w."Cart Add Rate WoW" > 0.02 AND w."Cart Add Rate vs Last 4w" > 0.02 AND w."Cart Add Rate vs Last 12w" > 0.02 THEN 'green'
            WHEN w."Cart Add Rate WoW" < -0.02 AND w."Cart Add Rate vs Last 4w" < -0.02 AND w."Cart Add Rate vs Last 12w" < -0.02 THEN 'red'
            ELSE 'yellow'
        END AS "Cart Add Trend Color",
        CASE
            WHEN w."Purchase Rate WoW" > 0.02 AND w."Purchase Rate vs Last 4w" > 0.02 AND w."Purchase Rate vs Last 12w" > 0.02 THEN 'green'
            WHEN w."Purchase Rate WoW" < -0.02 AND w."Purchase Rate vs Last 4w" < -0.02 AND w."Purchase Rate vs Last 12w" < -0.02 THEN 'red'
            ELSE 'yellow'
        END AS "Purchase Trend Color"
    FROM with_deltas w