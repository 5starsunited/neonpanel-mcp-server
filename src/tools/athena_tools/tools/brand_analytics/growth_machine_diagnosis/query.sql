-- brand_analytics_growth_machine_diagnosis (ClickHouse)
-- Fuses SQP + SCP + PPC at (normalized_keyword × child_asin × period) with
-- screenshot enrichment. Emits one locked prescription per row.
--
-- Source mapping from the previous Athena/Iceberg implementation:
--   inventory_planning.last_snapshot_inventory_planning -> etl.ba_asin_attributes
--   brand_analytics_iceberg.search_query_performance_snapshot   -> etl.ba_search_query_performance
--   brand_analytics_iceberg.search_catalog_performance_snapshot -> etl.ba_search_catalog_performance
--   amazon_ads_reports_iceberg.sp_search_term + campaign_asin_map -> etl.ba_ppc_search_terms_weekly
--   brand_analytics_iceberg.tracked_search_terms      -> analytics.ba_tracked_search_terms
--   brand_analytics_iceberg.competitor_asins          -> analytics.ba_competitor_asins
--   brand_analytics_iceberg.sqp_query_details_uploads -> analytics.ba_sqp_query_details_uploads
--   brand_analytics_iceberg.ryg_thresholds            -> etl.ba_ryg_thresholds_current
--
-- KPI derivations are kept byte-for-byte consistent with the already-migrated
-- analyze_search_query_performance / analyze_search_catalog_performance tools so
-- the three tools cannot disagree about the same underlying number:
--   sqp_impression_share      = asin_impression_share (as reported by Amazon)
--   sqp_click_share           = asin_click_share      (as reported by Amazon)
--   sqp_cart_add_rate         = total_cart_add_rate   (MARKET rate, not ASIN-level)
--   sqp_brand_purchase_share  = total_purchase_rate   (MARKET rate, not ASIN-level;
--                               the Athena column name was already misleading and is
--                               preserved here so the signal thresholds keep meaning
--                               exactly what they meant before the migration)
--   sqp_ctr_advantage         = click_share / impression_share (a RATIO, not a delta)
--   scp_click_rate / scp_cart_add_rate = clicks|cart_adds / impressions
--   scp_purchase_rate         = purchases / clicks
--   scp_sales_per_click       = search_traffic_sales / clicks
--
-- Two behavioural notes:
--  * PPC is now sourced from a pre-aggregated WEEKLY table, so a period boundary
--    that falls mid-week includes that whole week. ppc_campaign_count is a max()
--    across weeks rather than a true COUNT(DISTINCT campaign) over the period,
--    because the per-campaign grain is already collapsed upstream.
--    KNOWN DATA GAP: etl.ba_ppc_search_terms_weekly.promoted_asin is currently
--    empty in every row, so the PPC leg cannot be attributed to an ASIN and all
--    ppc_* columns come back NULL. This is deliberate: joining on keyword alone
--    would fan a single campaign's spend across every sibling ASIN and fire
--    bleeder / cart_leak / cannibalization on multiplied numbers. The join is
--    correct as written and starts returning data as soon as the ETL populates
--    promoted_asin. Callers should read NULL as "unknown", never as "zero spend".
--  * screenshots collapse to the LATEST upload per keyword. The Athena version
--    grouped by every upload column, so two uploads for one keyword silently
--    duplicated every prescription row for that keyword.

WITH
-- ─── Catalog (hero / siblings) ──────────────────────────────────────────────
catalog_raw AS (
    SELECT
        asin AS child_asin,
        parent_asin,
        product_family,
        brand,
        marketplace_id,
        revenue_share
    FROM etl.ba_asin_attributes
    WHERE company_id = {{company_id}}
      AND marketplace_id = {{marketplace_id_literal}}
),

-- One row per child ASIN. ba_asin_attributes can carry more than one row per
-- ASIN, and every downstream LEFT JOIN keys on child_asin alone, so an
-- un-collapsed source would fan out the whole prescription set.
catalog_collapsed AS (
    SELECT
        child_asin,
        any(parent_asin) AS parent_asin,
        any(product_family) AS product_family,
        any(brand) AS brand,
        any(marketplace_id) AS marketplace_id,
        max(revenue_share) AS revenue_share
    FROM catalog_raw
    GROUP BY child_asin
),

