-- Tool query for search_catalog_performance (ClickHouse)
--
-- Source: etl.ba_search_catalog_performance — the weekly Search Catalog
-- Performance report, already joined to etl.ba_asin_attributes for parent_asin,
-- brand, product_family, title and the revenue/pareto classes. That single view
-- replaces the marketplaces_dim / asin_dim / asin_attrs enrichment CTEs the
-- Athena version rebuilt at query time.
--
-- Two groups of fields are recovered from raw_payload because migration 0036
-- types only the eight headline metrics. The producer serializes every exploded
-- report column into raw_payload, so these keys are the report's own flattened
-- names (verified against the live payload):
--   * the same/one/two-day delivery breakdown, which drives the opportunity signal
--   * the report's own date/startdate/enddate range
--
-- purchasedata_conversionrate is NOT published by Amazon in this report — it is
-- absent from raw_payload, so the typed staging.conversion_rate column is empty.
-- kpi_purchase_rate is therefore derived as purchases / clicks. The Athena query
-- used Amazon's reported value for child rows but derived that same ratio for
-- parent rows, so deriving both also removes a child/parent inconsistency.
-- kpi_click_rate is derived as clicks / impressions for the same reason.
--
-- NOTE: revenue_abcd_class / pareto_abc_class / revenue_share come from the
-- inventory-planning snapshot (see asin_revenue_class), so they are stable
-- between runs but remain as-of ASIN attributes, not the class in effect during
-- a past week. `classification_as_of` carries the snapshot load date.

WITH {{asin_class_cte_sql}},

-- ─── RYG threshold values (pivoted into one row) ────────────────────────────
-- Company-specific overrides win over system defaults (company_id IS NULL).
ryg_ranked AS (
    SELECT
        signal_group AS signal_group,
        metric AS metric,
        color AS color,
        threshold_value AS threshold_value,
        row_number() OVER (
            PARTITION BY tool, signal_group, metric, color
            ORDER BY if(isNotNull(company_id), 0, 1)
        ) AS rn
    FROM etl.ba_ryg_thresholds_current
    WHERE (company_id = {{ryg_company_id}} OR company_id IS NULL)
      AND tool IN ('scp', 'global')
),

-- toNullable is required: maxIf over an empty match set returns 0 for Float64,
-- which would silently read as "threshold met". A missing threshold must stay
-- NULL so the comparison is NULL and the signal falls through to its ELSE branch.
thresholds AS (
    SELECT
        -- Strength (scp)
        maxIf(toNullable(threshold_value), signal_group = 'strength' AND metric = 'click_rate' AND color = 'green') AS str_click_rate_g,
        maxIf(toNullable(threshold_value), signal_group = 'strength' AND metric = 'purchase_rate' AND color = 'green') AS str_purchase_rate_g,
        maxIf(toNullable(threshold_value), signal_group = 'strength' AND metric = 'click_rate' AND color = 'yellow') AS str_click_rate_y,
        maxIf(toNullable(threshold_value), signal_group = 'strength' AND metric = 'purchase_rate' AND color = 'yellow') AS str_purchase_rate_y,
        -- Opportunity (scp)
        maxIf(toNullable(threshold_value), signal_group = 'opportunity' AND metric = 'cvr_ratio' AND color = 'green') AS opp_cvr_ratio_g,
        -- Trend (global)
        maxIf(toNullable(threshold_value), signal_group = 'trend' AND metric = 'delta' AND color = 'green') AS trend_delta_g,
        maxIf(toNullable(threshold_value), signal_group = 'trend' AND metric = 'delta' AND color = 'red') AS trend_delta_r
    FROM ryg_ranked
    WHERE rn = 1
),

