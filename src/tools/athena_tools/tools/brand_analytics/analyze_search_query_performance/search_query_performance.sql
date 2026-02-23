-- fetch ASIN attributes from inventory_planning snapshot
WITH asin_attributes AS (
    SELECT 
        child_asin as asin,
        marketplace_id,
        MIN(revenue_abcd_class) as revenue_abcd_class,
        MIN(pareto_abc_class) as pareto_abc_class,
        MIN(brand) as brand,
        SUM(revenue_share) as revenue_share
    FROM awsdatacatalog.inventory_planning.last_snapshot_inventory_planning
    GROUP BY 1,2
),

base_child AS (
     SELECT 
          c.name as company,
          m.name as marketplace,
          m.code as marketplace_country_code,
          COALESCE(al.parent_asin, al.asin) as parent_asin,
          attr.revenue_abcd_class,
          attr.pareto_abc_class,
          attr.brand,
          attr.revenue_share,
          al.title,
          -- SQP specific columns (replacing sqp.*)
          sqp.date,
          sqp.rspec_marketplaceids,
          sqp.asin,
          sqp.cartadddata_asincartaddcount,
          sqp.cartadddata_asincartaddshare,
          sqp.cartadddata_asinmediancartaddprice_amount,
          sqp.cartadddata_asinmediancartaddprice_currencycode,
          sqp.cartadddata_totalcartaddcount,
          sqp.cartadddata_totalcartaddrate,
          sqp.cartadddata_totalmediancartaddprice_amount,
          sqp.cartadddata_totalmediancartaddprice_currencycode,
          sqp.cartadddata_totalonedayshippingcartaddcount,
          sqp.cartadddata_totalsamedayshippingcartaddcount,
          sqp.cartadddata_totaltwodayshippingcartaddcount,
          sqp.clickdata_asinclickcount,
          sqp.clickdata_asinclickshare,
          sqp.clickdata_asinmedianclickprice_amount,
          sqp.clickdata_asinmedianclickprice_currencycode,
          sqp.clickdata_totalclickcount,
          sqp.clickdata_totalclickrate,
          sqp.clickdata_totalmedianclickprice_amount,
          sqp.clickdata_totalmedianclickprice_currencycode,
          sqp.clickdata_totalonedayshippingclickcount,
          sqp.clickdata_totalsamedayshippingclickcount,
          sqp.clickdata_totaltwodayshippingclickcount,
          sqp.enddate,
          sqp.impressiondata_asinimpressioncount,
          sqp.impressiondata_asinimpressionshare,
          sqp.impressiondata_totalqueryimpressioncount,
          sqp.purchasedata_asinmedianpurchaseprice_amount,
          sqp.purchasedata_asinmedianpurchaseprice_currencycode,
          sqp.purchasedata_asinpurchasecount,
          sqp.purchasedata_asinpurchaseshare,
          sqp.purchasedata_totalmedianpurchaseprice_amount,
          sqp.purchasedata_totalmedianpurchaseprice_currencycode,
          sqp.purchasedata_totalonedayshippingpurchasecount,
          sqp.purchasedata_totalpurchasecount,
          sqp.purchasedata_totalpurchaserate,
          sqp.purchasedata_totalsamedayshippingpurchasecount,
          sqp.purchasedata_totaltwodayshippingpurchasecount,
          sqp.searchquerydata_searchquery,
          sqp.searchquerydata_searchqueryscore,
          sqp.searchquerydata_searchqueryvolume,
          sqp.startdate,
          sqp.ingest_ts_utc,
          sqp.ingest_company_id as company_id,
          sqp.ingest_seller_id as amazon_seller_id,
          sqp.week_start,
          sqp.year,
          -- KPI base calculations
          sqp.impressiondata_asinimpressionshare AS kpi_impression_share,
          sqp.clickdata_asinclickshare AS kpi_click_share,
          sqp.cartadddata_totalcartaddrate AS kpi_cart_add_rate,
          sqp.purchasedata_totalpurchaserate AS kpi_purchase_rate,
          CASE
               WHEN sqp.impressiondata_asinimpressionshare IS NULL OR sqp.impressiondata_asinimpressionshare = 0 THEN NULL
               ELSE sqp.clickdata_asinclickshare / sqp.impressiondata_asinimpressionshare
          END AS kpi_ctr_advantage,
          'child' AS row_type
     FROM awsdatacatalog.sp_api_iceberg.brand_analytics_search_query_performance_report sqp
     LEFT JOIN awsdatacatalog.neonpanel_iceberg.amazon_marketplaces m
           ON m.amazon_marketplace_id = sqp.rspec_marketplaceids[1]
     LEFT JOIN athenadatacatalog.neonpanel.amazon_listings al 
           ON al.asin = sqp.asin
           AND al.marketplace_id = m.id
     LEFT JOIN awsdatacatalog.neonpanel_iceberg.app_companies c
           ON CAST(c.id as VARCHAR) = sqp.ingest_company_id
     LEFT JOIN asin_attributes attr 
           ON attr.asin = sqp.asin
           AND attr.marketplace_id = m.id
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
          MAX(date) AS date,
          CAST(NULL AS ARRAY(VARCHAR)) AS rspec_marketplaceids,
          parent_asin AS asin,
          SUM(cartadddata_asincartaddcount) AS cartadddata_asincartaddcount,
          CASE
               WHEN SUM(cartadddata_totalcartaddcount) = 0 THEN NULL
               ELSE SUM(cartadddata_asincartaddcount) / SUM(cartadddata_totalcartaddcount)
          END AS cartadddata_asincartaddshare,
          CAST(NULL AS DOUBLE) AS cartadddata_asinmediancartaddprice_amount,
          CAST(NULL AS VARCHAR) AS cartadddata_asinmediancartaddprice_currencycode,
          SUM(cartadddata_totalcartaddcount) AS cartadddata_totalcartaddcount,
          CASE
               WHEN SUM(impressiondata_totalqueryimpressioncount) = 0 THEN NULL
               ELSE SUM(cartadddata_totalcartaddcount) / SUM(impressiondata_totalqueryimpressioncount)
          END AS cartadddata_totalcartaddrate,
          CAST(NULL AS DOUBLE) AS cartadddata_totalmediancartaddprice_amount,
          CAST(NULL AS VARCHAR) AS cartadddata_totalmediancartaddprice_currencycode,
          SUM(cartadddata_totalonedayshippingcartaddcount) AS cartadddata_totalonedayshippingcartaddcount,
          SUM(cartadddata_totalsamedayshippingcartaddcount) AS cartadddata_totalsamedayshippingcartaddcount,
          SUM(cartadddata_totaltwodayshippingcartaddcount) AS cartadddata_totaltwodayshippingcartaddcount,
          SUM(clickdata_asinclickcount) AS clickdata_asinclickcount,
          CASE
               WHEN SUM(clickdata_totalclickcount) = 0 THEN NULL
               ELSE SUM(clickdata_asinclickcount) / SUM(clickdata_totalclickcount)
          END AS clickdata_asinclickshare,
          CAST(NULL AS DOUBLE) AS clickdata_asinmedianclickprice_amount,
          CAST(NULL AS VARCHAR) AS clickdata_asinmedianclickprice_currencycode,
          SUM(clickdata_totalclickcount) AS clickdata_totalclickcount,
          CASE
               WHEN SUM(impressiondata_totalqueryimpressioncount) = 0 THEN NULL
               ELSE SUM(clickdata_totalclickcount) / SUM(impressiondata_totalqueryimpressioncount)
          END AS clickdata_totalclickrate,
          CAST(NULL AS DOUBLE) AS clickdata_totalmedianclickprice_amount,
          CAST(NULL AS VARCHAR) AS clickdata_totalmedianclickprice_currencycode,
          SUM(clickdata_totalonedayshippingclickcount) AS clickdata_totalonedayshippingclickcount,
          SUM(clickdata_totalsamedayshippingclickcount) AS clickdata_totalsamedayshippingclickcount,
          SUM(clickdata_totaltwodayshippingclickcount) AS clickdata_totaltwodayshippingclickcount,
          MAX(enddate) AS enddate,
          SUM(impressiondata_asinimpressioncount) AS impressiondata_asinimpressioncount,
          CASE
               WHEN SUM(impressiondata_totalqueryimpressioncount) = 0 THEN NULL
               ELSE SUM(impressiondata_asinimpressioncount) / SUM(impressiondata_totalqueryimpressioncount)
          END AS impressiondata_asinimpressionshare,
          SUM(impressiondata_totalqueryimpressioncount) AS impressiondata_totalqueryimpressioncount,
          CAST(NULL AS DOUBLE) AS purchasedata_asinmedianpurchaseprice_amount,
          CAST(NULL AS VARCHAR) AS purchasedata_asinmedianpurchaseprice_currencycode,
          SUM(purchasedata_asinpurchasecount) AS purchasedata_asinpurchasecount,
          CASE
               WHEN SUM(purchasedata_totalpurchasecount) = 0 THEN NULL
               ELSE SUM(purchasedata_asinpurchasecount) / SUM(purchasedata_totalpurchasecount)
          END AS purchasedata_asinpurchaseshare,
          CAST(NULL AS DOUBLE) AS purchasedata_totalmedianpurchaseprice_amount,
          CAST(NULL AS VARCHAR) AS purchasedata_totalmedianpurchaseprice_currencycode,
          SUM(purchasedata_totalonedayshippingpurchasecount) AS purchasedata_totalonedayshippingpurchasecount,
          SUM(purchasedata_totalpurchasecount) AS purchasedata_totalpurchasecount,
          CASE
               WHEN SUM(impressiondata_totalqueryimpressioncount) = 0 THEN NULL
               ELSE SUM(purchasedata_totalpurchasecount) / SUM(impressiondata_totalqueryimpressioncount)
          END AS purchasedata_totalpurchaserate,
          SUM(purchasedata_totalsamedayshippingpurchasecount) AS purchasedata_totalsamedayshippingpurchasecount,
          SUM(purchasedata_totaltwodayshippingpurchasecount) AS purchasedata_totaltwodayshippingpurchasecount,
          MAX(searchquerydata_searchquery) AS searchquerydata_searchquery,
          MAX(searchquerydata_searchqueryscore) AS searchquerydata_searchqueryscore,
          MAX(searchquerydata_searchqueryvolume) AS searchquerydata_searchqueryvolume,
          MAX(startdate) AS startdate,
          MAX(ingest_ts_utc) AS ingest_ts_utc,
          MAX(company_id) AS company_id,
          MAX(amazon_seller_id) AS amazon_seller_id,
          week_start,
          year,
          -- KPI base calculations (recomputed)
          CASE
               WHEN SUM(impressiondata_totalqueryimpressioncount) = 0 THEN NULL
               ELSE SUM(impressiondata_asinimpressioncount) / SUM(impressiondata_totalqueryimpressioncount)
          END AS kpi_impression_share,
          CASE
               WHEN SUM(clickdata_totalclickcount) = 0 THEN NULL
               ELSE SUM(clickdata_asinclickcount) / SUM(clickdata_totalclickcount)
          END AS kpi_click_share,
          CASE
               WHEN SUM(impressiondata_totalqueryimpressioncount) = 0 THEN NULL
               ELSE SUM(cartadddata_totalcartaddcount) / SUM(impressiondata_totalqueryimpressioncount)
          END AS kpi_cart_add_rate,
          CASE
               WHEN SUM(impressiondata_totalqueryimpressioncount) = 0 THEN NULL
               ELSE SUM(purchasedata_totalpurchasecount) / SUM(impressiondata_totalqueryimpressioncount)
          END AS kpi_purchase_rate,
          CASE
               WHEN SUM(impressiondata_totalqueryimpressioncount) = 0 OR SUM(impressiondata_asinimpressioncount) = 0 THEN NULL
               ELSE (SUM(clickdata_asinclickcount) / NULLIF(SUM(clickdata_totalclickcount), 0))
                 / (SUM(impressiondata_asinimpressioncount) / SUM(impressiondata_totalqueryimpressioncount))
          END AS kpi_ctr_advantage,
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
)

SELECT *
FROM final_base fb;