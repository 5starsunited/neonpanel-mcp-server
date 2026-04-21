-- brand_analytics_growth_machine_diagnosis
-- Fuses SQP + SCP + PPC at (normalized_keyword × child_asin × period) with screenshot enrichment.
-- Emits one locked prescription per row.

WITH params AS (
  SELECT
    {{company_id}}                AS company_id,
    {{marketplace_literal}}       AS marketplace,
    DATE {{period_start_literal}} AS period_start,
    DATE {{period_end_literal}}   AS period_end,
    {{grain_literal}}             AS grain,
    {{focus_literal}}             AS focus,
    {{entity_ids_array_sql}}      AS entity_ids,
    {{keywords_array_sql}}        AS keywords_override,
    {{use_tracked_search_terms_sql}} AS use_tracked_search_terms,
    {{use_competitor_registry_sql}}  AS use_competitor_registry
),

-- ─── Catalog (hero / siblings) ──────────────────────────────────────────────
catalog_raw AS (
  SELECT
    s.child_asin,
    s.parent_asin,
    s.sku,
    s.product_name,
    s.brand,
    s.product_family,
    s.country_code  AS marketplace,
    s.company_id,
    s.marketplace_id,
    s.revenue_abcd_class,
    s.pareto_abc_class,
    s.revenue_share,
    s.units_30d,
    s.revenue_30d,
    s.avg_units_7d,
    CAST(current_date AS DATE) AS catalog_snapshot_date
  FROM "{{catalog}}"."inventory_planning"."last_snapshot_inventory_planning" s,
       params p
  WHERE s.company_id = p.company_id
    AND LOWER(s.country_code) = LOWER(p.marketplace)
),

catalog_enriched AS (
  SELECT
    r.*,
    COUNT(*) OVER (PARTITION BY r.parent_asin, r.company_id, r.marketplace_id) AS sibling_count,
    CASE
      WHEN r.parent_asin IS NOT NULL
        AND r.parent_asin <> ''
        AND r.revenue_share = MAX(r.revenue_share) OVER (
          PARTITION BY r.parent_asin, r.company_id, r.marketplace_id)
      THEN true
      ELSE false
    END AS is_hero
  FROM catalog_raw r
),

-- Entity filter: resolves grain + entity_ids -> set of child ASINs in scope.
entity_asins AS (
  SELECT c.child_asin, c.parent_asin, c.product_family, c.brand, c.is_hero, c.sibling_count
  FROM catalog_enriched c, params p
  WHERE
    (
      cardinality(p.entity_ids) = 0
      OR (p.grain = 'child_asin'     AND contains(p.entity_ids, c.child_asin))
      OR (p.grain = 'parent_asin'    AND contains(p.entity_ids, c.parent_asin))
      OR (p.grain = 'product_family' AND contains(p.entity_ids, c.product_family))
      OR (p.grain = 'brand'          AND contains(p.entity_ids, c.brand))
    )
),

-- ─── Tracked search terms (optional scoping) ─────────────────────────────────
tracked_keywords AS (
  SELECT DISTINCT LOWER(TRIM(t.keyword)) AS kw_norm
  FROM "{{catalog}}"."brand_analytics_iceberg"."tracked_search_terms" t, params p
  WHERE t.company_id = p.company_id
    AND LOWER(t.marketplace) = LOWER(p.marketplace)
    AND t.is_active = TRUE
    AND p.use_tracked_search_terms = TRUE
    AND cardinality(p.keywords_override) = 0
),

keyword_override AS (
  SELECT DISTINCT LOWER(TRIM(kw)) AS kw_norm
  FROM params p
  CROSS JOIN UNNEST(p.keywords_override) AS t(kw)
  WHERE cardinality(p.keywords_override) > 0
),

keyword_scope AS (
  SELECT kw_norm FROM keyword_override
  UNION
  SELECT kw_norm FROM tracked_keywords
),

