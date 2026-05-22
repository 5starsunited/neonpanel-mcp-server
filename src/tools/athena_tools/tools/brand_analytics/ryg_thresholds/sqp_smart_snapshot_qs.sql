-- OPTIMIZATION LAYER: Define your historical data scope here.
-- Setting an explicit date threshold triggers Iceberg/Glue Partition Pruning.
WITH DateBoundary AS (
    SELECT DATE '2026-01-01' as min_history_date
),

-- ─── Per-term intent enrichment (flattened mapping)
term_intents AS (
    SELECT
        sti.company_id,
        lower(sti.search_term) AS term_norm,
        array_agg(DISTINCT sti.intent_id) AS intent_ids,
        arbitrary(CASE WHEN sti.rn_primary = 1 THEN sti.intent_id END) AS primary_intent_id,
        arbitrary(CASE WHEN sti.rn_primary = 1 THEN ui.intent_name END) AS primary_intent_label
    FROM (
        SELECT
            company_id,
            search_term,
            intent_id,
            confidence,
            ROW_NUMBER() OVER (
                PARTITION BY company_id, lower(search_term)
                ORDER BY confidence DESC NULLS LAST, intent_id ASC
            ) AS rn_primary
        FROM "AwsDataCatalog"."brand_analytics_iceberg"."search_term_to_intent"
    ) sti
    LEFT JOIN "AwsDataCatalog"."brand_analytics_iceberg"."user_intents" ui
        ON ui.company_id = sti.company_id
       AND ui.intent_id = sti.intent_id
    GROUP BY sti.company_id, lower(sti.search_term)
),

-- STEP 0: Compute Base Aggregations Per Company Per Week (Optimized with date filtering)
ParetoBase AS (
    SELECT 
        week_start,
        asin, 
        company_id as ingest_company_id,
        marketplace as amazon_marketplace_id,
        SUM(CAST(impressiondata_impressioncount AS DOUBLE)) as asin_impressions
    FROM "AwsDataCatalog"."brand_analytics_iceberg"."search_catalog_performance_snapshot"
    WHERE week_start >= (SELECT min_history_date FROM DateBoundary) -- Pruning Partitions
    GROUP BY week_start, asin, company_id, marketplace
),

-- STEP 0.1: Window Calculations over clean inputs
AsinPareto AS (
    SELECT 
        week_start,
        asin, 
        ingest_company_id, 
        amazon_marketplace_id,
        (SUM(asin_impressions) OVER (PARTITION BY ingest_company_id, week_start ORDER BY asin_impressions DESC) / 
         COALESCE(NULLIF(SUM(asin_impressions) OVER (PARTITION BY ingest_company_id, week_start), 0.0), 1.0)) * 100.0 as pct
    FROM ParetoBase
),

FilteredAsinPareto AS (
    SELECT * FROM AsinPareto WHERE pct <= 90
),

-- STEP 0.5: Dynamic Parameter Fallback Logic (Metadata table, small scan)
ThresholdConfigs AS (
    SELECT 
        company_id,
        MAX(CASE WHEN signal_code = 'critical_drop' THEN CAST(threshold_value AS DOUBLE) END) as drop_threshold,
        MAX(CASE WHEN signal_code = 'growth_sprint' THEN CAST(threshold_value AS DOUBLE) END) as gain_threshold
    FROM (
        SELECT 
            COALESCE(NULLIF(CAST(company_id AS VARCHAR), ''), 'default') as company_id,
            signal_code,
            threshold_value,
            ROW_NUMBER() OVER (
                PARTITION BY COALESCE(NULLIF(CAST(company_id AS VARCHAR), ''), 'default'), signal_code 
                ORDER BY CASE WHEN company_id IS NOT NULL AND CAST(company_id AS VARCHAR) <> '' THEN 1 ELSE 2 END
            ) as rn
        FROM "AwsDataCatalog"."brand_analytics_iceberg"."ryg_thresholds"
        WHERE signal_code IN ('critical_drop', 'growth_sprint')
    )
    WHERE rn = 1
    GROUP BY company_id
),

-- STEP 1: Targeted SQP Data (Date filter placed *before* running heavy window metrics)
SqpWindow AS (
    SELECT 
        sqp.week_start,
        sqp.asin,
        sqp.ingest_company_id, 
        sqp.searchquerydata_searchquery as search_term,
        CAST(sqp.searchquerydata_searchqueryvolume AS BIGINT) as volume,
        COALESCE(CAST(sqp.clickdata_asinclickshare AS DOUBLE), 0.0) as my_click_share,
        
        LAG(COALESCE(CAST(sqp.clickdata_asinclickshare AS DOUBLE), 0.0)) OVER (
            PARTITION BY sqp.ingest_company_id, sqp.asin, sqp.searchquerydata_searchquery 
            ORDER BY sqp.week_start
        ) as prev_week_share,
        
        AVG(COALESCE(CAST(sqp.clickdata_asinclickshare AS DOUBLE), 0.0)) OVER (
            PARTITION BY sqp.ingest_company_id, sqp.asin, sqp.searchquerydata_searchquery 
            ORDER BY sqp.week_start 
            ROWS BETWEEN 3 PRECEDING AND CURRENT ROW
        ) as avg_share_l4w,
        
        AVG(COALESCE(CAST(sqp.clickdata_asinclickshare AS DOUBLE), 0.0)) OVER (
            PARTITION BY sqp.ingest_company_id, sqp.asin, sqp.searchquerydata_searchquery 
            ORDER BY sqp.week_start 
            ROWS BETWEEN 11 PRECEDING AND CURRENT ROW
        ) as avg_share_l12w
    FROM sp_api_iceberg.brand_analytics_search_query_performance_report sqp
    -- Lookback buffer optimization: pulls 98 extra days prior to min data scope to ensure the first targeted week has healthy lookback averages
    WHERE sqp.week_start >= (SELECT min_history_date - INTERVAL '98' DAY FROM DateBoundary)
),