catalog_enriched AS (
    SELECT
        c.*,
        count() OVER (PARTITION BY c.parent_asin) AS sibling_count,
        -- revenue_share is Nullable, so the equality is Nullable too. ifNull
        -- reproduces the Athena CASE ... ELSE false branch; without it the CAST
        -- to a non-Nullable Bool fails outright for ASINs with no revenue share.
        CAST(
            ifNull(
                c.parent_asin <> ''
                AND c.revenue_share = max(c.revenue_share) OVER (PARTITION BY c.parent_asin),
                false
            )
            AS Bool
        ) AS is_hero
    FROM catalog_collapsed AS c
),

-- Entity filter: resolves grain + entity_ids -> set of child ASINs in scope.
entity_asins AS (
    SELECT
        child_asin,
        parent_asin,
        product_family,
        brand,
        is_hero,
        sibling_count
    FROM catalog_enriched
    WHERE length({{entity_ids_array_sql}}) = 0
       OR ({{grain_literal}} = 'child_asin' AND has({{entity_ids_array_sql}}, child_asin))
       OR ({{grain_literal}} = 'parent_asin' AND has({{entity_ids_array_sql}}, parent_asin))
       OR ({{grain_literal}} = 'product_family' AND has({{entity_ids_array_sql}}, product_family))
       OR ({{grain_literal}} = 'brand' AND has({{entity_ids_array_sql}}, ifNull(brand, '')))
),

-- ─── Tracked search terms (optional scoping) ─────────────────────────────────
tracked_keywords AS (
    SELECT DISTINCT lower(trimBoth(keyword)) AS kw_norm
    FROM analytics.ba_tracked_search_terms FINAL
    WHERE company_id = {{company_id}}
      AND marketplace_id = {{marketplace_id_literal}}
      AND is_active = 1
      AND {{use_tracked_search_terms_sql}} = 1
      AND length({{keywords_array_sql}}) = 0
),

keyword_override AS (
    SELECT DISTINCT lower(trimBoth(arrayJoin({{keywords_array_sql}}))) AS kw_norm
),

-- ─── Intent-cluster scoping (optional) ──────────────────────────────────────
-- When intent_ids is provided, restrict scope to search terms mapped to any of
-- those user-intent clusters. Combined with the base scope (override/tracked)
-- as AND (intersection): if both supplied, results must satisfy both filters.
intent_keywords AS (
    SELECT DISTINCT lower(trimBoth(search_term)) AS kw_norm
    FROM etl.ba_search_term_to_intent_current
    WHERE company_id = {{company_id}}
      AND length({{intent_ids_array_sql}}) > 0
      AND has({{intent_ids_array_sql}}, intent_id)
),

base_scope AS (
    SELECT kw_norm FROM keyword_override
    UNION DISTINCT
    SELECT kw_norm FROM tracked_keywords
),

keyword_scope AS (
    -- Case A: no intent_ids -> original base scope (override u tracked)
    SELECT kw_norm
    FROM base_scope
    WHERE length({{intent_ids_array_sql}}) = 0

    UNION DISTINCT

    -- Case B: intent_ids AND base_scope both non-empty -> INTERSECT
    SELECT b.kw_norm AS kw_norm
    FROM base_scope AS b
    INNER JOIN intent_keywords AS i ON b.kw_norm = i.kw_norm
    WHERE length({{intent_ids_array_sql}}) > 0

    UNION DISTINCT

    -- Case C: intent_ids non-empty but base_scope empty -> use intent terms
    SELECT kw_norm
    FROM intent_keywords
    WHERE length({{intent_ids_array_sql}}) > 0
      AND (SELECT count() FROM base_scope) = 0
),

-- ─── Competitor ASIN registry (optional) ────────────────────────────────────
-- Note: competitor_asins has no keyword column; scope is per (against_my_asin).
-- An empty against_my_asin means the competitor applies company-wide.
competitor_registry AS (
    SELECT
        competitor_asin AS asin,
        against_my_asin
    FROM analytics.ba_competitor_asins FINAL
    WHERE company_id = {{company_id}}
      AND marketplace_id = {{marketplace_id_literal}}
      AND is_active = 1
      AND {{use_competitor_registry_sql}} = 1
),

