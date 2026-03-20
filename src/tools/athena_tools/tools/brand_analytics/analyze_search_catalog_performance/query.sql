-- Tool query for search_catalog_performance
-- Reads directly from the raw SP-API source table (not the snapshot) to guarantee
-- multi-week history for LAG/AVG window functions.
-- Replicates the ETL enrichment (marketplace, parent_asin, ASIN attributes) at query time.

WITH params AS (
    SELECT
        {{limit_top_n}} AS limit_top_n,
        {{start_date_sql}} AS start_date,
        {{end_date_sql}} AS end_date,
        CAST({{periods_back}} AS INTEGER) AS periods_back,

        -- REQUIRED (authorization + partition pruning)
        {{company_ids_array}} AS company_ids,
        transform({{company_ids_array}}, x -> CAST(x AS VARCHAR)) AS company_ids_str,

        -- OPTIONAL filters (empty array => no filter)
        {{marketplaces_array}} AS marketplaces,
        {{parent_asins_array}} AS parent_asins,
        {{asins_array}} AS asins,
        {{row_types_array}} AS row_types,
        CASE
            WHEN cardinality({{revenue_abcd_class_array}}) = 0 THEN ARRAY['A','B']
            ELSE {{revenue_abcd_class_array}}
        END AS revenue_abcd_class,
        {{pareto_abc_class_array}} AS pareto_abc_class,
        {{strength_colors_array}} AS strength_colors,
        {{weakness_colors_array}} AS weakness_colors,
        {{opportunity_colors_array}} AS opportunity_colors,
        {{threshold_colors_array}} AS threshold_colors,
        {{click_trend_colors_array}} AS click_trend_colors,
        {{cart_add_trend_colors_array}} AS cart_add_trend_colors,
        {{purchase_trend_colors_array}} AS purchase_trend_colors
),
-- ─── RYG threshold values (pivoted from Iceberg table into one row) ──────────
thresholds AS (
    SELECT
        -- Strength
        MAX(CASE WHEN signal_group = 'strength' AND metric = 'click_rate'     AND color = 'green'  THEN threshold_value END) AS str_click_rate_g,
        MAX(CASE WHEN signal_group = 'strength' AND metric = 'purchase_rate'  AND color = 'green'  THEN threshold_value END) AS str_purchase_rate_g,
        MAX(CASE WHEN signal_group = 'strength' AND metric = 'click_rate'     AND color = 'yellow' THEN threshold_value END) AS str_click_rate_y,
        MAX(CASE WHEN signal_group = 'strength' AND metric = 'purchase_rate'  AND color = 'yellow' THEN threshold_value END) AS str_purchase_rate_y,
        -- Weakness
        MAX(CASE WHEN signal_group = 'weakness' AND metric = 'wow_delta'      AND color = 'red'    THEN threshold_value END) AS wk_wow_delta_r,
        MAX(CASE WHEN signal_group = 'weakness' AND metric = 'click_rate'     AND color = 'red'    THEN threshold_value END) AS wk_click_rate_r,
        MAX(CASE WHEN signal_group = 'weakness' AND metric = 'purchase_rate'  AND color = 'red'    THEN threshold_value END) AS wk_purchase_rate_r,
        MAX(CASE WHEN signal_group = 'weakness' AND metric = 'cart_add_rate'  AND color = 'yellow' THEN threshold_value END) AS wk_cart_add_rate_y,
        -- Opportunity
        MAX(CASE WHEN signal_group = 'opportunity' AND metric = 'cvr_ratio'     AND color = 'green'  THEN threshold_value END) AS opp_cvr_ratio_g,
        MAX(CASE WHEN signal_group = 'opportunity' AND metric = 'purchase_rate' AND color = 'yellow' THEN threshold_value END) AS opp_purchase_rate_y,
        MAX(CASE WHEN signal_group = 'opportunity' AND metric = 'click_rate'    AND color = 'yellow' THEN threshold_value END) AS opp_click_rate_y,
        -- Threshold/Ceiling
        MAX(CASE WHEN signal_group = 'threshold' AND metric = 'click_rate'    AND color = 'red'    THEN threshold_value END) AS th_click_rate_r,
        MAX(CASE WHEN signal_group = 'threshold' AND metric = 'purchase_rate' AND color = 'red'    THEN threshold_value END) AS th_purchase_rate_r,
        MAX(CASE WHEN signal_group = 'threshold' AND metric = 'click_rate'    AND color = 'yellow' THEN threshold_value END) AS th_click_rate_y,
        MAX(CASE WHEN signal_group = 'threshold' AND metric = 'purchase_rate' AND color = 'yellow' THEN threshold_value END) AS th_purchase_rate_y,
        -- Trend
        MAX(CASE WHEN signal_group = 'trend' AND metric = 'delta' AND color = 'green' THEN threshold_value END) AS trend_delta_g,
        MAX(CASE WHEN signal_group = 'trend' AND metric = 'delta' AND color = 'red'   THEN threshold_value END) AS trend_delta_r
    FROM "{{catalog}}"."brand_analytics_iceberg"."ryg_thresholds"
    WHERE user_id IS NULL
      AND tool = 'search_catalog_performance'
),
-- ─── Dimension tables ──────────────────────────────────────────────────────
marketplaces_dim AS (
    SELECT
        CAST(amazon_marketplace_id AS VARCHAR) AS amazon_marketplace_id,
        lower(country)    AS country,
        lower(code)       AS country_code,
        lower(name)       AS marketplace_name,
        lower(domain)     AS domain,
        id                AS marketplace_id
    FROM "{{catalog}}"."neonpanel_iceberg"."amazon_marketplaces"
),

