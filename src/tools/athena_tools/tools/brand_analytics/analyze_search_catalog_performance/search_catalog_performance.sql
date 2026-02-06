-- ETL: search_catalog_performance_snapshot
-- Purpose: Build a snapshot with child + parent ASIN rows and WoW/rolling deltas.

WITH asin_attributes AS (
    SELECT
        child_asin AS asin,
        marketplace_id,
        MIN(revenue_abcd_class) AS revenue_abcd_class,
        MIN(pareto_abc_class) AS pareto_abc_class,
        MIN(brand) AS brand,
        SUM(revenue_share) AS revenue_share
    FROM awsdatacatalog.inventory_planning.last_snapshot_inventory_planning
    GROUP BY 1, 2
),

raw AS (
    SELECT
        asin,
        cartadddata_cartaddcount,
        cartadddata_cartaddedmedianprice_amount,
        cartadddata_cartaddedmedianprice_currencycode,
        cartadddata_onedayshippingcartaddcount,
        cartadddata_samedayshippingcartaddcount,
        cartadddata_twodayshippingcartaddcount,
        clickdata_clickcount,
        clickdata_clickedmedianprice_amount,
        clickdata_clickedmedianprice_currencycode,
        clickdata_clickrate,
        clickdata_onedayshippingclickcount,
        clickdata_samedayshippingclickcount,
        clickdata_twodayshippingclickcount,
        CAST(date AS DATE) AS report_date,
        enddate,
        impressiondata_impressioncount,
        impressiondata_impressionmedianprice_amount,
        impressiondata_impressionmedianprice_currencycode,
        impressiondata_onedayshippingimpressioncount,
        impressiondata_samedayshippingimpressioncount,
        impressiondata_twodayshippingimpressioncount,
        purchasedata_conversionrate,
        purchasedata_onedayshippingpurchasecount,
        purchasedata_purchasecount,
        purchasedata_purchasemedianprice_amount,
        purchasedata_purchasemedianprice_currencycode,
        purchasedata_samedayshippingpurchasecount,
        purchasedata_searchtrafficsales_amount,
        purchasedata_searchtrafficsales_currencycode,
        purchasedata_twodayshippingpurchasecount,
        rspec_marketplaceids,
        startdate,
        ingest_ts_utc,
        CAST(ingest_company_id AS BIGINT) AS company_id,
        ingest_seller_id AS amazon_seller_id,
        week_start,
        year
    FROM "{{catalog}}"."sp_api_iceberg"."brand_analytics_search_catalog_performance_report"
),

marketplaces_dim AS (
    SELECT
        CAST(amazon_marketplace_id AS VARCHAR) AS amazon_marketplace_id,
        lower(country) AS country,
        lower(code) AS country_code,
        lower(name) AS marketplace,
        lower(domain) AS domain,
        id AS marketplace_id
    FROM "{{catalog}}"."neonpanel_iceberg"."amazon_marketplaces"
),

base_child AS (
    SELECT
        c.name AS company,
        m.marketplace AS marketplace,
        m.country_code AS marketplace_country_code,
        COALESCE(al.parent_asin, r.asin) AS parent_asin,
        attr.revenue_abcd_class,
        attr.pareto_abc_class,
        attr.brand,
        attr.revenue_share,
        al.title,
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
        -- KPI base calculations
        r.clickdata_clickrate AS kpi_click_rate,
        CASE
            WHEN r.impressiondata_impressioncount = 0 THEN NULL
            ELSE r.cartadddata_cartaddcount / r.impressiondata_impressioncount
        END AS kpi_cart_add_rate,
        r.purchasedata_conversionrate AS kpi_purchase_rate,
        CASE
            WHEN r.clickdata_clickcount = 0 THEN NULL
            ELSE r.purchasedata_searchtrafficsales_amount / r.clickdata_clickcount
        END AS kpi_sales_per_click,
        CASE
            WHEN r.impressiondata_impressioncount = 0 THEN NULL
            ELSE r.purchasedata_searchtrafficsales_amount / r.impressiondata_impressioncount
        END AS kpi_sales_per_impression,
        'child' AS row_type
    FROM raw r
    LEFT JOIN marketplaces_dim m
        ON lower(m.amazon_marketplace_id) = lower(r.rspec_marketplaceids)
    LEFT JOIN athenadatacatalog.neonpanel.amazon_listings al
        ON al.asin = r.asin
        AND al.marketplace_id = m.marketplace_id
    LEFT JOIN awsdatacatalog.neonpanel_iceberg.app_companies c
        ON CAST(c.id AS VARCHAR) = CAST(r.company_id AS VARCHAR)
    LEFT JOIN asin_attributes attr
        ON attr.asin = r.asin
        AND attr.marketplace_id = m.marketplace_id
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
    FROM base_child
    GROUP BY
        company,
        marketplace,
        marketplace_country_code,
        parent_asin,
        week_start,
        year
),

final_base AS (
    SELECT * FROM base_child
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
)

SELECT *
FROM with_deltas;