-- Entries with an empty against_my_asin apply company-wide. They are collected
-- separately rather than being ORed into the join condition: ClickHouse rejects
-- a JOIN ON that is not expressible as equality over join keys
-- (INVALID_JOIN_ON_EXPRESSION).
competitor_registry_global AS (
    SELECT arrayFilter(x -> x <> '', groupUniqArray(asin)) AS asins
    FROM competitor_registry
    WHERE against_my_asin = ''
),

-- Pre-aggregate the registry per child_asin to avoid a correlated subquery in
-- `prescribed`. child_asin is re-aliased: `prescribed` joins this onto a
-- relation that also exposes child_asin, and the analyzer would otherwise emit
-- a qualified column name.
competitor_registry_grouped AS (
    SELECT
        ea.child_asin AS crg_child_asin,
        arrayDistinct(arrayConcat(
            arrayFilter(x -> x <> '', groupUniqArray(cr.asin)),
            (SELECT asins FROM competitor_registry_global)
        )) AS asins
    FROM entity_asins AS ea
    LEFT JOIN competitor_registry AS cr
        ON cr.against_my_asin = ea.child_asin
    GROUP BY ea.child_asin
),

-- ─── SQP: aggregate to (keyword_norm × child_asin) for the period ───────────
sqp_raw AS (
    SELECT
        lower(trimBoth(search_query)) AS kw_norm,
        any(search_query) AS keyword_original,
        asin AS child_asin,
        sum(ifNull(asin_impression_count, 0)) AS sqp_asin_impressions,
        sum(ifNull(asin_click_count, 0)) AS sqp_asin_clicks,
        avg(asin_impression_share) AS sqp_impression_share,
        avg(asin_click_share) AS sqp_click_share,
        avg(total_cart_add_rate) AS sqp_cart_add_rate,
        avg(total_purchase_rate) AS sqp_brand_purchase_share,
        avg(if(ifNull(asin_impression_share, 0) = 0, NULL, asin_click_share / asin_impression_share))
            AS sqp_ctr_advantage,
        avg(search_query_score) AS sqp_search_query_score
    FROM etl.ba_search_query_performance
    WHERE company_id = {{company_id}}
      AND marketplace_id = {{marketplace_id_literal}}
      AND week_start BETWEEN {{period_start_literal}} AND {{period_end_literal}}
    GROUP BY kw_norm, child_asin
),

sqp AS (
    SELECT *
    FROM sqp_raw
    WHERE child_asin IN (SELECT child_asin FROM entity_asins)
      AND (
          (SELECT count() FROM keyword_scope) = 0
          OR kw_norm IN (SELECT kw_norm FROM keyword_scope)
      )
),

-- ─── SCP: per-ASIN catalog performance (not keyword-specific) for the period
scp AS (
    SELECT
        asin AS child_asin,
        sum(ifNull(impression_count, 0)) AS scp_impressions,
        sum(ifNull(click_count, 0)) AS scp_clicks,
        sum(ifNull(cart_add_count, 0)) AS scp_cart_adds,
        sum(ifNull(purchase_count, 0)) AS scp_purchases,
        avg(if(ifNull(impression_count, 0) = 0, NULL, click_count / impression_count)) AS scp_click_rate,
        avg(if(ifNull(impression_count, 0) = 0, NULL, cart_add_count / impression_count)) AS scp_cart_add_rate,
        avg(if(ifNull(click_count, 0) = 0, NULL, purchase_count / click_count)) AS scp_purchase_rate,
        avg(if(ifNull(click_count, 0) = 0, NULL, toFloat64(search_traffic_sales) / click_count)) AS scp_sales_per_click,
        sum(ifNull(toFloat64(search_traffic_sales), 0)) AS scp_search_traffic_sales
    FROM etl.ba_search_catalog_performance
    WHERE company_id = {{company_id}}
      AND marketplace_id = {{marketplace_id_literal}}
      AND week_start BETWEEN {{period_start_literal}} AND {{period_end_literal}}
      AND asin IN (SELECT child_asin FROM entity_asins)
    GROUP BY child_asin
),

