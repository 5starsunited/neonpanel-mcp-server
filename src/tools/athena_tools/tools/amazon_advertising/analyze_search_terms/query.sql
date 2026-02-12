-- Tool: advertising_analyze_search_terms
-- Purpose: Analyse Amazon PPC (Sponsored Products) Search Term Report data
--          enriched with ASIN attributes via campaign→ASIN mapping.
-- Join chain:
--   sp_search_term  ST
--     → amazon_sellers       S    ON CAST(S.id AS VARCHAR) = ST.ingest_seller_id
--     → amazon_marketplaces  M    ON M.id = S.marketplace_id
--     → campaign_asin_map    CAM  ON CAM.campaign_id = CAST(ST.campaignid AS VARCHAR)
--                                 AND CAM.company_id = ST.ingest_company_id
--                                 AND CAM.marketplace_id = M.amazon_marketplace_id
--     → asin_attributes      AA   ON AA.asin = CAM.asin
--                                 AND AA.company_id = M.id   (via CAST)
--                                 AND AA.marketplace_id = M.id

WITH params AS (
  SELECT
    {{limit_top_n}}                   AS limit_top_n,
    {{start_date_sql}}                AS start_date,
    {{end_date_sql}}                  AS end_date,
    CAST({{periods_back}} AS INTEGER) AS periods_back,

    -- Authorization
    {{company_ids_array}}             AS company_ids,
    transform({{company_ids_array}}, x -> CAST(x AS VARCHAR)) AS company_ids_str,

    -- Optional filters
    {{search_terms_array}}            AS search_terms,
    {{match_type_sql}}                AS match_type,
    {{marketplaces_array}}            AS marketplaces,
    {{campaign_names_array}}          AS campaign_names,
    {{match_types_array}}             AS match_types,

    -- ASIN dimension filters
    {{asins_array}}                   AS asins,
    {{product_families_array}}        AS product_families,
    {{brands_array}}                  AS brands,
    {{pareto_classes_array}}          AS pareto_classes,
    {{revenue_classes_array}}         AS revenue_classes,

    -- Group-by flags (1 = enabled, 0 = disabled)
    CAST({{group_by_search_term}} AS INTEGER)    AS group_by_search_term,
    CAST({{group_by_campaign_name}} AS INTEGER)  AS group_by_campaign_name,
    CAST({{group_by_match_type}} AS INTEGER)     AS group_by_match_type,
    CAST({{group_by_product_family}} AS INTEGER) AS group_by_product_family,
    CAST({{group_by_brand}} AS INTEGER)          AS group_by_brand,
    CAST({{group_by_pareto_class}} AS INTEGER)   AS group_by_pareto_class
),

-- ─── Marketplace dimension ──────────────────────────────────────────────────
marketplaces_dim AS (
  SELECT
    id,
    CAST(amazon_marketplace_id AS VARCHAR) AS amazon_marketplace_id,
    lower(country) AS country,
    lower(code) AS country_code
  FROM "{{catalog}}"."neonpanel_iceberg"."amazon_marketplaces"
),

-- ─── Seller → marketplace mapping ──────────────────────────────────────────
sellers_dim AS (
  SELECT
    CAST(id AS VARCHAR) AS seller_id_str,
    marketplace_id
  FROM "{{catalog}}"."neonpanel_iceberg"."amazon_sellers"
),