-- Parent ASIN + ASIN attribute enrichment
asin_dim AS (
    SELECT
        child_asin        AS asin,
        parent_asin,
        marketplace_id,
        brand,
        product_family,
        revenue_abcd_class,
        pareto_abc_class,
        revenue_share
    FROM "{{catalog}}"."inventory_planning"."last_snapshot_inventory_planning"
),

asin_attrs AS (
    SELECT
        asin,
        marketplace_id,
        MAX(parent_asin)        AS parent_asin,
        MAX(brand)              AS brand,
        MAX(product_family)     AS product_family,
        MIN(revenue_abcd_class) AS revenue_abcd_class,
        MIN(pareto_abc_class)   AS pareto_abc_class,
        SUM(revenue_share)      AS revenue_share
    FROM asin_dim
    GROUP BY asin, marketplace_id
),

-- Company name lookup
companies_dim AS (
    SELECT
        CAST(id AS VARCHAR) AS company_id_str,
        name AS company_name
    FROM "{{catalog}}"."neonpanel_iceberg"."app_companies"
),

-- ─── Raw SP-API data ───────────────────────────────────────────────────────
raw AS (
    SELECT
        r.asin,
        r.week_start,
        r.year,
        CAST(r.date AS DATE)       AS report_date,
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
        CAST(r.ingest_company_id AS BIGINT) AS company_id,
        r.ingest_seller_id                  AS amazon_seller_id,
        r.rspec_marketplaceids
    FROM "{{catalog}}"."sp_api_iceberg"."brand_analytics_search_catalog_performance_report" r
    CROSS JOIN params p
    WHERE
        contains(p.company_ids_str, r.ingest_company_id)
),