-- ─── PPC: already aggregated to (week × search term × promoted ASIN) ────────
ppc_raw AS (
    SELECT
        lower(trimBoth(ifNull(search_term_norm, ''))) AS kw_norm,
        promoted_asin AS child_asin,
        sum(ifNull(ppc_impressions, 0)) AS ppc_impressions,
        sum(ifNull(ppc_clicks, 0)) AS ppc_clicks,
        sum(ifNull(toFloat64(ppc_spend), 0)) AS ppc_spend,
        sum(ifNull(toFloat64(ppc_sales), 0)) AS ppc_sales,
        sum(ifNull(ppc_purchases, 0)) AS ppc_purchases,
        -- Deterministic stand-in for Athena's MAX(matchtype): the per-campaign
        -- grain is collapsed upstream, so take the max distinct match type.
        arrayElement(arraySort(arrayDistinct(arrayFlatten(groupArray(ppc_match_types)))), -1)
            AS ppc_match_type_sample,
        max(ppc_campaign_count) AS ppc_campaign_count
    FROM etl.ba_ppc_search_terms_weekly
    WHERE company_id = {{company_id}}
      AND marketplace_id = {{marketplace_id_literal}}
      AND ad_product = 'SPONSORED_PRODUCTS'
      AND dataset = 'sp_search_term'
      AND week_start BETWEEN {{period_start_literal}} AND {{period_end_literal}}
    GROUP BY kw_norm, child_asin
),

ppc AS (
    SELECT *
    FROM ppc_raw
    WHERE child_asin IN (SELECT child_asin FROM entity_asins)
      AND (
          (SELECT count() FROM keyword_scope) = 0
          OR kw_norm IN (SELECT kw_norm FROM keyword_scope)
      )
),

-- ─── Screenshot uploads (Seller Central Search Query Details) ───────────────
-- competitors are stored as a JSON string, so the Athena UNNEST over
-- array<row<...>> becomes JSON extraction over the raw element list.
screenshot_rows AS (
    SELECT
        lower(trimBoth(keyword)) AS kw_norm,
        total_impressions,
        total_clicks,
        total_click_rate,
        competitors_json,
        uploaded_at,
        arrayFilter(
            x -> JSONExtractInt(x, 'rank') = 1,
            JSONExtractArrayRaw(competitors_json)
        ) AS leader_elements
    FROM analytics.ba_sqp_query_details_uploads FINAL
    WHERE company_id = {{company_id}}
      AND marketplace_id = {{marketplace_id_literal}}
      AND is_active = 1
      AND period_start <= {{period_end_literal}}
      AND period_end >= {{period_start_literal}}
),

screenshots AS (
    SELECT
        kw_norm,
        argMax(uploaded_at, uploaded_at) AS ss_uploaded_at,
        argMax(total_impressions, uploaded_at) AS ss_total_impressions,
        argMax(total_clicks, uploaded_at) AS ss_total_clicks,
        argMax(total_click_rate, uploaded_at) AS ss_total_click_rate,
        argMax(
            if(
                length(leader_elements) = 0,
                NULL,
                arrayMax(arrayMap(x -> JSONExtractFloat(x, 'click_rate'), leader_elements))
            ),
            uploaded_at
        ) AS ss_leader_click_rate,
        argMax(competitors_json, uploaded_at) AS ss_competitors
    FROM screenshot_rows
    GROUP BY kw_norm
),

-- ─── RYG / Growth Machine thresholds ────────────────────────────────────────
-- Company-specific rows win over the global (NULL company_id) defaults.
-- updated_at is an explicit tiebreaker: without it two rows with the same
-- precedence could swap places between runs and silently change a signal.
ryg_ranked AS (
    SELECT
        tool,
        signal_group,
        metric,
        color,
        threshold_value,
        row_number() OVER (
            PARTITION BY tool, signal_group, metric, color
            ORDER BY if(ifNull(company_id, 0) = {{company_id}}, 0, 1) ASC, updated_at DESC
        ) AS rn
    FROM etl.ba_ryg_thresholds_current
    WHERE (ifNull(company_id, 0) = {{company_id}} OR company_id IS NULL)
      AND is_active = 1
      AND tool IN ('growth_machine', 'sqp', 'scp', 'global')
),