-- ─── Join the full chain ────────────────────────────────────────────────────
enriched AS (
  SELECT
    st.date                                    AS report_date,
    st.searchterm                              AS search_term,
    st.keyword                                 AS keyword,
    st.campaignname                            AS campaign_name,
    st.campaignid                              AS campaign_id,
    st.adgroupname                             AS ad_group_name,
    st.matchtype                               AS match_type,
    st.targeting                               AS targeting,
    st.ingest_company_id                       AS company_id,

    -- Core metrics
    st.impressions,
    st.clicks,
    st.cost,
    st.costperclick                            AS cpc,
    st.clickthroughrate                        AS ctr,

    -- Attribution: prefer 30d → 14d → 7d → 1d
    COALESCE(st.sales30d, st.sales14d, st.sales7d, st.sales1d)                   AS sales,
    COALESCE(st.purchases30d, st.purchases14d, st.purchases7d, st.purchases1d)     AS purchases,
    COALESCE(st.unitssoldclicks30d, st.unitssoldclicks14d, st.unitssoldclicks7d, st.unitssoldclicks1d) AS units_sold,

    -- Same-SKU attribution
    COALESCE(st.attributedsalessamesku30d, st.attributedsalessamesku14d,
             st.attributedsalessamesku7d, st.attributedsalessamesku1d)             AS sales_same_sku,
    COALESCE(st.unitssoldsamesku30d, st.unitssoldsamesku14d,
             st.unitssoldsamesku7d, st.unitssoldsamesku1d)                         AS units_sold_same_sku,
    COALESCE(st.purchasessamesku30d, st.purchasessamesku14d,
             st.purchasessamesku7d, st.purchasessamesku1d)                         AS purchases_same_sku,

    -- Other-SKU sales
    st.salesothersku7d                         AS sales_other_sku,
    st.unitssoldothersku7d                     AS units_other_sku,

    -- ROAS / ACOS from report (fallback compute later)
    st.roasclicks14d                           AS roas_report,
    st.acosclicks14d                           AS acos_report,

    -- ASIN dimension columns (fallback to 'undefined' when campaign map is missing)
    COALESCE(cam.asin, 'undefined')                AS asin,
    COALESCE(aa.product_family, 'undefined')        AS product_family,
    COALESCE(aa.brand, 'undefined')                 AS asin_brand,
    COALESCE(aa.pareto_abc_class, 'undefined')      AS pareto_abc_class,
    COALESCE(aa.revenue_abcd_class, 'undefined')    AS revenue_abcd_class,
    aa.revenue_share,

    -- Marketplace for output
    m.country_code                             AS marketplace

  FROM "{{catalog}}"."amazon_ads_reports_iceberg"."sp_search_term" st

  -- ST → Seller (to get marketplace_id)
  INNER JOIN sellers_dim s
    ON s.seller_id_str = st.ingest_seller_id

  -- Seller → Marketplace
  INNER JOIN marketplaces_dim m
    ON m.id = s.marketplace_id

  -- ST → Campaign ASIN map (LEFT JOIN: rows without mapping get 'undefined' dimensions)
  LEFT JOIN "{{catalog}}"."brand_analytics_iceberg"."campaign_asin_map" cam
    ON cam.campaign_id = CAST(st.campaignid AS VARCHAR)
    AND cam.company_id = st.ingest_company_id
    AND cam.marketplace_id = m.amazon_marketplace_id

  -- Campaign ASIN → ASIN attributes
  LEFT JOIN "{{catalog}}"."brand_analytics_iceberg"."asin_attributes" aa
    ON aa.asin = cam.asin
    AND aa.company_id = CAST(st.ingest_company_id AS BIGINT)
    AND aa.marketplace_id = m.id

  CROSS JOIN params p

  WHERE
    -- Authorization: company_id filter
    contains(p.company_ids_str, st.ingest_company_id)

    -- Optional search term filter
    AND (
      cardinality(p.search_terms) = 0
      OR (
        CASE p.match_type
          WHEN 'exact' THEN
            any_match(p.search_terms, t -> lower(t) = lower(st.searchterm))
          WHEN 'starts_with' THEN
            any_match(p.search_terms, t -> lower(st.searchterm) LIKE lower(t) || '%')
          ELSE -- 'contains'
            any_match(p.search_terms, t -> lower(st.searchterm) LIKE '%' || lower(t) || '%')
        END
      )
    )

    -- Optional marketplace filter
    AND (
      cardinality(p.marketplaces) = 0
      OR any_match(p.marketplaces, mp -> lower(mp) IN (m.country, m.country_code))
    )

    -- Optional campaign name filter
    AND (
      cardinality(p.campaign_names) = 0
      OR any_match(p.campaign_names, c -> lower(c) = lower(st.campaignname))
    )

    -- Optional match type filter (broad / phrase / exact)
    AND (
      cardinality(p.match_types) = 0
      OR any_match(p.match_types, mt -> lower(mt) = lower(st.matchtype))
    )

    -- ASIN dimension filters
    AND (cardinality(p.asins) = 0 OR any_match(p.asins, a -> lower(a) = lower(cam.asin)))
    AND (cardinality(p.product_families) = 0 OR any_match(p.product_families, pf -> lower(pf) = lower(aa.product_family)))
    AND (cardinality(p.brands) = 0 OR any_match(p.brands, b -> lower(b) = lower(aa.brand)))
    AND (cardinality(p.pareto_classes) = 0 OR any_match(p.pareto_classes, pc -> lower(pc) = lower(aa.pareto_abc_class)))
    AND (cardinality(p.revenue_classes) = 0 OR any_match(p.revenue_classes, rc -> lower(rc) = lower(aa.revenue_abcd_class)))
),

-- ─── Determine date window ──────────────────────────────────────────────────
latest AS (
  SELECT max(report_date) AS latest_date FROM enriched
),

date_bounds AS (
  SELECT
    COALESCE(p.start_date, CAST(date_add('week', -1 * (p.periods_back - 1), CAST(l.latest_date AS DATE)) AS DATE)) AS start_date,
    COALESCE(p.end_date, CAST(l.latest_date AS DATE)) AS end_date
  FROM params p
  CROSS JOIN latest l
),