-- ─── Child rows: one report row per ASIN week ───────────────────────────────
base_child AS (
    SELECT
        ifNull(companies.name, 'unknown') AS company,
        lower(ifNull(marketplace.marketplace_name, 'unknown')) AS marketplace,
        lower(ifNull(marketplace.country_code, 'unknown')) AS marketplace_country_code,
        ifNull(nullIf(scp.parent_asin, ''), scp.asin) AS parent_asin,
        ifNull(cls.revenue_abcd_class, 'D') AS revenue_abcd_class,
        ifNull(cls.pareto_abc_class, 'C') AS pareto_abc_class,
        ifNull(nullIf(scp.brand, ''), 'unknown') AS brand,
        ifNull(nullIf(scp.product_family, ''), 'unknown') AS product_family,
        cls.revenue_share AS revenue_share,
        CAST(nullIf(scp.title, '') AS Nullable(String)) AS title,
        scp.asin AS asin,
        scp.week_start AS week_start,
        CAST(parseDateTimeBestEffortOrNull(JSONExtractString(scp.raw_payload, 'date')) AS Nullable(Date)) AS report_date,
        CAST(parseDateTimeBestEffortOrNull(JSONExtractString(scp.raw_payload, 'startdate')) AS Nullable(DateTime64(3))) AS startdate,
        CAST(parseDateTimeBestEffortOrNull(JSONExtractString(scp.raw_payload, 'enddate')) AS Nullable(DateTime64(3))) AS enddate,
        CAST(scp.impression_count AS Nullable(Float64)) AS impressiondata_impressioncount,
        CAST(scp.click_count AS Nullable(Float64)) AS clickdata_clickcount,
        CAST(scp.cart_add_count AS Nullable(Float64)) AS cartadddata_cartaddcount,
        CAST(scp.purchase_count AS Nullable(Float64)) AS purchasedata_purchasecount,
        CAST(scp.click_rate AS Nullable(Float64)) AS clickdata_clickrate,
        CAST(
            if(ifNull(scp.click_count, 0) = 0, NULL, scp.purchase_count / scp.click_count)
            AS Nullable(Float64)
        ) AS purchasedata_conversionrate,
        CAST(scp.search_traffic_sales AS Nullable(Float64)) AS purchasedata_searchtrafficsales_amount,
        CAST(nullIf(scp.currency_code, '') AS Nullable(String)) AS purchasedata_searchtrafficsales_currencycode,
        JSONExtract(scp.raw_payload, 'cartadddata_onedayshippingcartaddcount', 'Nullable(Float64)') AS cartadddata_onedayshippingcartaddcount,
        JSONExtract(scp.raw_payload, 'cartadddata_samedayshippingcartaddcount', 'Nullable(Float64)') AS cartadddata_samedayshippingcartaddcount,
        JSONExtract(scp.raw_payload, 'cartadddata_twodayshippingcartaddcount', 'Nullable(Float64)') AS cartadddata_twodayshippingcartaddcount,
        JSONExtract(scp.raw_payload, 'clickdata_onedayshippingclickcount', 'Nullable(Float64)') AS clickdata_onedayshippingclickcount,
        JSONExtract(scp.raw_payload, 'clickdata_samedayshippingclickcount', 'Nullable(Float64)') AS clickdata_samedayshippingclickcount,
        JSONExtract(scp.raw_payload, 'clickdata_twodayshippingclickcount', 'Nullable(Float64)') AS clickdata_twodayshippingclickcount,
        JSONExtract(scp.raw_payload, 'purchasedata_onedayshippingpurchasecount', 'Nullable(Float64)') AS purchasedata_onedayshippingpurchasecount,
        JSONExtract(scp.raw_payload, 'purchasedata_samedayshippingpurchasecount', 'Nullable(Float64)') AS purchasedata_samedayshippingpurchasecount,
        JSONExtract(scp.raw_payload, 'purchasedata_twodayshippingpurchasecount', 'Nullable(Float64)') AS purchasedata_twodayshippingpurchasecount,
        JSONExtract(scp.raw_payload, 'impressiondata_onedayshippingimpressioncount', 'Nullable(Float64)') AS impressiondata_onedayshippingimpressioncount,
        JSONExtract(scp.raw_payload, 'impressiondata_samedayshippingimpressioncount', 'Nullable(Float64)') AS impressiondata_samedayshippingimpressioncount,
        JSONExtract(scp.raw_payload, 'impressiondata_twodayshippingimpressioncount', 'Nullable(Float64)') AS impressiondata_twodayshippingimpressioncount,
        scp.company_id AS company_id,
        scp.amazon_seller_id AS amazon_seller_id,
        -- KPI base calculations (see header: both rates are derived, not reported)
        CAST(
            if(ifNull(scp.impression_count, 0) = 0, NULL, scp.click_count / scp.impression_count)
            AS Nullable(Float64)
        ) AS kpi_click_rate,
        CAST(
            if(ifNull(scp.impression_count, 0) = 0, NULL, scp.cart_add_count / scp.impression_count)
            AS Nullable(Float64)
        ) AS kpi_cart_add_rate,
        CAST(
            if(ifNull(scp.click_count, 0) = 0, NULL, scp.purchase_count / scp.click_count)
            AS Nullable(Float64)
        ) AS kpi_purchase_rate,
        CAST(
            if(ifNull(scp.click_count, 0) = 0, NULL, scp.search_traffic_sales / scp.click_count)
            AS Nullable(Float64)
        ) AS kpi_sales_per_click,
        CAST(
            if(ifNull(scp.impression_count, 0) = 0, NULL, scp.search_traffic_sales / scp.impression_count)
            AS Nullable(Float64)
        ) AS kpi_sales_per_impression,
        CAST('child' AS String) AS row_type
    FROM etl.ba_search_catalog_performance AS scp
    {{asin_class_join_sql}}
    LEFT JOIN etl.ba_marketplaces AS marketplace
        ON scp.marketplace_id = marketplace.marketplace_id
    -- toString on both sides: app_companies.id and company_id are not guaranteed
    -- to share an integer type, and this dimension is tiny.
    LEFT JOIN app.app_companies AS companies
        ON toString(companies.id) = toString(scp.company_id)
    WHERE
        has({{company_ids_array}}, scp.company_id)
        AND (
            length({{marketplaces_array}}) = 0
            OR arrayExists(
                input -> lower(input) IN (
                    lower(ifNull(marketplace.country_code, '')),
                    lower(ifNull(marketplace.marketplace_name, ''))
                ),
                {{marketplaces_array}}
            )
        )
        AND (length({{asins_array}}) = 0 OR arrayExists(a -> lower(a) = lower(scp.asin), {{asins_array}}))
        AND (
            length({{parent_asins_array}}) = 0
            OR arrayExists(a -> lower(a) = lower(ifNull(nullIf(scp.parent_asin, ''), scp.asin)), {{parent_asins_array}})
        )
        AND (
            length({{product_families_array}}) = 0
            OR arrayExists(pf -> lower(pf) = lower(ifNull(scp.product_family, '')), {{product_families_array}})
        )
        -- Deliberate: an empty revenue_abcd_class filter means A+B only, not
        -- "no filter". This reproduces the Athena params default.
        AND has(
            arrayMap(x -> upper(x), if(length({{revenue_abcd_class_array}}) = 0, ['A', 'B'], {{revenue_abcd_class_array}})),
            upper(ifNull(cls.revenue_abcd_class, 'D'))
        )
        AND (
            length({{pareto_abc_class_array}}) = 0
            OR arrayExists(pc -> upper(pc) = upper(ifNull(cls.pareto_abc_class, 'C')), {{pareto_abc_class_array}})
        )
),