-- ─── Enrich with marketplace + parent_asin + attributes ────────────────────
base_child AS (
    SELECT
        COALESCE(c.company_name, 'unknown')           AS company,
        COALESCE(m.marketplace_name, 'unknown')        AS marketplace,
        COALESCE(m.country_code, 'unknown')            AS marketplace_country_code,
        COALESCE(aa.parent_asin, r.asin)               AS parent_asin,
        COALESCE(aa.revenue_abcd_class, 'D')           AS revenue_abcd_class,
        COALESCE(aa.pareto_abc_class, 'C')             AS pareto_abc_class,
        COALESCE(aa.brand, 'unknown')                  AS brand,
        aa.revenue_share,
        CAST(NULL AS VARCHAR)                          AS title,
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
    LEFT JOIN companies_dim c
        ON c.company_id_str = CAST(r.company_id AS VARCHAR)
    LEFT JOIN asin_attrs aa
        ON aa.asin = r.asin
        AND aa.marketplace_id = m.marketplace_id
    CROSS JOIN params p
    WHERE
        (
            cardinality(p.marketplaces) = 0
            OR any_match(
                p.marketplaces,
                input -> lower(input) IN (
                    COALESCE(m.country_code, ''),
                    COALESCE(m.marketplace_name, '')
                )
            )
        )
        AND (cardinality(p.asins) = 0 OR any_match(p.asins, a -> lower(a) = lower(r.asin)))
        AND (cardinality(p.parent_asins) = 0 OR any_match(p.parent_asins, a -> lower(a) = lower(COALESCE(aa.parent_asin, r.asin))))
        AND (cardinality(p.revenue_abcd_class) = 0 OR any_match(p.revenue_abcd_class, rc -> upper(rc) = upper(COALESCE(aa.revenue_abcd_class, 'D'))))
        AND (cardinality(p.pareto_abc_class) = 0 OR any_match(p.pareto_abc_class, pc -> upper(pc) = upper(COALESCE(aa.pareto_abc_class, 'C'))))
),

latest AS (
    SELECT max(week_start) AS latest_week
    FROM base_child
),

date_bounds AS (
    SELECT
        COALESCE(
            p.start_date,
            date_add('week', -1 * (p.periods_back - 1), l.latest_week)
        ) AS start_date,
        COALESCE(
            p.end_date,
            l.latest_week
        ) AS end_date
    FROM params p
    CROSS JOIN latest l
),

window_bounds AS (
    SELECT
        start_date,
        end_date,
        date_add('week', -12, start_date) AS lookback_start
    FROM date_bounds
),

windowed AS (
    SELECT b.*
    FROM base_child b
    CROSS JOIN window_bounds d
    WHERE b.week_start BETWEEN d.lookback_start AND d.end_date
      AND b.year BETWEEN year(d.lookback_start) AND year(d.end_date)
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
    FROM windowed
    GROUP BY
        company,
        marketplace,
        marketplace_country_code,
        parent_asin,
        week_start,
        year
),

final_base AS (
    SELECT * FROM windowed
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
),

cvr_base AS (
    SELECT
        w.*,
        -- Delivery speed CVR (purchase per click)
        CASE
            WHEN w.clickdata_samedayshippingclickcount = 0 THEN NULL
            ELSE w.purchasedata_samedayshippingpurchasecount / w.clickdata_samedayshippingclickcount
        END AS cvr_same_day,
        CASE
            WHEN w.clickdata_onedayshippingclickcount = 0 THEN NULL
            ELSE w.purchasedata_onedayshippingpurchasecount / w.clickdata_onedayshippingclickcount
        END AS cvr_one_day,
        CASE
            WHEN w.clickdata_twodayshippingclickcount = 0 THEN NULL
            ELSE w.purchasedata_twodayshippingpurchasecount / w.clickdata_twodayshippingclickcount
        END AS cvr_two_day,
        CASE
            WHEN w.clickdata_samedayshippingclickcount = 0
                OR w.clickdata_twodayshippingclickcount = 0
                OR w.purchasedata_twodayshippingpurchasecount IS NULL
                OR w.purchasedata_samedayshippingpurchasecount IS NULL
                THEN NULL
            ELSE (w.purchasedata_samedayshippingpurchasecount / w.clickdata_samedayshippingclickcount)
                / (w.purchasedata_twodayshippingpurchasecount / w.clickdata_twodayshippingclickcount)
        END AS cvr_same_vs_two_ratio,
        CASE
            WHEN w.clickdata_onedayshippingclickcount = 0
                OR w.clickdata_twodayshippingclickcount = 0
                OR w.purchasedata_twodayshippingpurchasecount IS NULL
                OR w.purchasedata_onedayshippingpurchasecount IS NULL
                THEN NULL
            ELSE (w.purchasedata_onedayshippingpurchasecount / w.clickdata_onedayshippingclickcount)
                / (w.purchasedata_twodayshippingpurchasecount / w.clickdata_twodayshippingclickcount)
        END AS cvr_one_vs_two_ratio
    FROM with_deltas w
),