windowed AS (
  SELECT e.*
  FROM enriched e
  CROSS JOIN date_bounds d
  WHERE CAST(e.report_date AS DATE) BETWEEN d.start_date AND d.end_date
),

-- ─── Aggregate by dynamic group-by ──────────────────────────────────────────
aggregated AS (
  SELECT
    -- Conditional group-by keys (NULL when not grouped)
    CASE WHEN p.group_by_search_term = 1 THEN w.search_term ELSE NULL END     AS search_term,
    CASE WHEN p.group_by_campaign_name = 1 THEN w.campaign_name ELSE NULL END  AS campaign_name,
    CASE WHEN p.group_by_match_type = 1 THEN w.match_type ELSE NULL END        AS match_type,
    CASE WHEN p.group_by_product_family = 1 THEN w.product_family ELSE NULL END AS product_family,
    CASE WHEN p.group_by_brand = 1 THEN w.asin_brand ELSE NULL END             AS brand,
    CASE WHEN p.group_by_pareto_class = 1 THEN w.pareto_abc_class ELSE NULL END AS pareto_abc_class,

    w.marketplace,

    -- Metrics
    SUM(w.impressions)        AS impressions,
    SUM(w.clicks)             AS clicks,
    SUM(w.cost)               AS cost,
    SUM(w.sales)              AS sales,
    SUM(w.purchases)          AS purchases,
    SUM(w.units_sold)         AS units_sold,
    SUM(w.sales_same_sku)     AS sales_same_sku,
    SUM(w.units_sold_same_sku) AS units_sold_same_sku,
    SUM(w.purchases_same_sku) AS purchases_same_sku,
    SUM(w.sales_other_sku)    AS sales_other_sku,
    SUM(w.units_other_sku)    AS units_other_sku,

    -- Count distinct days/ASINs for context
    COUNT(DISTINCT CAST(w.report_date AS DATE)) AS days_active,
    COUNT(DISTINCT w.asin)                       AS asin_count,

    -- Revenue share (avg when grouped)
    AVG(w.revenue_share)      AS avg_revenue_share

  FROM windowed w
  CROSS JOIN params p
  GROUP BY
    CASE WHEN p.group_by_search_term = 1 THEN w.search_term ELSE NULL END,
    CASE WHEN p.group_by_campaign_name = 1 THEN w.campaign_name ELSE NULL END,
    CASE WHEN p.group_by_match_type = 1 THEN w.match_type ELSE NULL END,
    CASE WHEN p.group_by_product_family = 1 THEN w.product_family ELSE NULL END,
    CASE WHEN p.group_by_brand = 1 THEN w.asin_brand ELSE NULL END,
    CASE WHEN p.group_by_pareto_class = 1 THEN w.pareto_abc_class ELSE NULL END,
    w.marketplace
),

-- ─── Final output with computed KPIs ────────────────────────────────────────
with_kpis AS (
  SELECT
    a.search_term,
    a.campaign_name,
    a.match_type,
    a.product_family,
    a.brand,
    a.pareto_abc_class,
    a.marketplace,

    a.impressions,
    a.clicks,
    ROUND(a.cost, 2)                                                           AS cost,
    ROUND(a.sales, 2)                                                          AS sales,
    a.purchases,
    a.units_sold,

    -- Efficiency KPIs
    CASE WHEN a.clicks > 0 THEN ROUND(a.cost / a.clicks, 2) ELSE NULL END      AS cpc,
    CASE WHEN a.impressions > 0 THEN ROUND(100.0 * a.clicks / a.impressions, 2) ELSE NULL END AS ctr_pct,
    CASE WHEN a.clicks > 0 THEN ROUND(100.0 * a.purchases / a.clicks, 2) ELSE NULL END       AS cvr_pct,
    CASE WHEN a.sales > 0 THEN ROUND(100.0 * a.cost / a.sales, 2) ELSE NULL END              AS acos_pct,
    CASE WHEN a.cost > 0 THEN ROUND(a.sales / a.cost, 2) ELSE NULL END                       AS roas,

    -- Same-SKU vs Other-SKU breakdown
    ROUND(a.sales_same_sku, 2)                                                  AS sales_same_sku,
    ROUND(a.sales_other_sku, 2)                                                 AS sales_other_sku,
    a.units_sold_same_sku,
    a.units_other_sku,
    a.purchases_same_sku,

    -- Context
    a.days_active,
    a.asin_count,
    ROUND(a.avg_revenue_share, 4)                                               AS avg_revenue_share

  FROM aggregated a
)

-- ─── Ranked output ──────────────────────────────────────────────────────────
SELECT
  ROW_NUMBER() OVER (ORDER BY {{sort_column}} {{sort_direction}} NULLS LAST) AS rank,
  k.*
FROM with_kpis k
ORDER BY {{sort_column}} {{sort_direction}} NULLS LAST
LIMIT {{limit_top_n}}