-- ─── Competitor ASIN registry (optional) ────────────────────────────────────
competitor_registry AS (
  SELECT c.asin, LOWER(TRIM(c.keyword)) AS kw_norm
  FROM "{{catalog}}"."brand_analytics_iceberg"."competitor_asins" c, params p
  WHERE c.company_id = p.company_id
    AND LOWER(c.marketplace) = LOWER(p.marketplace)
    AND c.is_active = TRUE
    AND p.use_competitor_registry = TRUE
),

-- ─── SQP: aggregate to (keyword_norm × child_asin) for the period ───────────
sqp_raw AS (
  SELECT
    LOWER(TRIM(q.searchquerydata_searchquery)) AS kw_norm,
    q.searchquerydata_searchquery              AS keyword_original,
    q.asin                                     AS child_asin,
    q.parent_asin,
    q.brand,
    q.marketplace_country_code                 AS marketplace,
    SUM(COALESCE(q.impressiondata_asinimpressioncount, 0)) AS sqp_asin_impressions,
    SUM(COALESCE(q.clickdata_asinclickcount, 0))           AS sqp_asin_clicks,
    AVG(q.kpi_impression_share)                            AS sqp_impression_share,
    AVG(q.kpi_click_share)                                 AS sqp_click_share,
    AVG(q.kpi_cart_add_rate)                               AS sqp_cart_add_rate,
    AVG(q.kpi_purchase_rate)                               AS sqp_brand_purchase_share,
    AVG(q.kpi_ctr_advantage)                               AS sqp_ctr_advantage,
    AVG(q.searchquerydata_searchqueryscore)                AS sqp_search_query_score,
    MAX(q.week_start)                                      AS sqp_last_week
  FROM "{{catalog}}"."brand_analytics_iceberg"."search_query_performance_snapshot" q, params p
  WHERE LOWER(q.marketplace_country_code) = LOWER(p.marketplace)
    AND q.week_start BETWEEN p.period_start AND p.period_end
  GROUP BY 1,2,3,4,5,6
),

sqp AS (
  SELECT s.*
  FROM sqp_raw s, params p
  WHERE s.child_asin IN (SELECT child_asin FROM entity_asins)
    AND (
      NOT EXISTS (SELECT 1 FROM keyword_scope)
      OR s.kw_norm IN (SELECT kw_norm FROM keyword_scope)
    )
),

-- ─── SCP: per-ASIN catalog performance (not keyword-specific) for the period
scp AS (
  SELECT
    sc.asin AS child_asin,
    sc.parent_asin,
    sc.brand,
    SUM(COALESCE(sc.impressiondata_impressioncount, 0)) AS scp_impressions,
    SUM(COALESCE(sc.clickdata_clickcount, 0))           AS scp_clicks,
    SUM(COALESCE(sc.cartadddata_cartaddcount, 0))       AS scp_cart_adds,
    SUM(COALESCE(sc.purchasedata_purchasecount, 0))     AS scp_purchases,
    AVG(sc.kpi_click_rate)         AS scp_click_rate,
    AVG(sc.kpi_cart_add_rate)      AS scp_cart_add_rate,
    AVG(sc.kpi_purchase_rate)      AS scp_purchase_rate,
    AVG(sc.kpi_sales_per_click)    AS scp_sales_per_click,
    AVG(sc.kpi_sales_per_impression) AS scp_sales_per_impression,
    SUM(COALESCE(sc.purchasedata_searchtrafficsales_amount, 0)) AS scp_search_traffic_sales
  FROM "{{catalog}}"."brand_analytics_iceberg"."search_catalog_performance_snapshot" sc, params p
  WHERE LOWER(sc.marketplace_country_code) = LOWER(p.marketplace)
    AND sc.week_start BETWEEN p.period_start AND p.period_end
    AND sc.asin IN (SELECT child_asin FROM entity_asins)
  GROUP BY 1,2,3
),