-- toNullable is REQUIRED: maxIf returns the type default (0.0) rather than NULL
-- when no row matches, which would defeat every COALESCE default below.
thresholds AS (
    SELECT
        maxIf(toNullable(threshold_value), tool = 'growth_machine' AND signal_group = 'proven_winner'   AND metric = 'ppc_cvr'                  AND color = 'green')  AS gm_proven_ppc_cvr_g,
        maxIf(toNullable(threshold_value), tool = 'growth_machine' AND signal_group = 'proven_winner'   AND metric = 'brand_purchase_share'     AND color = 'red')    AS gm_proven_brand_share_r,
        maxIf(toNullable(threshold_value), tool = 'growth_machine' AND signal_group = 'bleeder'         AND metric = 'ppc_clicks_min'           AND color = 'red')    AS gm_bleed_clicks_min,
        maxIf(toNullable(threshold_value), tool = 'growth_machine' AND signal_group = 'bleeder'         AND metric = 'ppc_sales_max'            AND color = 'red')    AS gm_bleed_sales_max,
        maxIf(toNullable(threshold_value), tool = 'growth_machine' AND signal_group = 'cannibalization' AND metric = 'brand_purchase_share'     AND color = 'green')  AS gm_cannib_brand_share_g,
        maxIf(toNullable(threshold_value), tool = 'growth_machine' AND signal_group = 'cannibalization' AND metric = 'ppc_spend_min'            AND color = 'yellow') AS gm_cannib_spend_min,
        maxIf(toNullable(threshold_value), tool = 'growth_machine' AND signal_group = 'cart_leak'       AND metric = 'cart_to_purchase_rate'    AND color = 'red')    AS gm_leak_c2p_r,
        maxIf(toNullable(threshold_value), tool = 'growth_machine' AND signal_group = 'cart_leak'       AND metric = 'ppc_spend_min'            AND color = 'yellow') AS gm_leak_spend_min,
        maxIf(toNullable(threshold_value), tool = 'growth_machine' AND signal_group = 'weak_leader'     AND metric = 'leader_conversion_share'  AND color = 'red')    AS gm_weak_leader_r,
        maxIf(toNullable(threshold_value), tool = 'growth_machine' AND signal_group = 'weak_leader'     AND metric = 'my_share_gap'             AND color = 'yellow') AS gm_weak_gap_y,
        maxIf(toNullable(threshold_value), tool = 'growth_machine' AND signal_group = 'defend'          AND metric = 'brand_purchase_share'     AND color = 'green')  AS gm_defend_share_g,
        maxIf(toNullable(threshold_value), tool = 'growth_machine' AND signal_group = 'defend'          AND metric = 'brand_purchase_share_wow' AND color = 'red')    AS gm_defend_share_wow_r
    FROM ryg_ranked
    WHERE rn = 1
),

-- ─── Fuse: SQP u PPC on (kw_norm, child_asin), then LEFT JOIN SCP + screenshots
sqp_ppc_keys AS (
    SELECT kw_norm, child_asin FROM sqp
    UNION DISTINCT
    SELECT kw_norm, child_asin FROM ppc
),