-- ─── Date window ────────────────────────────────────────────────────────────
-- 12 extra weeks are read before start_date so the rolling baselines below have
-- history; the final SELECT trims back to the requested range.
date_bounds AS (
    SELECT
        ifNull({{start_date_sql}}, addWeeks(max(week_start), -1 * ({{periods_back}} - 1))) AS start_date,
        ifNull({{end_date_sql}}, max(week_start)) AS end_date,
        addWeeks(ifNull({{start_date_sql}}, addWeeks(max(week_start), -1 * ({{periods_back}} - 1))), -12) AS lookback_start
    FROM base_child
),

windowed AS (
    SELECT *
    FROM base_child
    WHERE week_start >= (SELECT lookback_start FROM date_bounds)
      AND week_start <= (SELECT end_date FROM date_bounds)
),

-- ─── Parent rows: roll child ASINs up to parent_asin ────────────────────────
-- Split in two: ClickHouse rejects an aggregate nested inside another expression
-- that is itself aggregated once the CTE is inlined (ILLEGAL_AGGREGATION), so
-- parent_sums does the pure aggregation and parent_agg derives the ratios.
parent_sums AS (
    SELECT
        company AS company,
        marketplace AS marketplace,
        marketplace_country_code AS marketplace_country_code,
        parent_asin AS parent_asin,
        week_start AS week_start,
        max(revenue_abcd_class) AS revenue_abcd_class,
        max(pareto_abc_class) AS pareto_abc_class,
        max(brand) AS brand,
        max(product_family) AS product_family,
        sum(revenue_share) AS revenue_share,
        max(report_date) AS report_date,
        max(startdate) AS startdate,
        max(enddate) AS enddate,
        sum(impressiondata_impressioncount) AS impressiondata_impressioncount,
        sum(clickdata_clickcount) AS clickdata_clickcount,
        sum(cartadddata_cartaddcount) AS cartadddata_cartaddcount,
        sum(purchasedata_purchasecount) AS purchasedata_purchasecount,
        sum(purchasedata_searchtrafficsales_amount) AS purchasedata_searchtrafficsales_amount,
        max(purchasedata_searchtrafficsales_currencycode) AS purchasedata_searchtrafficsales_currencycode,
        sum(cartadddata_onedayshippingcartaddcount) AS cartadddata_onedayshippingcartaddcount,
        sum(cartadddata_samedayshippingcartaddcount) AS cartadddata_samedayshippingcartaddcount,
        sum(cartadddata_twodayshippingcartaddcount) AS cartadddata_twodayshippingcartaddcount,
        sum(clickdata_onedayshippingclickcount) AS clickdata_onedayshippingclickcount,
        sum(clickdata_samedayshippingclickcount) AS clickdata_samedayshippingclickcount,
        sum(clickdata_twodayshippingclickcount) AS clickdata_twodayshippingclickcount,
        sum(purchasedata_onedayshippingpurchasecount) AS purchasedata_onedayshippingpurchasecount,
        sum(purchasedata_samedayshippingpurchasecount) AS purchasedata_samedayshippingpurchasecount,
        sum(purchasedata_twodayshippingpurchasecount) AS purchasedata_twodayshippingpurchasecount,
        sum(impressiondata_onedayshippingimpressioncount) AS impressiondata_onedayshippingimpressioncount,
        sum(impressiondata_samedayshippingimpressioncount) AS impressiondata_samedayshippingimpressioncount,
        sum(impressiondata_twodayshippingimpressioncount) AS impressiondata_twodayshippingimpressioncount,
        max(company_id) AS company_id,
        max(amazon_seller_id) AS amazon_seller_id
    FROM windowed
    GROUP BY
        company,
        marketplace,
        marketplace_country_code,
        parent_asin,
        week_start
),