-- ─── PPC: sp_search_term joined via campaign_asin_map → advertised ASIN ─────
ppc_raw AS (
  SELECT
    LOWER(TRIM(st.searchterm))        AS kw_norm,
    cam.asin                          AS child_asin,
    SUM(COALESCE(st.impressions, 0))  AS ppc_impressions,
    SUM(COALESCE(st.clicks, 0))       AS ppc_clicks,
    SUM(COALESCE(st.cost, 0))         AS ppc_spend,
    SUM(COALESCE(st.sales30d, 0))     AS ppc_sales,
    SUM(COALESCE(st.purchases30d, 0)) AS ppc_purchases,
    MAX(st.matchtype)                 AS ppc_match_type_sample,
    COUNT(DISTINCT st.campaignid)     AS ppc_campaign_count
  FROM "{{catalog}}"."amazon_ads_reports_iceberg"."sp_search_term" st
  JOIN "{{catalog}}"."amazon_ads_reports_iceberg"."campaign_asin_map" cam
    ON TRY_CAST(st.ingest_company_id AS BIGINT) = cam.company_id
   AND st.campaignid = cam.campaign_id
  , params p
  WHERE TRY_CAST(st.ingest_company_id AS BIGINT) = p.company_id
    AND CAST(st.date AS DATE) BETWEEN p.period_start AND p.period_end
  GROUP BY 1,2
),

ppc AS (
  SELECT r.*
  FROM ppc_raw r
  WHERE r.child_asin IN (SELECT child_asin FROM entity_asins)
    AND (
      NOT EXISTS (SELECT 1 FROM keyword_scope)
      OR r.kw_norm IN (SELECT kw_norm FROM keyword_scope)
    )
),

-- ─── Screenshot uploads (Seller Central Search Query Details) ───────────────
screenshots AS (
  SELECT
    LOWER(TRIM(s.keyword))        AS kw_norm,
    s.period_start                AS ss_period_start,
    s.period_end                  AS ss_period_end,
    s.total_impressions           AS ss_total_impressions,
    s.total_clicks                AS ss_total_clicks,
    s.total_click_rate            AS ss_total_click_rate,
    s.competitors                 AS ss_competitors,
    s.uploaded_at                 AS ss_uploaded_at,
    -- Rough leader signals from screenshot competitor list (rank=1).
    MAX(CASE WHEN comp.rank = 1 THEN comp.click_rate  END) AS ss_leader_click_rate,
    MAX(CASE WHEN comp.rank = 1 THEN comp.click_rate  END) -
      MIN(CASE WHEN comp.asin IS NOT NULL THEN comp.click_rate END) AS ss_click_rate_spread
  FROM "{{catalog}}"."brand_analytics_iceberg"."sqp_query_details_uploads" s, params p
  LEFT JOIN UNNEST(s.competitors) AS comp
    ON TRUE
  WHERE s.company_id = p.company_id
    AND LOWER(s.marketplace) = LOWER(p.marketplace)
    AND s.period_start <= p.period_end
    AND s.period_end   >= p.period_start
  GROUP BY 1,2,3,4,5,6,7,8
),

-- ─── RYG / Growth Machine thresholds ────────────────────────────────────────
ryg_ranked AS (
  SELECT r.*,
    ROW_NUMBER() OVER (
      PARTITION BY tool, signal_group, metric, color
      ORDER BY CASE WHEN company_id = (SELECT company_id FROM params) THEN 0 ELSE 1 END
    ) AS rn
  FROM "{{catalog}}"."brand_analytics_iceberg"."ryg_thresholds" r, params p
  WHERE (r.company_id = p.company_id OR r.company_id IS NULL)
    AND r.tool IN ('growth_machine', 'sqp', 'scp', 'global')
),