signal_base AS (
    SELECT
        w.*,
        -- Strength signal (thresholds from ryg_thresholds table)
        CASE
            WHEN w.kpi_click_rate IS NULL OR w.kpi_purchase_rate IS NULL THEN NULL
            WHEN w.kpi_click_rate >= t.str_click_rate_g AND w.kpi_purchase_rate >= t.str_purchase_rate_g THEN 'green'
            WHEN w.kpi_click_rate >= t.str_click_rate_y AND w.kpi_purchase_rate >= t.str_purchase_rate_y THEN 'yellow'
            ELSE 'red'
        END AS strength_color,
        CASE
            WHEN w.kpi_click_rate IS NULL OR w.kpi_purchase_rate IS NULL THEN 'insufficient_data'
            WHEN w.kpi_click_rate >= t.str_click_rate_g AND w.kpi_purchase_rate >= t.str_purchase_rate_g THEN 'strong_engagement_and_conversion'
            WHEN w.kpi_click_rate >= t.str_click_rate_y AND w.kpi_purchase_rate >= t.str_purchase_rate_y THEN 'acceptable_performance'
            ELSE 'weak_click_or_conversion'
        END AS strength_code,
        CASE
            WHEN w.kpi_click_rate IS NULL OR w.kpi_purchase_rate IS NULL THEN 'Not enough data to evaluate strength.'
            WHEN w.kpi_click_rate >= t.str_click_rate_g AND w.kpi_purchase_rate >= t.str_purchase_rate_g THEN 'Strong clickability and conversion.'
            WHEN w.kpi_click_rate >= t.str_click_rate_y AND w.kpi_purchase_rate >= t.str_purchase_rate_y THEN 'Performance is acceptable but not leading.'
            ELSE 'Underperforming click or conversion rate.'
        END AS strength_description,

        -- Weakness signal (thresholds from ryg_thresholds table)
        CASE
            WHEN w.kpi_click_rate_wow < t.wk_wow_delta_r AND w.kpi_purchase_rate_wow < t.wk_wow_delta_r THEN 'red'
            WHEN w.kpi_click_rate < t.wk_click_rate_r OR w.kpi_purchase_rate < t.wk_purchase_rate_r THEN 'red'
            WHEN w.kpi_cart_add_rate < t.wk_cart_add_rate_y THEN 'yellow'
            ELSE 'green'
        END AS weakness_color,
        CASE
            WHEN w.kpi_click_rate_wow < t.wk_wow_delta_r AND w.kpi_purchase_rate_wow < t.wk_wow_delta_r THEN 'engagement_decline'
            WHEN w.kpi_click_rate < t.wk_click_rate_r THEN 'low_click_rate'
            WHEN w.kpi_purchase_rate < t.wk_purchase_rate_r THEN 'low_conversion_rate'
            WHEN w.kpi_cart_add_rate < t.wk_cart_add_rate_y THEN 'low_cart_add_rate'
            ELSE 'no_major_weakness'
        END AS weakness_code,
        CASE
            WHEN w.kpi_click_rate_wow < t.wk_wow_delta_r AND w.kpi_purchase_rate_wow < t.wk_wow_delta_r THEN 'Clicks and purchases are declining week over week.'
            WHEN w.kpi_click_rate < t.wk_click_rate_r THEN 'Click rate is weak for this catalog item.'
            WHEN w.kpi_purchase_rate < t.wk_purchase_rate_r THEN 'Conversion rate is weak for this catalog item.'
            WHEN w.kpi_cart_add_rate < t.wk_cart_add_rate_y THEN 'Cart add rate is below target.'
            ELSE 'No critical weakness detected.'
        END AS weakness_description,

        -- Opportunity signal (thresholds from ryg_thresholds table)
        CASE
            WHEN COALESCE(w.cvr_same_vs_two_ratio, 0) >= t.opp_cvr_ratio_g OR COALESCE(w.cvr_one_vs_two_ratio, 0) >= t.opp_cvr_ratio_g THEN 'green'
            WHEN w.kpi_purchase_rate >= t.opp_purchase_rate_y AND w.kpi_click_rate >= t.opp_click_rate_y THEN 'yellow'
            ELSE 'red'
        END AS opportunity_color,
        CASE
            WHEN COALESCE(w.cvr_same_vs_two_ratio, 0) >= t.opp_cvr_ratio_g OR COALESCE(w.cvr_one_vs_two_ratio, 0) >= t.opp_cvr_ratio_g THEN 'fast_delivery_uplift'
            WHEN w.kpi_purchase_rate >= t.opp_purchase_rate_y AND w.kpi_click_rate >= t.opp_click_rate_y THEN 'scale_traffic'
            ELSE 'no_clear_opportunity'
        END AS opportunity_code,
        CASE
            WHEN COALESCE(w.cvr_same_vs_two_ratio, 0) >= t.opp_cvr_ratio_g OR COALESCE(w.cvr_one_vs_two_ratio, 0) >= t.opp_cvr_ratio_g
              THEN 'Fast-delivery conversion uplift; increase same/one-day availability if possible.'
            WHEN w.kpi_purchase_rate >= t.opp_purchase_rate_y AND w.kpi_click_rate >= t.opp_click_rate_y THEN 'Strong conversion with adequate clicks: consider scaling traffic.'
            ELSE 'No clear opportunity detected.'
        END AS opportunity_description,

        -- Threshold / ceiling signal (thresholds from ryg_thresholds table)
        CASE
            WHEN w.kpi_click_rate >= t.th_click_rate_r AND w.kpi_purchase_rate >= t.th_purchase_rate_r THEN 'red'
            WHEN w.kpi_click_rate >= t.th_click_rate_y AND w.kpi_purchase_rate >= t.th_purchase_rate_y THEN 'yellow'
            ELSE 'green'
        END AS threshold_color,
        CASE
            WHEN w.kpi_click_rate >= t.th_click_rate_r AND w.kpi_purchase_rate >= t.th_purchase_rate_r THEN 'conversion_ceiling'
            WHEN w.kpi_click_rate >= t.th_click_rate_y AND w.kpi_purchase_rate >= t.th_purchase_rate_y THEN 'approaching_ceiling'
            ELSE 'no_ceiling'
        END AS threshold_code,
        CASE
            WHEN w.kpi_click_rate >= t.th_click_rate_r AND w.kpi_purchase_rate >= t.th_purchase_rate_r THEN 'Likely near ceiling; growth may be limited by demand.'
            WHEN w.kpi_click_rate >= t.th_click_rate_y AND w.kpi_purchase_rate >= t.th_purchase_rate_y THEN 'Approaching ceiling; optimize for marginal gains.'
            ELSE 'No ceiling detected.'
        END AS threshold_description
    FROM cvr_base w
    CROSS JOIN thresholds t
),