-- Column list and order must match `windowed` exactly for the UNION ALL below.
parent_agg AS (
    SELECT
        company AS company,
        marketplace AS marketplace,
        marketplace_country_code AS marketplace_country_code,
        parent_asin AS parent_asin,
        revenue_abcd_class AS revenue_abcd_class,
        pareto_abc_class AS pareto_abc_class,
        brand AS brand,
        product_family AS product_family,
        CAST(revenue_share AS Nullable(Float64)) AS revenue_share,
        CAST(NULL AS Nullable(String)) AS title,
        parent_asin AS asin,
        week_start AS week_start,
        CAST(report_date AS Nullable(Date)) AS report_date,
        CAST(startdate AS Nullable(DateTime64(3))) AS startdate,
        CAST(enddate AS Nullable(DateTime64(3))) AS enddate,
        CAST(impressiondata_impressioncount AS Nullable(Float64)) AS impressiondata_impressioncount,
        CAST(clickdata_clickcount AS Nullable(Float64)) AS clickdata_clickcount,
        CAST(cartadddata_cartaddcount AS Nullable(Float64)) AS cartadddata_cartaddcount,
        CAST(purchasedata_purchasecount AS Nullable(Float64)) AS purchasedata_purchasecount,
        CAST(
            if(ifNull(impressiondata_impressioncount, 0) = 0, NULL,
               clickdata_clickcount / impressiondata_impressioncount)
            AS Nullable(Float64)
        ) AS clickdata_clickrate,
        CAST(
            if(ifNull(clickdata_clickcount, 0) = 0, NULL,
               purchasedata_purchasecount / clickdata_clickcount)
            AS Nullable(Float64)
        ) AS purchasedata_conversionrate,
        CAST(purchasedata_searchtrafficsales_amount AS Nullable(Float64)) AS purchasedata_searchtrafficsales_amount,
        CAST(purchasedata_searchtrafficsales_currencycode AS Nullable(String)) AS purchasedata_searchtrafficsales_currencycode,
        CAST(cartadddata_onedayshippingcartaddcount AS Nullable(Float64)) AS cartadddata_onedayshippingcartaddcount,
        CAST(cartadddata_samedayshippingcartaddcount AS Nullable(Float64)) AS cartadddata_samedayshippingcartaddcount,
        CAST(cartadddata_twodayshippingcartaddcount AS Nullable(Float64)) AS cartadddata_twodayshippingcartaddcount,
        CAST(clickdata_onedayshippingclickcount AS Nullable(Float64)) AS clickdata_onedayshippingclickcount,
        CAST(clickdata_samedayshippingclickcount AS Nullable(Float64)) AS clickdata_samedayshippingclickcount,
        CAST(clickdata_twodayshippingclickcount AS Nullable(Float64)) AS clickdata_twodayshippingclickcount,
        CAST(purchasedata_onedayshippingpurchasecount AS Nullable(Float64)) AS purchasedata_onedayshippingpurchasecount,
        CAST(purchasedata_samedayshippingpurchasecount AS Nullable(Float64)) AS purchasedata_samedayshippingpurchasecount,
        CAST(purchasedata_twodayshippingpurchasecount AS Nullable(Float64)) AS purchasedata_twodayshippingpurchasecount,
        CAST(impressiondata_onedayshippingimpressioncount AS Nullable(Float64)) AS impressiondata_onedayshippingimpressioncount,
        CAST(impressiondata_samedayshippingimpressioncount AS Nullable(Float64)) AS impressiondata_samedayshippingimpressioncount,
        CAST(impressiondata_twodayshippingimpressioncount AS Nullable(Float64)) AS impressiondata_twodayshippingimpressioncount,
        company_id AS company_id,
        amazon_seller_id AS amazon_seller_id,
        CAST(
            if(ifNull(impressiondata_impressioncount, 0) = 0, NULL,
               clickdata_clickcount / impressiondata_impressioncount)
            AS Nullable(Float64)
        ) AS kpi_click_rate,
        CAST(
            if(ifNull(impressiondata_impressioncount, 0) = 0, NULL,
               cartadddata_cartaddcount / impressiondata_impressioncount)
            AS Nullable(Float64)
        ) AS kpi_cart_add_rate,
        CAST(
            if(ifNull(clickdata_clickcount, 0) = 0, NULL,
               purchasedata_purchasecount / clickdata_clickcount)
            AS Nullable(Float64)
        ) AS kpi_purchase_rate,
        CAST(
            if(ifNull(clickdata_clickcount, 0) = 0, NULL,
               purchasedata_searchtrafficsales_amount / clickdata_clickcount)
            AS Nullable(Float64)
        ) AS kpi_sales_per_click,
        CAST(
            if(ifNull(impressiondata_impressioncount, 0) = 0, NULL,
               purchasedata_searchtrafficsales_amount / impressiondata_impressioncount)
            AS Nullable(Float64)
        ) AS kpi_sales_per_impression,
        CAST('parent' AS String) AS row_type
    FROM parent_sums
),