thresholds AS (
  SELECT
    -- Growth Machine rules
    MAX(CASE WHEN tool='growth_machine' AND signal_group='proven_winner'   AND metric='ppc_cvr'                 AND color='green'  THEN threshold_value END) AS gm_proven_ppc_cvr_g,
    MAX(CASE WHEN tool='growth_machine' AND signal_group='proven_winner'   AND metric='brand_purchase_share'    AND color='red'    THEN threshold_value END) AS gm_proven_brand_share_r,
    MAX(CASE WHEN tool='growth_machine' AND signal_group='bleeder'         AND metric='ppc_clicks_min'          AND color='red'    THEN threshold_value END) AS gm_bleed_clicks_min,
    MAX(CASE WHEN tool='growth_machine' AND signal_group='bleeder'         AND metric='ppc_sales_max'           AND color='red'    THEN threshold_value END) AS gm_bleed_sales_max,
    MAX(CASE WHEN tool='growth_machine' AND signal_group='cannibalization' AND metric='brand_purchase_share'    AND color='green'  THEN threshold_value END) AS gm_cannib_brand_share_g,
    MAX(CASE WHEN tool='growth_machine' AND signal_group='cannibalization' AND metric='ppc_spend_min'           AND color='yellow' THEN threshold_value END) AS gm_cannib_spend_min,
    MAX(CASE WHEN tool='growth_machine' AND signal_group='cart_leak'       AND metric='cart_to_purchase_rate'   AND color='red'    THEN threshold_value END) AS gm_leak_c2p_r,
    MAX(CASE WHEN tool='growth_machine' AND signal_group='cart_leak'       AND metric='ppc_spend_min'           AND color='yellow' THEN threshold_value END) AS gm_leak_spend_min,
    MAX(CASE WHEN tool='growth_machine' AND signal_group='weak_leader'     AND metric='leader_conversion_share' AND color='red'    THEN threshold_value END) AS gm_weak_leader_r,
    MAX(CASE WHEN tool='growth_machine' AND signal_group='weak_leader'     AND metric='my_share_gap'            AND color='yellow' THEN threshold_value END) AS gm_weak_gap_y,
    MAX(CASE WHEN tool='growth_machine' AND signal_group='defend'          AND metric='brand_purchase_share'    AND color='green'  THEN threshold_value END) AS gm_defend_share_g,
    MAX(CASE WHEN tool='growth_machine' AND signal_group='defend'          AND metric='brand_purchase_share_wow' AND color='red'   THEN threshold_value END) AS gm_defend_share_wow_r
  FROM ryg_ranked
  WHERE rn = 1
),

-- ─── Fuse: SQP ∪ PPC on (kw_norm, child_asin), then LEFT JOIN SCP + screenshots
sqp_ppc_keys AS (
  SELECT kw_norm, child_asin FROM sqp
  UNION
  SELECT kw_norm, child_asin FROM ppc
),

fused AS (
  SELECT
    k.kw_norm,
    k.child_asin,
    COALESCE(sqp.keyword_original, k.kw_norm) AS keyword,
    ea.parent_asin,
    ea.product_family,
    ea.brand,
    ea.is_hero,
    ea.sibling_count,
    -- SQP metrics
    sqp.sqp_asin_impressions,
    sqp.sqp_asin_clicks,
    sqp.sqp_impression_share,
    sqp.sqp_click_share,
    sqp.sqp_cart_add_rate,
    sqp.sqp_brand_purchase_share,
    sqp.sqp_ctr_advantage,
    sqp.sqp_search_query_score,
    -- SCP metrics
    scp.scp_impressions,
    scp.scp_clicks,
    scp.scp_cart_adds,
    scp.scp_purchases,
    scp.scp_click_rate,
    scp.scp_cart_add_rate,
    scp.scp_purchase_rate,
    scp.scp_sales_per_click,
    scp.scp_search_traffic_sales,
    -- PPC metrics
    ppc.ppc_impressions,
    ppc.ppc_clicks,
    ppc.ppc_spend,
    ppc.ppc_sales,
    ppc.ppc_purchases,
    ppc.ppc_match_type_sample,
    ppc.ppc_campaign_count,
    CASE WHEN COALESCE(ppc.ppc_clicks, 0) > 0
         THEN CAST(ppc.ppc_purchases AS DOUBLE) / ppc.ppc_clicks END AS ppc_cvr,
    CASE WHEN COALESCE(ppc.ppc_spend, 0) > 0
         THEN ppc.ppc_sales / ppc.ppc_spend END AS ppc_roas,
    CASE WHEN COALESCE(ppc.ppc_sales, 0) > 0
         THEN ppc.ppc_spend / ppc.ppc_sales END AS ppc_acos,
    -- Cart-to-purchase (SCP) — prefer SCP-based; falls back NULL otherwise.
    CASE WHEN COALESCE(scp.scp_cart_adds, 0) > 0
         THEN CAST(scp.scp_purchases AS DOUBLE) / scp.scp_cart_adds END AS cart_to_purchase_rate,
    -- Screenshot enrichment
    (ss.kw_norm IS NOT NULL)                AS screenshot_data_available,
    ss.ss_uploaded_at                       AS screenshot_uploaded_at,
    ss.ss_total_impressions                 AS screenshot_total_impressions,
    ss.ss_total_clicks                      AS screenshot_total_clicks,
    ss.ss_total_click_rate                  AS screenshot_total_click_rate,
    ss.ss_leader_click_rate                 AS screenshot_leader_click_rate,
    ss.ss_competitors                       AS screenshot_competitors
  FROM sqp_ppc_keys k
  LEFT JOIN sqp ON sqp.kw_norm = k.kw_norm AND sqp.child_asin = k.child_asin
  LEFT JOIN ppc ON ppc.kw_norm = k.kw_norm AND ppc.child_asin = k.child_asin
  LEFT JOIN scp ON scp.child_asin = k.child_asin
  LEFT JOIN entity_asins ea ON ea.child_asin = k.child_asin
  LEFT JOIN screenshots ss ON ss.kw_norm = k.kw_norm
  WHERE ea.child_asin IS NOT NULL
),