-- STEP 2: Market Context (Optimized with partition bounds)
MarketContext AS (
    SELECT 
        str.week_start,
        str.searchterm,
        str.ingest_company_id,
        MAX(CASE WHEN CAST(str.clicksharerank AS INT) = 1 THEN str.clickedasin END) as rank_1_asin,
        MAX(CASE WHEN CAST(str.clicksharerank AS INT) = 1 THEN CAST(str.clickshare AS DOUBLE) END) as rank_1_clickshare,
        MAX(CASE WHEN CAST(str.clicksharerank AS INT) = 1 THEN CAST(str.conversionshare AS DOUBLE) END) as rank_1_conversionshare,
        MAX(CASE WHEN CAST(str.clicksharerank AS INT) = 2 THEN str.clickedasin END) as rank_2_asin,
        MAX(CASE WHEN CAST(str.clicksharerank AS INT) = 2 THEN CAST(str.clickshare AS DOUBLE) END) as rank_2_clickshare,
        MAX(CASE WHEN CAST(str.clicksharerank AS INT) = 2 THEN CAST(str.conversionshare AS DOUBLE) END) as rank_2_conversionshare,
        MAX(CASE WHEN CAST(str.clicksharerank AS INT) = 3 THEN str.clickedasin END) as rank_3_asin,
        MAX(CASE WHEN CAST(str.clicksharerank AS INT) = 3 THEN CAST(str.clickshare AS DOUBLE) END) as rank_3_clickshare,
        MAX(CASE WHEN CAST(str.clicksharerank AS INT) = 3 THEN CAST(str.conversionshare AS DOUBLE) END) as rank_3_conversionshare
    FROM sp_api_iceberg.brand_analytics_search_terms_report str
    WHERE str.week_start >= (SELECT min_history_date FROM DateBoundary) -- Pruning Partitions
    GROUP BY 1, 2, 3
),

-- STEP 3: Snapshot and Cleaning
RankedSnapshot AS (
    SELECT 
        sw.*,
        p.amazon_marketplace_id,
        p.pct as pareto_pct,
        mc.rank_1_asin, mc.rank_1_clickshare, mc.rank_1_conversionshare,
        mc.rank_2_asin, mc.rank_2_clickshare, mc.rank_2_conversionshare,
        mc.rank_3_asin, mc.rank_3_clickshare, mc.rank_3_conversionshare,
        ROW_NUMBER() OVER (PARTITION BY p.ingest_company_id, sw.week_start, sw.asin ORDER BY sw.volume DESC) as volume_rank
    FROM SqpWindow sw
    INNER JOIN FilteredAsinPareto p 
        ON sw.asin = p.asin 
        AND sw.ingest_company_id = p.ingest_company_id
        AND sw.week_start = p.week_start
    LEFT JOIN MarketContext mc 
        ON sw.search_term = mc.searchterm 
        AND p.ingest_company_id = mc.ingest_company_id
        AND sw.week_start = mc.week_start
    WHERE sw.week_start >= (SELECT min_history_date FROM DateBoundary) -- Slice final results to match target limit
)

-- FINAL OUTPUT
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
    ti.primary_intent_id AS primary_intent_id,
    ti.primary_intent_label AS "Intent",
    ti.intent_ids AS intent_ids,
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
        WHEN rs.my_click_share < (rs.avg_share_l4w * (1.0 + COALESCE(tc_custom.drop_threshold, tc_default.drop_threshold, -0.20))) THEN '🚨 DROPPING'
        WHEN rs.my_click_share > (rs.avg_share_l4w * (1.0 + COALESCE(tc_custom.gain_threshold, tc_default.gain_threshold, 0.20))) THEN '🚀 GAINING'
        ELSE '✅ STABLE'
    END as momentum_signal
FROM RankedSnapshot rs 
LEFT JOIN awsdatacatalog.neonpanel_iceberg.app_companies c 
     ON CAST(c.id as VARCHAR) = rs.ingest_company_id
LEFT JOIN awsdatacatalog.neonpanel_iceberg.amazon_marketplaces m 
     ON m.domain = rs.amazon_marketplace_id
LEFT JOIN awsdatacatalog.brand_analytics_iceberg.asin_attributes attr
     ON rs.asin = attr.asin
     AND m.id = attr.marketplace_id
     AND c.id = attr.company_id
LEFT JOIN ThresholdConfigs tc_custom
     ON tc_custom.company_id = rs.ingest_company_id
LEFT JOIN ThresholdConfigs tc_default
     ON tc_default.company_id = 'default'
LEFT JOIN term_intents ti
    ON CAST(ti.company_id AS VARCHAR) = rs.ingest_company_id
    AND ti.term_norm = lower(rs.search_term)
WHERE rs.volume_rank <= 20
ORDER BY company_id ASC, week_start DESC, volume DESC