-- Every column is projected explicitly. kw_norm and child_asin exist on several
-- of the joined relations, and a wildcard would be emitted with a qualified
-- name (e.g. `sqp.kw_norm`), which downstream CTEs cannot reference.
fused AS (
    SELECT
        k.kw_norm AS kw_norm,
        k.child_asin AS child_asin,
        ifNull(nullIf(sqp.keyword_original, ''), k.kw_norm) AS keyword,
        ea.parent_asin AS parent_asin,
        ea.product_family AS product_family,
        ea.brand AS brand,
        ea.is_hero AS is_hero,
        ea.sibling_count AS sibling_count,
        -- SQP metrics
        sqp.sqp_asin_impressions AS sqp_asin_impressions,
        sqp.sqp_asin_clicks AS sqp_asin_clicks,
        sqp.sqp_impression_share AS sqp_impression_share,
        sqp.sqp_click_share AS sqp_click_share,
        sqp.sqp_cart_add_rate AS sqp_cart_add_rate,
        sqp.sqp_brand_purchase_share AS sqp_brand_purchase_share,
        sqp.sqp_ctr_advantage AS sqp_ctr_advantage,
        sqp.sqp_search_query_score AS sqp_search_query_score,
        -- SCP metrics
        scp.scp_impressions AS scp_impressions,
        scp.scp_clicks AS scp_clicks,
        scp.scp_cart_adds AS scp_cart_adds,
        scp.scp_purchases AS scp_purchases,
        scp.scp_click_rate AS scp_click_rate,
        scp.scp_cart_add_rate AS scp_cart_add_rate,
        scp.scp_purchase_rate AS scp_purchase_rate,
        scp.scp_sales_per_click AS scp_sales_per_click,
        scp.scp_search_traffic_sales AS scp_search_traffic_sales,
        -- PPC metrics
        ppc.ppc_impressions AS ppc_impressions,
        ppc.ppc_clicks AS ppc_clicks,
        ppc.ppc_spend AS ppc_spend,
        ppc.ppc_sales AS ppc_sales,
        ppc.ppc_purchases AS ppc_purchases,
        ppc.ppc_match_type_sample AS ppc_match_type_sample,
        ppc.ppc_campaign_count AS ppc_campaign_count,
        if(ifNull(ppc.ppc_clicks, 0) = 0, NULL, toFloat64(ppc.ppc_purchases) / ppc.ppc_clicks) AS ppc_cvr,
        if(ifNull(ppc.ppc_spend, 0) = 0, NULL, ppc.ppc_sales / ppc.ppc_spend) AS ppc_roas,
        if(ifNull(ppc.ppc_sales, 0) = 0, NULL, ppc.ppc_spend / ppc.ppc_sales) AS ppc_acos,
        -- Cart-to-purchase (SCP) - prefer SCP-based; falls back NULL otherwise.
        if(ifNull(scp.scp_cart_adds, 0) = 0, NULL, toFloat64(scp.scp_purchases) / scp.scp_cart_adds)
            AS cart_to_purchase_rate,
        -- Screenshot enrichment. Under join_use_nulls a missed LEFT JOIN yields
        -- NULL, so presence is a NULL check rather than a length check.
        CAST(isNotNull(ss.kw_norm) AS Bool) AS screenshot_data_available,
        ss.ss_uploaded_at AS screenshot_uploaded_at,
        ss.ss_total_impressions AS screenshot_total_impressions,
        ss.ss_total_clicks AS screenshot_total_clicks,
        ss.ss_total_click_rate AS screenshot_total_click_rate,
        ss.ss_leader_click_rate AS screenshot_leader_click_rate,
        ss.ss_competitors AS screenshot_competitors
    FROM sqp_ppc_keys AS k
    INNER JOIN entity_asins AS ea ON ea.child_asin = k.child_asin
    LEFT JOIN sqp ON sqp.kw_norm = k.kw_norm AND sqp.child_asin = k.child_asin
    LEFT JOIN ppc ON ppc.kw_norm = k.kw_norm AND ppc.child_asin = k.child_asin
    LEFT JOIN scp ON scp.child_asin = k.child_asin
    LEFT JOIN screenshots AS ss ON ss.kw_norm = k.kw_norm
),