final_base AS (
    SELECT * FROM windowed
    UNION ALL
    SELECT * FROM parent_agg
),

-- ─── Week-over-week and rolling-baseline deltas ─────────────────────────────
-- lagInFrame needs the explicit ROWS frame; the default RANGE frame does not step
-- back exactly one row. toNullable + NULL default keeps "no prior week" as NULL
-- rather than a fabricated zero delta.
with_deltas AS (
    SELECT
        fb.*,
        fb.kpi_click_rate - lagInFrame(toNullable(fb.kpi_click_rate), 1, NULL) OVER (
            PARTITION BY fb.company_id, fb.marketplace_country_code, fb.row_type, fb.parent_asin, fb.asin
            ORDER BY fb.week_start
            ROWS BETWEEN 1 PRECEDING AND CURRENT ROW
        ) AS kpi_click_rate_wow,
        fb.kpi_click_rate - avg(fb.kpi_click_rate) OVER (
            PARTITION BY fb.company_id, fb.marketplace_country_code, fb.row_type, fb.parent_asin, fb.asin
            ORDER BY fb.week_start
            ROWS BETWEEN 4 PRECEDING AND 1 PRECEDING
        ) AS kpi_click_rate_wolast4,
        fb.kpi_click_rate - avg(fb.kpi_click_rate) OVER (
            PARTITION BY fb.company_id, fb.marketplace_country_code, fb.row_type, fb.parent_asin, fb.asin
            ORDER BY fb.week_start
            ROWS BETWEEN 12 PRECEDING AND 1 PRECEDING
        ) AS kpi_click_rate_wolast12,
        fb.kpi_cart_add_rate - lagInFrame(toNullable(fb.kpi_cart_add_rate), 1, NULL) OVER (
            PARTITION BY fb.company_id, fb.marketplace_country_code, fb.row_type, fb.parent_asin, fb.asin
            ORDER BY fb.week_start
            ROWS BETWEEN 1 PRECEDING AND CURRENT ROW
        ) AS kpi_cart_add_rate_wow,
        fb.kpi_cart_add_rate - avg(fb.kpi_cart_add_rate) OVER (
            PARTITION BY fb.company_id, fb.marketplace_country_code, fb.row_type, fb.parent_asin, fb.asin
            ORDER BY fb.week_start
            ROWS BETWEEN 4 PRECEDING AND 1 PRECEDING
        ) AS kpi_cart_add_rate_wolast4,
        fb.kpi_cart_add_rate - avg(fb.kpi_cart_add_rate) OVER (
            PARTITION BY fb.company_id, fb.marketplace_country_code, fb.row_type, fb.parent_asin, fb.asin
            ORDER BY fb.week_start
            ROWS BETWEEN 12 PRECEDING AND 1 PRECEDING
        ) AS kpi_cart_add_rate_wolast12,
        fb.kpi_purchase_rate - lagInFrame(toNullable(fb.kpi_purchase_rate), 1, NULL) OVER (
            PARTITION BY fb.company_id, fb.marketplace_country_code, fb.row_type, fb.parent_asin, fb.asin
            ORDER BY fb.week_start
            ROWS BETWEEN 1 PRECEDING AND CURRENT ROW
        ) AS kpi_purchase_rate_wow,
        fb.kpi_purchase_rate - avg(fb.kpi_purchase_rate) OVER (
            PARTITION BY fb.company_id, fb.marketplace_country_code, fb.row_type, fb.parent_asin, fb.asin
            ORDER BY fb.week_start
            ROWS BETWEEN 4 PRECEDING AND 1 PRECEDING
        ) AS kpi_purchase_rate_wolast4,
        fb.kpi_purchase_rate - avg(fb.kpi_purchase_rate) OVER (
            PARTITION BY fb.company_id, fb.marketplace_country_code, fb.row_type, fb.parent_asin, fb.asin
            ORDER BY fb.week_start
            ROWS BETWEEN 12 PRECEDING AND 1 PRECEDING
        ) AS kpi_purchase_rate_wolast12
    FROM final_base AS fb
),

