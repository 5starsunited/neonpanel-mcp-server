WITH LatestDate AS (
    SELECT MAX(CAST(updated_at AS DATE)) as max_week FROM "AwsDataCatalog"."brand_analytics_iceberg"."ryg_thresholds"
),

-- STEP 0: Pareto Classification
AsinPareto AS (
    SELECT asin, ingest_company_id, rspec_marketplaceids, pct
    FROM (
        SELECT 
            asin, ingest_company_id, rspec_marketplaceids,
            (SUM(SUM(impressiondata_impressioncount)) OVER (PARTITION BY ingest_company_id ORDER BY SUM(impressiondata_impressioncount) DESC) / 
             NULLIF(SUM(SUM(impressiondata_impressioncount)) OVER (PARTITION BY ingest_company_id), 0)) * 100 as pct
        FROM sp_api_iceberg.brand_analytics_search_catalog_performance_report
        WHERE week_start = (SELECT max_week FROM LatestDate)
        GROUP BY asin, ingest_company_id, rspec_marketplaceids
    ) WHERE pct <= 90
),

-- STEP 1: Targeted SQP Data (Optimized for 14-week trends)
SqpWindow AS (
    SELECT 
        week_start,
        asin,
        searchquerydata_searchquery as search_term,
        searchquerydata_searchqueryvolume as volume,
        COALESCE(clickdata_asinclickshare, 0) as my_click_share,
        LAG(COALESCE(clickdata_asinclickshare, 0)) OVER (PARTITION BY asin, searchquerydata_searchquery ORDER BY week_start) as prev_week_share,
        AVG(COALESCE(clickdata_asinclickshare, 0)) OVER (PARTITION BY asin, searchquerydata_searchquery ORDER BY week_start ROWS BETWEEN 3 PRECEDING AND CURRENT ROW) as avg_share_l4w,
        AVG(COALESCE(clickdata_asinclickshare, 0)) OVER (PARTITION BY asin, searchquerydata_searchquery ORDER BY week_start ROWS BETWEEN 11 PRECEDING AND CURRENT ROW) as avg_share_l12w
    FROM sp_api_iceberg.brand_analytics_search_query_performance_report
    WHERE week_start >= (SELECT max_week FROM LatestDate) - INTERVAL '98' DAY
    AND asin IN (SELECT asin FROM AsinPareto)
),

-- STEP 2: Market Context (Rank 1-3)
MarketContext AS (
    SELECT 
        searchterm,
        ingest_company_id,
        MAX(CASE WHEN clicksharerank = 1 THEN clickedasin END) as rank_1_asin,
        MAX(CASE WHEN clicksharerank = 1 THEN clickshare END) as rank_1_clickshare,
        MAX(CASE WHEN clicksharerank = 1 THEN conversionshare END) as rank_1_conversionshare,
        MAX(CASE WHEN clicksharerank = 2 THEN clickedasin END) as rank_2_asin,
        MAX(CASE WHEN clicksharerank = 2 THEN clickshare END) as rank_2_clickshare,
        MAX(CASE WHEN clicksharerank = 2 THEN conversionshare END) as rank_2_conversionshare,
        MAX(CASE WHEN clicksharerank = 3 THEN clickedasin END) as rank_3_asin,
        MAX(CASE WHEN clicksharerank = 3 THEN clickshare END) as rank_3_clickshare,
        MAX(CASE WHEN clicksharerank = 3 THEN conversionshare END) as rank_3_conversionshare
    FROM sp_api_iceberg.brand_analytics_search_terms_report
    WHERE week_start = (SELECT max_week FROM LatestDate)
    GROUP BY 1, 2
),

-- STEP 3: Snapshot and Cleaning
RankedSnapshot AS (
    SELECT 
        sw.*,
        p.ingest_company_id,
        element_at(p.rspec_marketplaceids, 1) as amazon_marketplace_id,
        p.pct as pareto_pct,
        mc.rank_1_asin, mc.rank_1_clickshare, mc.rank_1_conversionshare,
        mc.rank_2_asin, mc.rank_2_clickshare, mc.rank_2_conversionshare,
        mc.rank_3_asin, mc.rank_3_clickshare, mc.rank_3_conversionshare,
        ROW_NUMBER() OVER (PARTITION BY p.ingest_company_id, sw.asin ORDER BY sw.volume DESC) as volume_rank
    FROM SqpWindow sw
    INNER JOIN AsinPareto p ON sw.asin = p.asin
    LEFT JOIN MarketContext mc 
        ON sw.search_term = mc.searchterm 
        AND p.ingest_company_id = mc.ingest_company_id
    WHERE sw.week_start = (SELECT max_week FROM LatestDate)
)

-- FINAL OUTPUT (Metadata Joins)
SELECT 
    rs.week_start,
    c.id AS company_id,
    c.name AS Company,
    m.name as marketplace,
    m.code as marketplace_country_code,
    m.currency_iso as currency,
    m.country as country,
    rs.amazon_marketplace_id,
    rs.asin,
    attr.brand, 
    attr.product_family, 
    attr.revenue_abcd_class, 
    attr.pareto_abc_class, 
    attr.revenue_share, 
    CASE WHEN rs.pareto_pct <= 70 THEN 'A' ELSE 'B' END as asin_class,
    rs.search_term,
    rs.volume,
    rs.my_click_share,
    rs.prev_week_share,
    (rs.my_click_share - rs.prev_week_share) as wow_delta,
    rs.avg_share_l4w,
    rs.avg_share_l12w,
    rs.rank_1_asin,
    rs.rank_1_clickshare,
    rs.rank_1_conversionshare,
    rs.rank_2_asin,
    rs.rank_2_clickshare,
    rs.rank_2_conversionshare,
    rs.rank_3_asin,
    rs.rank_3_clickshare,
    rs.rank_3_conversionshare,
    CASE 
        WHEN rs.my_click_share = 0 THEN '⚪ BLIND SPOT'
        WHEN rs.my_click_share < (rs.avg_share_l4w * 0.8) THEN '🚨 DROPPING'
        WHEN rs.my_click_share > (rs.avg_share_l4w * 1.2) THEN '🚀 GAINING'
        ELSE '✅ STABLE'
    END as momentum_signal
FROM RankedSnapshot rs 
LEFT JOIN awsdatacatalog.neonpanel_iceberg.app_companies c 
     ON CAST(c.id as VARCHAR) = rs.ingest_company_id
LEFT JOIN awsdatacatalog.neonpanel_iceberg.amazon_marketplaces m 
     ON m.amazon_marketplace_id = rs.amazon_marketplace_id
LEFT JOIN awsdatacatalog.brand_analytics_iceberg.asin_attributes attr
     ON rs.asin = attr.asin
     AND m.id = attr.marketplace_id
     AND c.id = attr.company_id
WHERE rs.volume_rank <= 20