-- ─── Prescription (locked enum cascade) ─────────────────────────────────────
-- SCALE WARNING: Amazon reports the SQP share/rate columns on a 0-100 scale
-- (verified: asin_impression_share and asin_click_share top out at exactly 100),
-- but every ryg threshold is stored as a fraction (0.15, 0.3, 0.05, ...).
-- Comparing them directly makes `ifNull(sqp_brand_purchase_share, 0) >= 0.15`
-- true for essentially every row, which collapsed the whole prescription
-- cascade onto DEFEND_ORGANIC. The comparisons below therefore divide by 100,
-- while the projected columns stay on Amazon's reported scale so this tool keeps
-- agreeing with analyze_search_query_performance.
scored AS (
    SELECT
        f.*,
        CAST(
            f.cart_to_purchase_rate IS NOT NULL
            AND f.cart_to_purchase_rate < ifNull(t.gm_leak_c2p_r, 0.30)
            AND ifNull(f.ppc_spend, 0) >= ifNull(t.gm_leak_spend_min, 100)
            AS Bool
        ) AS sig_cart_leak,
        CAST(
            ifNull(f.ppc_clicks, 0) >= ifNull(t.gm_bleed_clicks_min, 10)
            AND ifNull(f.ppc_sales, 0) <= ifNull(t.gm_bleed_sales_max, 0)
            AS Bool
        ) AS sig_bleeder,
        CAST(
            f.ppc_cvr IS NOT NULL
            AND f.ppc_cvr >= ifNull(t.gm_proven_ppc_cvr_g, 0.10)
            AND ifNull(f.sqp_brand_purchase_share, 0) / 100 < ifNull(t.gm_proven_brand_share_r, 0.05)
            AS Bool
        ) AS sig_proven_winner,
        CAST(
            ifNull(f.sqp_brand_purchase_share, 0) / 100 >= ifNull(t.gm_cannib_brand_share_g, 0.15)
            AND ifNull(f.ppc_spend, 0) >= ifNull(t.gm_cannib_spend_min, 50)
            AS Bool
        ) AS sig_cannibalization,
        CAST(
            f.screenshot_data_available
            AND f.screenshot_leader_click_rate IS NOT NULL
            AND f.screenshot_leader_click_rate < ifNull(t.gm_weak_leader_r, 0.30)
            AS Bool
        ) AS sig_weak_leader,
        CAST(
            ifNull(f.sqp_brand_purchase_share, 0) / 100 >= ifNull(t.gm_defend_share_g, 0.15)
            AS Bool
        ) AS sig_defend
    FROM fused AS f
    CROSS JOIN thresholds AS t
),

prescribed AS (
    SELECT
        s.*,
        multiIf(
            s.sig_cart_leak,       'FIX_CART_LEAK_CUT_PPC',
            s.sig_bleeder,         'NEGATIVE_EXACT',
            s.sig_proven_winner,   'INJECT_INTO_SEO',
            s.sig_cannibalization, 'DEFEND_ORGANIC',
            s.sig_weak_leader,     'DISPLACE_WEAK_LEADER',
            s.sig_defend,          'DEFEND_ORGANIC',
            'EVALUATE_OR_SKIP'
        ) AS prescription,
        -- Seller Central deep link for manual screenshot upload
        concat(
            'https://sellercentral.amazon.com/brand-analytics/dashboard/query-detail?view-id=query-detail-asin-view',
            '&asin=', ifNull(s.child_asin, ''),
            '&search-term-freeform=', ifNull(s.kw_norm, ''),
            '&reporting-range=weekly',
            '&country-id=', {{marketplace_code_upper_literal}}
        ) AS seller_central_query_detail_url,
        crg.asins AS competitor_registry_asins
    FROM scored AS s
    LEFT JOIN competitor_registry_grouped AS crg ON crg.crg_child_asin = s.child_asin
),

focus_filtered AS (
    SELECT *
    FROM prescribed
    WHERE multiIf(
        {{focus_literal}} = 'cart_leak',       prescription = 'FIX_CART_LEAK_CUT_PPC',
        {{focus_literal}} = 'cannibalization', prescription = 'DEFEND_ORGANIC' AND sig_cannibalization,
        {{focus_literal}} = 'weak_leader',     prescription = 'DISPLACE_WEAK_LEADER',
        {{focus_literal}} = 'defend',          prescription = 'DEFEND_ORGANIC' AND sig_defend,
        true
    )
)

SELECT
    kw_norm AS keyword_normalized,
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
    multiIf(
        prescription = 'FIX_CART_LEAK_CUT_PPC', 1,
        prescription = 'NEGATIVE_EXACT',        2,
        prescription = 'INJECT_INTO_SEO',       3,
        prescription = 'DISPLACE_WEAK_LEADER',  4,
        prescription = 'DEFEND_ORGANIC',        5,
        9
    ) ASC,
    ifNull(ppc_spend, 0) DESC,
    ifNull(sqp_asin_impressions, 0) DESC,
    keyword_normalized ASC,
    child_asin ASC
LIMIT {{limit_top_n}}
-- join_use_nulls is REQUIRED. By default a missed ClickHouse LEFT JOIN fills the
-- column's type DEFAULT (0 / ''), not NULL. Without this, a keyword with no PPC
-- row reports ppc_spend 0 and ppc_campaign_count 0 -- indistinguishable from a
-- keyword that genuinely spent nothing -- and screenshot_uploaded_at comes back
-- as 1970-01-01 instead of null.
SETTINGS join_use_nulls = 1