final AS (
    SELECT
        sb.*,
        -- Trend signals (thresholds from ryg_thresholds table)
        CASE
            WHEN sb.kpi_click_rate_wow > t.trend_delta_g
             AND sb.kpi_click_rate_wolast4 > t.trend_delta_g
             AND sb.kpi_click_rate_wolast12 > t.trend_delta_g THEN 'green'
            WHEN sb.kpi_click_rate_wow < t.trend_delta_r
             AND sb.kpi_click_rate_wolast4 < t.trend_delta_r
             AND sb.kpi_click_rate_wolast12 < t.trend_delta_r THEN 'red'
            ELSE 'yellow'
        END AS kpi_click_rate_trend_signal,
        CASE
            WHEN sb.kpi_cart_add_rate_wow > t.trend_delta_g
             AND sb.kpi_cart_add_rate_wolast4 > t.trend_delta_g
             AND sb.kpi_cart_add_rate_wolast12 > t.trend_delta_g THEN 'green'
            WHEN sb.kpi_cart_add_rate_wow < t.trend_delta_r
             AND sb.kpi_cart_add_rate_wolast4 < t.trend_delta_r
             AND sb.kpi_cart_add_rate_wolast12 < t.trend_delta_r THEN 'red'
            ELSE 'yellow'
        END AS kpi_cart_add_rate_trend_signal,
        CASE
            WHEN sb.kpi_purchase_rate_wow > t.trend_delta_g
             AND sb.kpi_purchase_rate_wolast4 > t.trend_delta_g
             AND sb.kpi_purchase_rate_wolast12 > t.trend_delta_g THEN 'green'
            WHEN sb.kpi_purchase_rate_wow < t.trend_delta_r
             AND sb.kpi_purchase_rate_wolast4 < t.trend_delta_r
             AND sb.kpi_purchase_rate_wolast12 < t.trend_delta_r THEN 'red'
            ELSE 'yellow'
        END AS kpi_purchase_rate_trend_signal,
        json_format(CAST(map(ARRAY['color','code','description'], ARRAY[sb.strength_color, sb.strength_code, sb.strength_description]) AS JSON)) AS strength_signal,
        json_format(CAST(map(ARRAY['color','code','description'], ARRAY[sb.weakness_color, sb.weakness_code, sb.weakness_description]) AS JSON)) AS weakness_signal,
        json_format(CAST(map(ARRAY['color','code','description'], ARRAY[sb.opportunity_color, sb.opportunity_code, sb.opportunity_description]) AS JSON)) AS opportunity_signal,
        json_format(CAST(map(ARRAY['color','code','description'], ARRAY[sb.threshold_color, sb.threshold_code, sb.threshold_description]) AS JSON)) AS threshold_signal
    FROM signal_base sb
    CROSS JOIN thresholds t
)