-- ─── Prescription (locked enum cascade) ─────────────────────────────────────
scored AS (
  SELECT
    f.*,
    t.gm_proven_ppc_cvr_g,
    t.gm_proven_brand_share_r,
    t.gm_bleed_clicks_min,
    t.gm_bleed_sales_max,
    t.gm_cannib_brand_share_g,
    t.gm_cannib_spend_min,
    t.gm_leak_c2p_r,
    t.gm_leak_spend_min,
    t.gm_weak_leader_r,
    t.gm_weak_gap_y,
    t.gm_defend_share_g,
    t.gm_defend_share_wow_r,
    -- Booleans per signal group
    (f.cart_to_purchase_rate IS NOT NULL
      AND f.cart_to_purchase_rate < COALESCE(t.gm_leak_c2p_r, 0.30)
      AND COALESCE(f.ppc_spend, 0) >= COALESCE(t.gm_leak_spend_min, 100))
      AS sig_cart_leak,
    (COALESCE(f.ppc_clicks, 0) >= COALESCE(t.gm_bleed_clicks_min, 10)
      AND COALESCE(f.ppc_sales, 0) <= COALESCE(t.gm_bleed_sales_max, 0))
      AS sig_bleeder,
    (f.ppc_cvr IS NOT NULL
      AND f.ppc_cvr >= COALESCE(t.gm_proven_ppc_cvr_g, 0.10)
      AND COALESCE(f.sqp_brand_purchase_share, 0) < COALESCE(t.gm_proven_brand_share_r, 0.05))
      AS sig_proven_winner,
    (COALESCE(f.sqp_brand_purchase_share, 0) >= COALESCE(t.gm_cannib_brand_share_g, 0.15)
      AND COALESCE(f.ppc_spend, 0) >= COALESCE(t.gm_cannib_spend_min, 50))
      AS sig_cannibalization,
    (f.screenshot_data_available
      AND f.screenshot_leader_click_rate IS NOT NULL
      AND f.screenshot_leader_click_rate < COALESCE(t.gm_weak_leader_r, 0.30))
      AS sig_weak_leader,
    (COALESCE(f.sqp_brand_purchase_share, 0) >= COALESCE(t.gm_defend_share_g, 0.15))
      AS sig_defend
  FROM fused f
  CROSS JOIN thresholds t
),