-- ─── Delivery-speed conversion rates ────────────────────────────────────────
-- The `= 0` guard on the two-day purchase count is new: it is the ratio's
-- denominator, and ClickHouse returns +inf rather than raising on divide-by-zero,
-- which would score as a false 'green' shipping_alpha opportunity.
cvr_base AS (
    SELECT
        w.*,
        if(ifNull(w.clickdata_samedayshippingclickcount, 0) = 0, NULL,
           w.purchasedata_samedayshippingpurchasecount / w.clickdata_samedayshippingclickcount) AS cvr_same_day,
        if(ifNull(w.clickdata_onedayshippingclickcount, 0) = 0, NULL,
           w.purchasedata_onedayshippingpurchasecount / w.clickdata_onedayshippingclickcount) AS cvr_one_day,
        if(ifNull(w.clickdata_twodayshippingclickcount, 0) = 0, NULL,
           w.purchasedata_twodayshippingpurchasecount / w.clickdata_twodayshippingclickcount) AS cvr_two_day,
        if(
            ifNull(w.clickdata_samedayshippingclickcount, 0) = 0
            OR ifNull(w.clickdata_twodayshippingclickcount, 0) = 0
            OR w.purchasedata_twodayshippingpurchasecount IS NULL
            OR w.purchasedata_samedayshippingpurchasecount IS NULL
            OR w.purchasedata_twodayshippingpurchasecount = 0,
            NULL,
            (w.purchasedata_samedayshippingpurchasecount / w.clickdata_samedayshippingclickcount)
            / (w.purchasedata_twodayshippingpurchasecount / w.clickdata_twodayshippingclickcount)
        ) AS cvr_same_vs_two_ratio,
        if(
            ifNull(w.clickdata_onedayshippingclickcount, 0) = 0
            OR ifNull(w.clickdata_twodayshippingclickcount, 0) = 0
            OR w.purchasedata_twodayshippingpurchasecount IS NULL
            OR w.purchasedata_onedayshippingpurchasecount IS NULL
            OR w.purchasedata_twodayshippingpurchasecount = 0,
            NULL,
            (w.purchasedata_onedayshippingpurchasecount / w.clickdata_onedayshippingclickcount)
            / (w.purchasedata_twodayshippingpurchasecount / w.clickdata_twodayshippingclickcount)
        ) AS cvr_one_vs_two_ratio
    FROM with_deltas AS w
),