SELECT
    f.*
FROM final f
CROSS JOIN params
CROSS JOIN date_bounds d
WHERE
    f.week_start BETWEEN d.start_date AND d.end_date
    AND (cardinality(params.row_types) = 0 OR any_match(params.row_types, rt -> lower(rt) = lower(f.row_type)))
    AND (cardinality(params.strength_colors) = 0 OR any_match(params.strength_colors, c -> lower(c) = lower(f.strength_color)))
    AND (cardinality(params.weakness_colors) = 0 OR any_match(params.weakness_colors, c -> lower(c) = lower(f.weakness_color)))
    AND (cardinality(params.opportunity_colors) = 0 OR any_match(params.opportunity_colors, c -> lower(c) = lower(f.opportunity_color)))
    AND (cardinality(params.threshold_colors) = 0 OR any_match(params.threshold_colors, c -> lower(c) = lower(f.threshold_color)))
    AND (cardinality(params.click_trend_colors) = 0 OR any_match(params.click_trend_colors, c -> lower(c) = lower(f.kpi_click_rate_trend_signal)))
    AND (cardinality(params.cart_add_trend_colors) = 0 OR any_match(params.cart_add_trend_colors, c -> lower(c) = lower(f.kpi_cart_add_rate_trend_signal)))
    AND (cardinality(params.purchase_trend_colors) = 0 OR any_match(params.purchase_trend_colors, c -> lower(c) = lower(f.kpi_purchase_rate_trend_signal)))
ORDER BY f.week_start DESC
LIMIT {{limit_top_n}};