prescribed AS (
  SELECT
    s.*,
    CASE
      WHEN s.sig_cart_leak        THEN 'FIX_CART_LEAK_CUT_PPC'
      WHEN s.sig_bleeder          THEN 'NEGATIVE_EXACT'
      WHEN s.sig_proven_winner    THEN 'INJECT_INTO_SEO'
      WHEN s.sig_cannibalization  THEN 'DEFEND_ORGANIC'
      WHEN s.sig_weak_leader      THEN 'DISPLACE_WEAK_LEADER'
      WHEN s.sig_defend           THEN 'DEFEND_ORGANIC'
      ELSE 'EVALUATE_OR_SKIP'
    END AS prescription,
    -- Seller Central deep link for manual screenshot upload
    'https://sellercentral.amazon.com/brand-analytics/dashboard/query-detail?view-id=query-detail-asin-view'
      || '&asin=' || COALESCE(s.child_asin, '')
      || '&search-term-freeform=' || COALESCE(s.kw_norm, '')
      || '&reporting-range=weekly'
      || '&country-id=' || UPPER((SELECT marketplace FROM params)) AS seller_central_query_detail_url,
    -- Competitor ASIN hints from registry (keyword-scoped)
    (SELECT array_agg(asin)
       FROM competitor_registry cr
       WHERE cr.kw_norm = s.kw_norm) AS competitor_registry_asins
  FROM scored s
),

focus_filtered AS (
  SELECT p.*
  FROM prescribed p, params pm
  WHERE
    CASE pm.focus
      WHEN 'cart_leak'       THEN p.prescription = 'FIX_CART_LEAK_CUT_PPC'
      WHEN 'cannibalization' THEN p.prescription = 'DEFEND_ORGANIC' AND p.sig_cannibalization
      WHEN 'weak_leader'     THEN p.prescription = 'DISPLACE_WEAK_LEADER'
      WHEN 'defend'          THEN p.prescription = 'DEFEND_ORGANIC' AND p.sig_defend
      ELSE TRUE
    END
)

SELECT
  kw_norm                          AS keyword_normalized,
  keyword,
  child_asin,
  parent_asin,
  product_family,
  brand,
  is_hero,
  sibling_count,
  prescription,
  -- Signals
  sig_cart_leak,
  sig_bleeder,
  sig_proven_winner,
  sig_cannibalization,
  sig_weak_leader,
  sig_defend,
  -- SQP
  sqp_asin_impressions,
  sqp_asin_clicks,
  sqp_impression_share,
  sqp_click_share,
  sqp_cart_add_rate,
  sqp_brand_purchase_share,
  sqp_ctr_advantage,
  sqp_search_query_score,
  -- SCP
  scp_impressions,
  scp_clicks,
  scp_cart_adds,
  scp_purchases,
  scp_click_rate,
  scp_cart_add_rate,
  scp_purchase_rate,
  scp_sales_per_click,
  scp_search_traffic_sales,
  cart_to_purchase_rate,
  -- PPC
  ppc_impressions,
  ppc_clicks,
  ppc_spend,
  ppc_sales,
  ppc_purchases,
  ppc_cvr,
  ppc_roas,
  ppc_acos,
  ppc_campaign_count,
  ppc_match_type_sample,
  -- Screenshot
  screenshot_data_available,
  screenshot_uploaded_at,
  screenshot_total_impressions,
  screenshot_total_clicks,
  screenshot_total_click_rate,
  screenshot_leader_click_rate,
  screenshot_competitors,
  -- Registry
  competitor_registry_asins,
  -- Deep link
  seller_central_query_detail_url
FROM focus_filtered
ORDER BY
  CASE prescription
    WHEN 'FIX_CART_LEAK_CUT_PPC' THEN 1
    WHEN 'NEGATIVE_EXACT'        THEN 2
    WHEN 'INJECT_INTO_SEO'       THEN 3
    WHEN 'DISPLACE_WEAK_LEADER'  THEN 4
    WHEN 'DEFEND_ORGANIC'        THEN 5
    ELSE 9
  END,
  COALESCE(ppc_spend, 0)            DESC,
  COALESCE(sqp_asin_impressions, 0) DESC
LIMIT {{limit_top_n}}