-- ─── Strength / weakness / opportunity / ceiling signals ────────────────────
signal_base AS (
    SELECT
        w.*,
        -- Strength signal (green/yellow/red)
        multiIf(
            w.kpi_click_rate IS NULL OR w.kpi_purchase_rate IS NULL, NULL,
            w.kpi_click_rate >= t.str_click_rate_g AND w.kpi_purchase_rate >= t.str_purchase_rate_g, 'green',
            w.kpi_click_rate >= t.str_click_rate_y OR w.kpi_purchase_rate >= t.str_purchase_rate_y, 'yellow',
            'red'
        ) AS strength_color,
        multiIf(
            w.kpi_click_rate IS NULL OR w.kpi_purchase_rate IS NULL, 'insufficient_data',
            w.kpi_click_rate >= t.str_click_rate_g AND w.kpi_purchase_rate >= t.str_purchase_rate_g, 'high_ctr',
            w.kpi_click_rate >= t.str_click_rate_y OR w.kpi_purchase_rate >= t.str_purchase_rate_y, 'decent_ctr',
            'weak_click_or_conversion'
        ) AS strength_code,
        multiIf(
            w.kpi_click_rate IS NULL OR w.kpi_purchase_rate IS NULL, 'Not enough data to evaluate strength.',
            w.kpi_click_rate >= t.str_click_rate_g AND w.kpi_purchase_rate >= t.str_purchase_rate_g, 'ASIN CTR and conversion are excellent for search results.',
            w.kpi_click_rate >= t.str_click_rate_y OR w.kpi_purchase_rate >= t.str_purchase_rate_y, 'Moderate CTR or conversion; above average but not leading.',
            'Underperforming click or conversion rate.'
        ) AS strength_description,

        -- Weakness signal (no scp weakness rows are evaluated → always green)
        CAST('green' AS String) AS weakness_color,
        CAST('no_major_weakness' AS String) AS weakness_code,
        CAST('No critical weakness detected.' AS String) AS weakness_description,

        -- Opportunity signal (fast-delivery CVR uplift)
        if(
            ifNull(w.cvr_same_vs_two_ratio, 0) >= t.opp_cvr_ratio_g
            OR ifNull(w.cvr_one_vs_two_ratio, 0) >= t.opp_cvr_ratio_g,
            'green', 'red'
        ) AS opportunity_color,
        if(
            ifNull(w.cvr_same_vs_two_ratio, 0) >= t.opp_cvr_ratio_g
            OR ifNull(w.cvr_one_vs_two_ratio, 0) >= t.opp_cvr_ratio_g,
            'shipping_alpha', 'no_clear_opportunity'
        ) AS opportunity_code,
        if(
            ifNull(w.cvr_same_vs_two_ratio, 0) >= t.opp_cvr_ratio_g
            OR ifNull(w.cvr_one_vs_two_ratio, 0) >= t.opp_cvr_ratio_g,
            '1-Day delivery provides >30% CVR lift. Scale FBA inventory.',
            'No clear opportunity detected.'
        ) AS opportunity_description,

        -- Threshold / ceiling signal (always green for now)
        CAST('green' AS String) AS threshold_color,
        CAST('no_ceiling' AS String) AS threshold_code,
        CAST('No ceiling detected.' AS String) AS threshold_description
    FROM cvr_base AS w
    CROSS JOIN thresholds AS t
),

final AS (
    SELECT
        sb.*,
        -- Trend signals (thresholds from analytics.ba_ryg_thresholds)
        multiIf(
            sb.kpi_click_rate_wow > t.trend_delta_g
            AND sb.kpi_click_rate_wolast4 > t.trend_delta_g
            AND sb.kpi_click_rate_wolast12 > t.trend_delta_g, 'green',
            sb.kpi_click_rate_wow < t.trend_delta_r
            AND sb.kpi_click_rate_wolast4 < t.trend_delta_r
            AND sb.kpi_click_rate_wolast12 < t.trend_delta_r, 'red',
            'yellow'
        ) AS kpi_click_rate_trend_signal,
        multiIf(
            sb.kpi_cart_add_rate_wow > t.trend_delta_g
            AND sb.kpi_cart_add_rate_wolast4 > t.trend_delta_g
            AND sb.kpi_cart_add_rate_wolast12 > t.trend_delta_g, 'green',
            sb.kpi_cart_add_rate_wow < t.trend_delta_r
            AND sb.kpi_cart_add_rate_wolast4 < t.trend_delta_r
            AND sb.kpi_cart_add_rate_wolast12 < t.trend_delta_r, 'red',
            'yellow'
        ) AS kpi_cart_add_rate_trend_signal,
        multiIf(
            sb.kpi_purchase_rate_wow > t.trend_delta_g
            AND sb.kpi_purchase_rate_wolast4 > t.trend_delta_g
            AND sb.kpi_purchase_rate_wolast12 > t.trend_delta_g, 'green',
            sb.kpi_purchase_rate_wow < t.trend_delta_r
            AND sb.kpi_purchase_rate_wolast4 < t.trend_delta_r
            AND sb.kpi_purchase_rate_wolast12 < t.trend_delta_r, 'red',
            'yellow'
        ) AS kpi_purchase_rate_trend_signal,
        toJSONString(map(
            'color', ifNull(sb.strength_color, ''),
            'code', sb.strength_code,
            'description', sb.strength_description
        )) AS strength_signal,
        toJSONString(map(
            'color', sb.weakness_color,
            'code', sb.weakness_code,
            'description', sb.weakness_description
        )) AS weakness_signal,
        toJSONString(map(
            'color', sb.opportunity_color,
            'code', sb.opportunity_code,
            'description', sb.opportunity_description
        )) AS opportunity_signal,
        toJSONString(map(
            'color', sb.threshold_color,
            'code', sb.threshold_code,
            'description', sb.threshold_description
        )) AS threshold_signal
    FROM signal_base AS sb
    CROSS JOIN thresholds AS t
)

SELECT
    f.*,
    (SELECT max(classification_as_of) FROM asin_revenue_class) AS classification_as_of
FROM final AS f
WHERE
    f.week_start >= (SELECT start_date FROM date_bounds)
    AND f.week_start <= (SELECT end_date FROM date_bounds)
    AND (length({{row_types_array}}) = 0 OR arrayExists(rt -> lower(rt) = lower(f.row_type), {{row_types_array}}))
    AND (length({{strength_colors_array}}) = 0 OR arrayExists(c -> lower(c) = lower(ifNull(f.strength_color, '')), {{strength_colors_array}}))
    AND (length({{weakness_colors_array}}) = 0 OR arrayExists(c -> lower(c) = lower(f.weakness_color), {{weakness_colors_array}}))
    AND (length({{opportunity_colors_array}}) = 0 OR arrayExists(c -> lower(c) = lower(f.opportunity_color), {{opportunity_colors_array}}))
    AND (length({{threshold_colors_array}}) = 0 OR arrayExists(c -> lower(c) = lower(f.threshold_color), {{threshold_colors_array}}))
    AND (length({{click_trend_colors_array}}) = 0 OR arrayExists(c -> lower(c) = lower(f.kpi_click_rate_trend_signal), {{click_trend_colors_array}}))
    AND (length({{cart_add_trend_colors_array}}) = 0 OR arrayExists(c -> lower(c) = lower(f.kpi_cart_add_rate_trend_signal), {{cart_add_trend_colors_array}}))
    AND (length({{purchase_trend_colors_array}}) = 0 OR arrayExists(c -> lower(c) = lower(f.kpi_purchase_rate_trend_signal), {{purchase_trend_colors_array}}))
ORDER BY f.week_start DESC
LIMIT {{limit_top_n}};
