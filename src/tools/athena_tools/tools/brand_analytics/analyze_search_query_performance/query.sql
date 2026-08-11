-- Tool query for brand_analytics_analyze_search_query_performance (ClickHouse)
--
-- Source: etl.ba_search_query_performance — the weekly Search Query Performance
-- report already joined to etl.ba_asin_attributes for parent_asin, brand,
-- product_family, title and the revenue/pareto classes. That single view replaces
-- the asin_attributes / amazon_listings / amazon_marketplaces / app_companies
-- enrichment joins the Athena snapshot ETL rebuilt at load time.
--
-- The Athena version read a PRE-MATERIALIZED snapshot table that already held
-- both child and parent rows plus the kpi_* columns. ClickHouse has no such
-- table, so this query rebuilds both from the report rows. The kpi_* definitions
-- are ported verbatim from search_query_performance.sql:
--   kpi_impression_share = asin_impression_share (as reported by Amazon)
--   kpi_click_share      = asin_click_share      (as reported by Amazon)
--   kpi_cart_add_rate    = total_cart_add_rate   (MARKET rate, not ASIN-level)
--   kpi_purchase_rate    = total_purchase_rate   (MARKET rate, not ASIN-level)
--   kpi_ctr_advantage    = click_share / impression_share  (a RATIO, not a delta)
--
-- Fields absent from the typed staging columns are recovered from raw_payload,
-- whose keys are the report's own flattened names (verified against the live
-- payload): the delivery-speed breakdown that drives the opportunity signal, the
-- median price columns, the report date range, and rspec_marketplaceids.
--
-- BEHAVIOUR NOTE 1 — parent grain. Parent rows are grouped by
-- (company, marketplace, marketplace_country_code, parent_asin, week_start) and
-- NOT by search query, exactly as the Athena snapshot ETL did. A parent row
-- therefore aggregates across EVERY search query for that parent ASIN, and its
-- searchquerydata_searchquery is an arbitrary max() pick. Preserved deliberately
-- so the output contract is unchanged; see README for the case to revisit it.
--
-- BEHAVIOUR NOTE 2 — filter ordering. Athena aggregated parents in the ETL over
-- all child rows and only then applied query filters. Here the parents are built
-- at query time from rows that are already filtered, so the child-level filters
-- (asins, search_terms, intent_ids) now also narrow what a parent row sums.
-- Parent-level filters (marketplaces, parent_asins, product_family, the revenue
-- and pareto classes) are unaffected because every child of a parent shares them.
--
-- NOTE: revenue_abcd_class / pareto_abc_class / revenue_share are rolling
-- last-30-day, as-of ASIN attributes, not the class in effect during a past week.

WITH {{term_intents_cte_sql}},

-- ─── RYG threshold values (pivoted into one row) ────────────────────────────
-- Company-specific overrides win over system defaults (company_id IS NULL).
ryg_ranked AS (
    SELECT
        tool AS tool,
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
      AND tool IN ('sqp', 'global')
),

-- toNullable is required: maxIf over an empty match set returns 0 for Float64,
-- which would silently read as "threshold met". A missing threshold must stay
-- NULL so the comparison is NULL and the signal falls through to its ELSE branch.
thresholds AS (
    SELECT
        -- Strength (sqp)
        maxIf(toNullable(threshold_value), tool = 'sqp' AND signal_group = 'strength' AND metric = 'click_share' AND color = 'green') AS str_click_share_g,
        maxIf(toNullable(threshold_value), tool = 'sqp' AND signal_group = 'strength' AND metric = 'purchase_rate' AND color = 'green') AS str_purchase_rate_g,
        maxIf(toNullable(threshold_value), tool = 'sqp' AND signal_group = 'strength' AND metric = 'click_share' AND color = 'yellow') AS str_click_share_y,
        maxIf(toNullable(threshold_value), tool = 'sqp' AND signal_group = 'strength' AND metric = 'purchase_rate' AND color = 'yellow') AS str_purchase_rate_y,
        -- Weakness (sqp)
        maxIf(toNullable(threshold_value), tool = 'sqp' AND signal_group = 'weakness' AND metric = 'click_share' AND color = 'red') AS wk_click_share_r,
        maxIf(toNullable(threshold_value), tool = 'sqp' AND signal_group = 'weakness' AND metric = 'purchase_rate' AND color = 'red') AS wk_purchase_rate_r,
        -- Opportunity (sqp)
        maxIf(toNullable(threshold_value), tool = 'sqp' AND signal_group = 'opportunity' AND metric = 'cvr_ratio' AND color = 'green') AS opp_cvr_ratio_g,
        maxIf(toNullable(threshold_value), tool = 'sqp' AND signal_group = 'opportunity' AND metric = 'impression_share' AND color = 'green') AS opp_impression_share_g,
        -- Trend (global)
        maxIf(toNullable(threshold_value), tool = 'global' AND signal_group = 'trend' AND metric = 'delta' AND color = 'green') AS trend_delta_g,
        maxIf(toNullable(threshold_value), tool = 'global' AND signal_group = 'trend' AND metric = 'delta' AND color = 'red') AS trend_delta_r,
        -- Diagnostic scenario (sqp)
        maxIf(toNullable(threshold_value), tool = 'sqp' AND signal_group = 'diagnostic' AND metric = 'impression_share' AND color = 'red') AS diag_low_bis_r,
        maxIf(toNullable(threshold_value), tool = 'sqp' AND signal_group = 'diagnostic' AND metric = 'efficiency_ratio' AND color = 'red') AS diag_efficiency_ratio_r
    FROM ryg_ranked
    WHERE rn = 1
),

-- ─── Child rows: one report row per ASIN × search query × week ──────────────
base_child AS (
    SELECT
        ifNull(companies.name, 'unknown') AS company,
        lower(ifNull(marketplace.marketplace_name, 'unknown')) AS marketplace,
        lower(ifNull(marketplace.country_code, 'unknown')) AS marketplace_country_code,
        ifNull(nullIf(sqp.parent_asin, ''), sqp.asin) AS parent_asin,
        ifNull(nullIf(sqp.revenue_abcd_class, ''), 'D') AS revenue_abcd_class,
        ifNull(nullIf(sqp.pareto_abc_class, ''), 'C') AS pareto_abc_class,
        ifNull(nullIf(sqp.brand, ''), 'unknown') AS brand,
        CAST(sqp.revenue_share AS Nullable(Float64)) AS revenue_share,
        CAST(nullIf(sqp.title, '') AS Nullable(String)) AS title,
        CAST(parseDateTimeBestEffortOrNull(JSONExtractString(sqp.raw_payload, 'date')) AS Nullable(Date)) AS `date`,
        JSONExtract(sqp.raw_payload, 'rspec_marketplaceids', 'Array(String)') AS rspec_marketplaceids,
        sqp.asin AS asin,
        CAST(sqp.asin_cart_add_count AS Nullable(Int64)) AS cartadddata_asincartaddcount,
        CAST(sqp.asin_cart_add_share AS Nullable(Float64)) AS cartadddata_asincartaddshare,
        JSONExtract(sqp.raw_payload, 'cartadddata_asinmediancartaddprice_amount', 'Nullable(Float64)') AS cartadddata_asinmediancartaddprice_amount,
        JSONExtract(sqp.raw_payload, 'cartadddata_asinmediancartaddprice_currencycode', 'Nullable(String)') AS cartadddata_asinmediancartaddprice_currencycode,
        CAST(sqp.total_cart_add_count AS Nullable(Int64)) AS cartadddata_totalcartaddcount,
        CAST(sqp.total_cart_add_rate AS Nullable(Float64)) AS cartadddata_totalcartaddrate,
        JSONExtract(sqp.raw_payload, 'cartadddata_totalmediancartaddprice_amount', 'Nullable(Float64)') AS cartadddata_totalmediancartaddprice_amount,
        JSONExtract(sqp.raw_payload, 'cartadddata_totalmediancartaddprice_currencycode', 'Nullable(String)') AS cartadddata_totalmediancartaddprice_currencycode,
        JSONExtract(sqp.raw_payload, 'cartadddata_totalonedayshippingcartaddcount', 'Nullable(Int64)') AS cartadddata_totalonedayshippingcartaddcount,
        JSONExtract(sqp.raw_payload, 'cartadddata_totalsamedayshippingcartaddcount', 'Nullable(Int64)') AS cartadddata_totalsamedayshippingcartaddcount,
        JSONExtract(sqp.raw_payload, 'cartadddata_totaltwodayshippingcartaddcount', 'Nullable(Int64)') AS cartadddata_totaltwodayshippingcartaddcount,
        CAST(sqp.asin_click_count AS Nullable(Int64)) AS clickdata_asinclickcount,
        CAST(sqp.asin_click_share AS Nullable(Float64)) AS clickdata_asinclickshare,
        JSONExtract(sqp.raw_payload, 'clickdata_asinmedianclickprice_amount', 'Nullable(Float64)') AS clickdata_asinmedianclickprice_amount,
        JSONExtract(sqp.raw_payload, 'clickdata_asinmedianclickprice_currencycode', 'Nullable(String)') AS clickdata_asinmedianclickprice_currencycode,
        CAST(sqp.total_click_count AS Nullable(Int64)) AS clickdata_totalclickcount,
        CAST(sqp.total_click_rate AS Nullable(Float64)) AS clickdata_totalclickrate,
        JSONExtract(sqp.raw_payload, 'clickdata_totalmedianclickprice_amount', 'Nullable(Float64)') AS clickdata_totalmedianclickprice_amount,
        JSONExtract(sqp.raw_payload, 'clickdata_totalmedianclickprice_currencycode', 'Nullable(String)') AS clickdata_totalmedianclickprice_currencycode,
        JSONExtract(sqp.raw_payload, 'clickdata_totalonedayshippingclickcount', 'Nullable(Int64)') AS clickdata_totalonedayshippingclickcount,
        JSONExtract(sqp.raw_payload, 'clickdata_totalsamedayshippingclickcount', 'Nullable(Int64)') AS clickdata_totalsamedayshippingclickcount,
        JSONExtract(sqp.raw_payload, 'clickdata_totaltwodayshippingclickcount', 'Nullable(Int64)') AS clickdata_totaltwodayshippingclickcount,
        CAST(parseDateTimeBestEffortOrNull(JSONExtractString(sqp.raw_payload, 'enddate')) AS Nullable(DateTime64(3))) AS enddate,
        CAST(sqp.asin_impression_count AS Nullable(Int64)) AS impressiondata_asinimpressioncount,
        CAST(sqp.asin_impression_share AS Nullable(Float64)) AS impressiondata_asinimpressionshare,
        CAST(sqp.total_query_impression_count AS Nullable(Int64)) AS impressiondata_totalqueryimpressioncount,
        JSONExtract(sqp.raw_payload, 'purchasedata_asinmedianpurchaseprice_amount', 'Nullable(Float64)') AS purchasedata_asinmedianpurchaseprice_amount,
        JSONExtract(sqp.raw_payload, 'purchasedata_asinmedianpurchaseprice_currencycode', 'Nullable(String)') AS purchasedata_asinmedianpurchaseprice_currencycode,
        CAST(sqp.asin_purchase_count AS Nullable(Int64)) AS purchasedata_asinpurchasecount,
        CAST(sqp.asin_purchase_share AS Nullable(Float64)) AS purchasedata_asinpurchaseshare,
        JSONExtract(sqp.raw_payload, 'purchasedata_totalmedianpurchaseprice_amount', 'Nullable(Float64)') AS purchasedata_totalmedianpurchaseprice_amount,
        JSONExtract(sqp.raw_payload, 'purchasedata_totalmedianpurchaseprice_currencycode', 'Nullable(String)') AS purchasedata_totalmedianpurchaseprice_currencycode,
        JSONExtract(sqp.raw_payload, 'purchasedata_totalonedayshippingpurchasecount', 'Nullable(Int64)') AS purchasedata_totalonedayshippingpurchasecount,
        CAST(sqp.total_purchase_count AS Nullable(Int64)) AS purchasedata_totalpurchasecount,
        CAST(sqp.total_purchase_rate AS Nullable(Float64)) AS purchasedata_totalpurchaserate,
        JSONExtract(sqp.raw_payload, 'purchasedata_totalsamedayshippingpurchasecount', 'Nullable(Int64)') AS purchasedata_totalsamedayshippingpurchasecount,
        JSONExtract(sqp.raw_payload, 'purchasedata_totaltwodayshippingpurchasecount', 'Nullable(Int64)') AS purchasedata_totaltwodayshippingpurchasecount,
        sqp.search_query AS searchquerydata_searchquery,
        CAST(sqp.search_query_score AS Nullable(Int64)) AS searchquerydata_searchqueryscore,
        CAST(sqp.search_query_volume AS Nullable(Int64)) AS searchquerydata_searchqueryvolume,
        CAST(parseDateTimeBestEffortOrNull(JSONExtractString(sqp.raw_payload, 'startdate')) AS Nullable(DateTime64(3))) AS startdate,
        sqp.ingested_at AS ingest_ts_utc,
        sqp.company_id AS company_id,
        sqp.amazon_seller_id AS amazon_seller_id,
        sqp.week_start AS week_start,
        -- KPI base calculations (ported verbatim; see header)
        CAST(sqp.asin_impression_share AS Nullable(Float64)) AS kpi_impression_share,
        CAST(sqp.asin_click_share AS Nullable(Float64)) AS kpi_click_share,
        CAST(sqp.total_cart_add_rate AS Nullable(Float64)) AS kpi_cart_add_rate,
        CAST(sqp.total_purchase_rate AS Nullable(Float64)) AS kpi_purchase_rate,
        CAST(
            if(ifNull(sqp.asin_impression_share, 0) = 0, NULL, sqp.asin_click_share / sqp.asin_impression_share)
            AS Nullable(Float64)
        ) AS kpi_ctr_advantage,
        CAST('child' AS String) AS row_type,
        ifNull(nullIf(sqp.product_family, ''), 'unknown') AS product_family
    FROM etl.ba_search_query_performance AS sqp
    LEFT JOIN etl.ba_marketplaces AS marketplace
        ON sqp.marketplace_id = marketplace.marketplace_id
    -- toString on both sides: app_companies.id and company_id are not guaranteed
    -- to share an integer type, and this dimension is tiny.
    LEFT JOIN app.app_companies AS companies
        ON toString(companies.id) = toString(sqp.company_id)
    WHERE
        has({{company_ids_array}}, sqp.company_id)
        AND (
            length({{search_terms_array}}) = 0
            OR arrayExists(t -> lower(t) = lower(sqp.search_query), {{search_terms_array}})
        )
        AND ({{intent_terms_filter_sql}})
        AND (
            length({{marketplaces_array}}) = 0
            OR arrayExists(
                m -> lower(m) IN (
                    lower(ifNull(marketplace.country_code, '')),
                    lower(ifNull(marketplace.marketplace_name, ''))
                ),
                {{marketplaces_array}}
            )
        )
        AND (
            length({{parent_asins_array}}) = 0
            OR arrayExists(a -> lower(a) = lower(ifNull(nullIf(sqp.parent_asin, ''), sqp.asin)), {{parent_asins_array}})
        )
        AND (length({{asins_array}}) = 0 OR arrayExists(a -> lower(a) = lower(sqp.asin), {{asins_array}}))
        AND (
            length({{product_families_array}}) = 0
            OR arrayExists(f -> lower(f) = lower(ifNull(sqp.product_family, '')), {{product_families_array}})
        )
        -- Deliberate: an empty revenue_abcd_class filter means A+B only, not
        -- "no filter". This reproduces the Athena params default.
        AND has(
            arrayMap(x -> upper(x), if(length({{revenue_abcd_class_array}}) = 0, ['A', 'B'], {{revenue_abcd_class_array}})),
            upper(ifNull(nullIf(sqp.revenue_abcd_class, ''), 'D'))
        )
        AND (
            length({{pareto_abc_class_array}}) = 0
            OR arrayExists(c -> upper(c) = upper(ifNull(nullIf(sqp.pareto_abc_class, ''), 'C')), {{pareto_abc_class_array}})
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
        sum(revenue_share) AS revenue_share,
        max(`date`) AS `date`,
        sum(cartadddata_asincartaddcount) AS cartadddata_asincartaddcount,
        sum(cartadddata_totalcartaddcount) AS cartadddata_totalcartaddcount,
        sum(cartadddata_totalonedayshippingcartaddcount) AS cartadddata_totalonedayshippingcartaddcount,
        sum(cartadddata_totalsamedayshippingcartaddcount) AS cartadddata_totalsamedayshippingcartaddcount,
        sum(cartadddata_totaltwodayshippingcartaddcount) AS cartadddata_totaltwodayshippingcartaddcount,
        sum(clickdata_asinclickcount) AS clickdata_asinclickcount,
        sum(clickdata_totalclickcount) AS clickdata_totalclickcount,
        sum(clickdata_totalonedayshippingclickcount) AS clickdata_totalonedayshippingclickcount,
        sum(clickdata_totalsamedayshippingclickcount) AS clickdata_totalsamedayshippingclickcount,
        sum(clickdata_totaltwodayshippingclickcount) AS clickdata_totaltwodayshippingclickcount,
        max(enddate) AS enddate,
        sum(impressiondata_asinimpressioncount) AS impressiondata_asinimpressioncount,
        sum(impressiondata_totalqueryimpressioncount) AS impressiondata_totalqueryimpressioncount,
        sum(purchasedata_asinpurchasecount) AS purchasedata_asinpurchasecount,
        sum(purchasedata_totalonedayshippingpurchasecount) AS purchasedata_totalonedayshippingpurchasecount,
        sum(purchasedata_totalpurchasecount) AS purchasedata_totalpurchasecount,
        sum(purchasedata_totalsamedayshippingpurchasecount) AS purchasedata_totalsamedayshippingpurchasecount,
        sum(purchasedata_totaltwodayshippingpurchasecount) AS purchasedata_totaltwodayshippingpurchasecount,
        max(searchquerydata_searchquery) AS searchquerydata_searchquery,
        max(searchquerydata_searchqueryscore) AS searchquerydata_searchqueryscore,
        max(searchquerydata_searchqueryvolume) AS searchquerydata_searchqueryvolume,
        max(startdate) AS startdate,
        max(ingest_ts_utc) AS ingest_ts_utc,
        max(company_id) AS company_id,
        max(amazon_seller_id) AS amazon_seller_id,
        max(product_family) AS product_family
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
        CAST(revenue_share AS Nullable(Float64)) AS revenue_share,
        CAST(NULL AS Nullable(String)) AS title,
        CAST(`date` AS Nullable(Date)) AS `date`,
        -- Athena emitted CAST(NULL AS ARRAY(VARCHAR)); ClickHouse arrays are not
        -- nullable, so a parent row carries an empty marketplace-id list.
        CAST([], 'Array(String)') AS rspec_marketplaceids,
        parent_asin AS asin,
        CAST(cartadddata_asincartaddcount AS Nullable(Int64)) AS cartadddata_asincartaddcount,
        CAST(
            if(ifNull(cartadddata_totalcartaddcount, 0) = 0, NULL,
               cartadddata_asincartaddcount / cartadddata_totalcartaddcount)
            AS Nullable(Float64)
        ) AS cartadddata_asincartaddshare,
        CAST(NULL AS Nullable(Float64)) AS cartadddata_asinmediancartaddprice_amount,
        CAST(NULL AS Nullable(String)) AS cartadddata_asinmediancartaddprice_currencycode,
        CAST(cartadddata_totalcartaddcount AS Nullable(Int64)) AS cartadddata_totalcartaddcount,
        CAST(
            if(ifNull(impressiondata_totalqueryimpressioncount, 0) = 0, NULL,
               cartadddata_totalcartaddcount / impressiondata_totalqueryimpressioncount)
            AS Nullable(Float64)
        ) AS cartadddata_totalcartaddrate,
        CAST(NULL AS Nullable(Float64)) AS cartadddata_totalmediancartaddprice_amount,
        CAST(NULL AS Nullable(String)) AS cartadddata_totalmediancartaddprice_currencycode,
        CAST(cartadddata_totalonedayshippingcartaddcount AS Nullable(Int64)) AS cartadddata_totalonedayshippingcartaddcount,
        CAST(cartadddata_totalsamedayshippingcartaddcount AS Nullable(Int64)) AS cartadddata_totalsamedayshippingcartaddcount,
        CAST(cartadddata_totaltwodayshippingcartaddcount AS Nullable(Int64)) AS cartadddata_totaltwodayshippingcartaddcount,
        CAST(clickdata_asinclickcount AS Nullable(Int64)) AS clickdata_asinclickcount,
        CAST(
            if(ifNull(clickdata_totalclickcount, 0) = 0, NULL,
               clickdata_asinclickcount / clickdata_totalclickcount)
            AS Nullable(Float64)
        ) AS clickdata_asinclickshare,
        CAST(NULL AS Nullable(Float64)) AS clickdata_asinmedianclickprice_amount,
        CAST(NULL AS Nullable(String)) AS clickdata_asinmedianclickprice_currencycode,
        CAST(clickdata_totalclickcount AS Nullable(Int64)) AS clickdata_totalclickcount,
        CAST(
            if(ifNull(impressiondata_totalqueryimpressioncount, 0) = 0, NULL,
               clickdata_totalclickcount / impressiondata_totalqueryimpressioncount)
            AS Nullable(Float64)
        ) AS clickdata_totalclickrate,
        CAST(NULL AS Nullable(Float64)) AS clickdata_totalmedianclickprice_amount,
        CAST(NULL AS Nullable(String)) AS clickdata_totalmedianclickprice_currencycode,
        CAST(clickdata_totalonedayshippingclickcount AS Nullable(Int64)) AS clickdata_totalonedayshippingclickcount,
        CAST(clickdata_totalsamedayshippingclickcount AS Nullable(Int64)) AS clickdata_totalsamedayshippingclickcount,
        CAST(clickdata_totaltwodayshippingclickcount AS Nullable(Int64)) AS clickdata_totaltwodayshippingclickcount,
        CAST(enddate AS Nullable(DateTime64(3))) AS enddate,
        CAST(impressiondata_asinimpressioncount AS Nullable(Int64)) AS impressiondata_asinimpressioncount,
        CAST(
            if(ifNull(impressiondata_totalqueryimpressioncount, 0) = 0, NULL,
               impressiondata_asinimpressioncount / impressiondata_totalqueryimpressioncount)
            AS Nullable(Float64)
        ) AS impressiondata_asinimpressionshare,
        CAST(impressiondata_totalqueryimpressioncount AS Nullable(Int64)) AS impressiondata_totalqueryimpressioncount,
        CAST(NULL AS Nullable(Float64)) AS purchasedata_asinmedianpurchaseprice_amount,
        CAST(NULL AS Nullable(String)) AS purchasedata_asinmedianpurchaseprice_currencycode,
        CAST(purchasedata_asinpurchasecount AS Nullable(Int64)) AS purchasedata_asinpurchasecount,
        CAST(
            if(ifNull(purchasedata_totalpurchasecount, 0) = 0, NULL,
               purchasedata_asinpurchasecount / purchasedata_totalpurchasecount)
            AS Nullable(Float64)
        ) AS purchasedata_asinpurchaseshare,
        CAST(NULL AS Nullable(Float64)) AS purchasedata_totalmedianpurchaseprice_amount,
        CAST(NULL AS Nullable(String)) AS purchasedata_totalmedianpurchaseprice_currencycode,
        CAST(purchasedata_totalonedayshippingpurchasecount AS Nullable(Int64)) AS purchasedata_totalonedayshippingpurchasecount,
        CAST(purchasedata_totalpurchasecount AS Nullable(Int64)) AS purchasedata_totalpurchasecount,
        CAST(
            if(ifNull(impressiondata_totalqueryimpressioncount, 0) = 0, NULL,
               purchasedata_totalpurchasecount / impressiondata_totalqueryimpressioncount)
            AS Nullable(Float64)
        ) AS purchasedata_totalpurchaserate,
        CAST(purchasedata_totalsamedayshippingpurchasecount AS Nullable(Int64)) AS purchasedata_totalsamedayshippingpurchasecount,
        CAST(purchasedata_totaltwodayshippingpurchasecount AS Nullable(Int64)) AS purchasedata_totaltwodayshippingpurchasecount,
        searchquerydata_searchquery AS searchquerydata_searchquery,
        CAST(searchquerydata_searchqueryscore AS Nullable(Int64)) AS searchquerydata_searchqueryscore,
        CAST(searchquerydata_searchqueryvolume AS Nullable(Int64)) AS searchquerydata_searchqueryvolume,
        CAST(startdate AS Nullable(DateTime64(3))) AS startdate,
        ingest_ts_utc AS ingest_ts_utc,
        company_id AS company_id,
        amazon_seller_id AS amazon_seller_id,
        week_start AS week_start,
        -- KPI base calculations (recomputed from the parent sums)
        CAST(
            if(ifNull(impressiondata_totalqueryimpressioncount, 0) = 0, NULL,
               impressiondata_asinimpressioncount / impressiondata_totalqueryimpressioncount)
            AS Nullable(Float64)
        ) AS kpi_impression_share,
        CAST(
            if(ifNull(clickdata_totalclickcount, 0) = 0, NULL,
               clickdata_asinclickcount / clickdata_totalclickcount)
            AS Nullable(Float64)
        ) AS kpi_click_share,
        CAST(
            if(ifNull(impressiondata_totalqueryimpressioncount, 0) = 0, NULL,
               cartadddata_totalcartaddcount / impressiondata_totalqueryimpressioncount)
            AS Nullable(Float64)
        ) AS kpi_cart_add_rate,
        CAST(
            if(ifNull(impressiondata_totalqueryimpressioncount, 0) = 0, NULL,
               purchasedata_totalpurchasecount / impressiondata_totalqueryimpressioncount)
            AS Nullable(Float64)
        ) AS kpi_purchase_rate,
        CAST(
            if(
                ifNull(impressiondata_totalqueryimpressioncount, 0) = 0
                OR ifNull(impressiondata_asinimpressioncount, 0) = 0
                OR ifNull(clickdata_totalclickcount, 0) = 0,
                NULL,
                (clickdata_asinclickcount / clickdata_totalclickcount)
                / (impressiondata_asinimpressioncount / impressiondata_totalqueryimpressioncount)
            )
            AS Nullable(Float64)
        ) AS kpi_ctr_advantage,
        CAST('parent' AS String) AS row_type,
        product_family AS product_family
    FROM parent_sums
),

final_base AS (
    SELECT * FROM windowed
    UNION ALL
    SELECT * FROM parent_agg
),

-- ─── Per-term intent enrichment ─────────────────────────────────────────────
-- Joined after the UNION so parent rows inherit the intent of their (arbitrary)
-- max() search query, matching the Athena snapshot behaviour.
with_intents AS (
    SELECT
        fb.*,
        ti.intent_ids AS intent_ids,
        ti.primary_intent_id AS primary_intent_id,
        ti.primary_intent_label AS primary_intent_label
    FROM final_base AS fb
    LEFT JOIN term_intents AS ti
        ON ti.company_id = fb.company_id
       AND ti.term_norm = lower(fb.searchquerydata_searchquery)
),

-- ─── Week-over-week and rolling-baseline deltas ─────────────────────────────
-- lagInFrame needs the explicit ROWS frame; the default RANGE frame does not step
-- back exactly one row. toNullable + NULL default keeps "no prior week" as NULL
-- rather than a fabricated zero delta.
with_deltas AS (
    SELECT
        w.*,
        w.kpi_impression_share - lagInFrame(toNullable(w.kpi_impression_share), 1, NULL) OVER (
            PARTITION BY w.company_id, w.marketplace_country_code, w.searchquerydata_searchquery, w.row_type, w.parent_asin, w.asin
            ORDER BY w.week_start
            ROWS BETWEEN 1 PRECEDING AND CURRENT ROW
        ) AS kpi_impression_share_wow,
        w.kpi_impression_share - avg(w.kpi_impression_share) OVER (
            PARTITION BY w.company_id, w.marketplace_country_code, w.searchquerydata_searchquery, w.row_type, w.parent_asin, w.asin
            ORDER BY w.week_start
            ROWS BETWEEN 4 PRECEDING AND 1 PRECEDING
        ) AS kpi_impression_share_wolast4,
        w.kpi_impression_share - avg(w.kpi_impression_share) OVER (
            PARTITION BY w.company_id, w.marketplace_country_code, w.searchquerydata_searchquery, w.row_type, w.parent_asin, w.asin
            ORDER BY w.week_start
            ROWS BETWEEN 12 PRECEDING AND 1 PRECEDING
        ) AS kpi_impression_share_wolast12,
        w.kpi_click_share - lagInFrame(toNullable(w.kpi_click_share), 1, NULL) OVER (
            PARTITION BY w.company_id, w.marketplace_country_code, w.searchquerydata_searchquery, w.row_type, w.parent_asin, w.asin
            ORDER BY w.week_start
            ROWS BETWEEN 1 PRECEDING AND CURRENT ROW
        ) AS kpi_click_share_wow,
        w.kpi_click_share - avg(w.kpi_click_share) OVER (
            PARTITION BY w.company_id, w.marketplace_country_code, w.searchquerydata_searchquery, w.row_type, w.parent_asin, w.asin
            ORDER BY w.week_start
            ROWS BETWEEN 4 PRECEDING AND 1 PRECEDING
        ) AS kpi_click_share_wolast4,
        w.kpi_click_share - avg(w.kpi_click_share) OVER (
            PARTITION BY w.company_id, w.marketplace_country_code, w.searchquerydata_searchquery, w.row_type, w.parent_asin, w.asin
            ORDER BY w.week_start
            ROWS BETWEEN 12 PRECEDING AND 1 PRECEDING
        ) AS kpi_click_share_wolast12,
        w.kpi_cart_add_rate - lagInFrame(toNullable(w.kpi_cart_add_rate), 1, NULL) OVER (
            PARTITION BY w.company_id, w.marketplace_country_code, w.searchquerydata_searchquery, w.row_type, w.parent_asin, w.asin
            ORDER BY w.week_start
            ROWS BETWEEN 1 PRECEDING AND CURRENT ROW
        ) AS kpi_cart_add_rate_wow,
        w.kpi_cart_add_rate - avg(w.kpi_cart_add_rate) OVER (
            PARTITION BY w.company_id, w.marketplace_country_code, w.searchquerydata_searchquery, w.row_type, w.parent_asin, w.asin
            ORDER BY w.week_start
            ROWS BETWEEN 4 PRECEDING AND 1 PRECEDING
        ) AS kpi_cart_add_rate_wolast4,
        w.kpi_cart_add_rate - avg(w.kpi_cart_add_rate) OVER (
            PARTITION BY w.company_id, w.marketplace_country_code, w.searchquerydata_searchquery, w.row_type, w.parent_asin, w.asin
            ORDER BY w.week_start
            ROWS BETWEEN 12 PRECEDING AND 1 PRECEDING
        ) AS kpi_cart_add_rate_wolast12,
        w.kpi_purchase_rate - lagInFrame(toNullable(w.kpi_purchase_rate), 1, NULL) OVER (
            PARTITION BY w.company_id, w.marketplace_country_code, w.searchquerydata_searchquery, w.row_type, w.parent_asin, w.asin
            ORDER BY w.week_start
            ROWS BETWEEN 1 PRECEDING AND CURRENT ROW
        ) AS kpi_purchase_rate_wow,
        w.kpi_purchase_rate - avg(w.kpi_purchase_rate) OVER (
            PARTITION BY w.company_id, w.marketplace_country_code, w.searchquerydata_searchquery, w.row_type, w.parent_asin, w.asin
            ORDER BY w.week_start
            ROWS BETWEEN 4 PRECEDING AND 1 PRECEDING
        ) AS kpi_purchase_rate_wolast4,
        w.kpi_purchase_rate - avg(w.kpi_purchase_rate) OVER (
            PARTITION BY w.company_id, w.marketplace_country_code, w.searchquerydata_searchquery, w.row_type, w.parent_asin, w.asin
            ORDER BY w.week_start
            ROWS BETWEEN 12 PRECEDING AND 1 PRECEDING
        ) AS kpi_purchase_rate_wolast12,
        w.kpi_ctr_advantage - lagInFrame(toNullable(w.kpi_ctr_advantage), 1, NULL) OVER (
            PARTITION BY w.company_id, w.marketplace_country_code, w.searchquerydata_searchquery, w.row_type, w.parent_asin, w.asin
            ORDER BY w.week_start
            ROWS BETWEEN 1 PRECEDING AND CURRENT ROW
        ) AS kpi_ctr_advantage_wow,
        w.kpi_ctr_advantage - avg(w.kpi_ctr_advantage) OVER (
            PARTITION BY w.company_id, w.marketplace_country_code, w.searchquerydata_searchquery, w.row_type, w.parent_asin, w.asin
            ORDER BY w.week_start
            ROWS BETWEEN 4 PRECEDING AND 1 PRECEDING
        ) AS kpi_ctr_advantage_wolast4,
        w.kpi_ctr_advantage - avg(w.kpi_ctr_advantage) OVER (
            PARTITION BY w.company_id, w.marketplace_country_code, w.searchquerydata_searchquery, w.row_type, w.parent_asin, w.asin
            ORDER BY w.week_start
            ROWS BETWEEN 12 PRECEDING AND 1 PRECEDING
        ) AS kpi_ctr_advantage_wolast12
    FROM with_intents AS w
),

-- ─── Delivery-speed CVR, efficiency ratios, term type ───────────────────────
-- The `= 0` guard on the two-day purchase count is new: it is the ratio's
-- denominator, and ClickHouse returns +inf rather than raising on divide-by-zero,
-- which would score as a false 'green' shipping_alpha opportunity.
cvr_base AS (
    SELECT
        w.*,
        if(ifNull(w.clickdata_totalsamedayshippingclickcount, 0) = 0, NULL,
           w.purchasedata_totalsamedayshippingpurchasecount / w.clickdata_totalsamedayshippingclickcount) AS cvr_same_day,
        if(ifNull(w.clickdata_totalonedayshippingclickcount, 0) = 0, NULL,
           w.purchasedata_totalonedayshippingpurchasecount / w.clickdata_totalonedayshippingclickcount) AS cvr_one_day,
        if(ifNull(w.clickdata_totaltwodayshippingclickcount, 0) = 0, NULL,
           w.purchasedata_totaltwodayshippingpurchasecount / w.clickdata_totaltwodayshippingclickcount) AS cvr_two_day,
        if(
            ifNull(w.clickdata_totalsamedayshippingclickcount, 0) = 0
            OR ifNull(w.clickdata_totaltwodayshippingclickcount, 0) = 0
            OR w.purchasedata_totaltwodayshippingpurchasecount IS NULL
            OR w.purchasedata_totalsamedayshippingpurchasecount IS NULL
            OR w.purchasedata_totaltwodayshippingpurchasecount = 0,
            NULL,
            (w.purchasedata_totalsamedayshippingpurchasecount / w.clickdata_totalsamedayshippingclickcount)
            / (w.purchasedata_totaltwodayshippingpurchasecount / w.clickdata_totaltwodayshippingclickcount)
        ) AS cvr_same_vs_two_ratio,
        if(
            ifNull(w.clickdata_totalonedayshippingclickcount, 0) = 0
            OR ifNull(w.clickdata_totaltwodayshippingclickcount, 0) = 0
            OR w.purchasedata_totaltwodayshippingpurchasecount IS NULL
            OR w.purchasedata_totalonedayshippingpurchasecount IS NULL
            OR w.purchasedata_totaltwodayshippingpurchasecount = 0,
            NULL,
            (w.purchasedata_totalonedayshippingpurchasecount / w.clickdata_totalonedayshippingclickcount)
            / (w.purchasedata_totaltwodayshippingpurchasecount / w.clickdata_totaltwodayshippingclickcount)
        ) AS cvr_one_vs_two_ratio,
        -- Click-through efficiency (BCS ÷ BIS): >1.0 means outperforming market avg
        if(ifNull(w.kpi_impression_share, 0) = 0, NULL, w.kpi_click_share / w.kpi_impression_share) AS click_through_efficiency,
        -- Conversion efficiency (BCVS ÷ BCS): >1.0 means outperforming market avg
        if(ifNull(w.kpi_click_share, 0) = 0, NULL, w.purchasedata_asinpurchaseshare / w.kpi_click_share) AS conversion_efficiency,
        -- Term type. The Athena version used a correlated EXISTS against the
        -- brands table, which ClickHouse cannot express; etl.ba_brand_aliases
        -- already returns one lowercased alias array per company, so the same
        -- test becomes an arrayExists over a scalar subquery.
        multiIf(
            arrayExists(
                alias -> length(alias) > 0 AND position(lower(w.searchquerydata_searchquery), alias) > 0,
                (SELECT brand_aliases FROM etl.ba_brand_aliases WHERE company_id = {{ryg_company_id}})
            ), 'branded',
            length(ifNull(w.brand, '')) > 0
            AND position(lower(w.searchquerydata_searchquery), lower(w.brand)) > 0, 'branded',
            length(splitByChar(' ', w.searchquerydata_searchquery)) >= 4, 'long_tail',
            'generic'
        ) AS term_type
    FROM with_deltas AS w
),

-- ─── Strength / weakness / opportunity / diagnostic signals ─────────────────
signal_base AS (
    SELECT
        w.*,
        multiIf(
            w.kpi_click_share IS NULL OR w.kpi_purchase_rate IS NULL, NULL,
            w.kpi_click_share >= t.str_click_share_g AND w.kpi_purchase_rate >= t.str_purchase_rate_g, 'green',
            w.kpi_click_share >= t.str_click_share_y AND w.kpi_purchase_rate >= t.str_purchase_rate_y, 'yellow',
            'red'
        ) AS strength_color,
        multiIf(
            w.kpi_click_share IS NULL OR w.kpi_purchase_rate IS NULL, 'insufficient_data',
            w.kpi_click_share >= t.str_click_share_g AND w.kpi_purchase_rate >= t.str_purchase_rate_g, 'market_leader',
            w.kpi_click_share >= t.str_click_share_y AND w.kpi_purchase_rate >= t.str_purchase_rate_y, 'competitive',
            'weak_click_or_conversion'
        ) AS strength_code,
        multiIf(
            w.kpi_click_share IS NULL OR w.kpi_purchase_rate IS NULL, 'Not enough data to evaluate strength.',
            w.kpi_click_share >= t.str_click_share_g AND w.kpi_purchase_rate >= t.str_purchase_rate_g, 'Top-tier click share and conversion; listing is highly relevant.',
            w.kpi_click_share >= t.str_click_share_y AND w.kpi_purchase_rate >= t.str_purchase_rate_y, 'Moderate click share; visible but not dominant.',
            'Underperforming click or purchase rates.'
        ) AS strength_description,

        multiIf(
            w.kpi_click_share < t.wk_click_share_r, 'red',
            w.kpi_purchase_rate < t.wk_purchase_rate_r, 'red',
            'green'
        ) AS weakness_color,
        multiIf(
            w.kpi_click_share < t.wk_click_share_r, 'visibility_void',
            w.kpi_purchase_rate < t.wk_purchase_rate_r, 'pdp_friction',
            'no_major_weakness'
        ) AS weakness_code,
        multiIf(
            w.kpi_click_share < t.wk_click_share_r, 'Poor click share; main image or price likely failing.',
            w.kpi_purchase_rate < t.wk_purchase_rate_r, 'Critical conversion leak; check reviews or UX.',
            'No critical weakness detected.'
        ) AS weakness_description,

        multiIf(
            ifNull(w.cvr_same_vs_two_ratio, 0) >= t.opp_cvr_ratio_g
            OR ifNull(w.cvr_one_vs_two_ratio, 0) >= t.opp_cvr_ratio_g, 'green',
            w.kpi_impression_share < t.opp_impression_share_g, 'green',
            'red'
        ) AS opportunity_color,
        multiIf(
            ifNull(w.cvr_same_vs_two_ratio, 0) >= t.opp_cvr_ratio_g
            OR ifNull(w.cvr_one_vs_two_ratio, 0) >= t.opp_cvr_ratio_g, 'shipping_alpha',
            w.kpi_impression_share < t.opp_impression_share_g, 'untapped_volume',
            'no_clear_opportunity'
        ) AS opportunity_code,
        multiIf(
            ifNull(w.cvr_same_vs_two_ratio, 0) >= t.opp_cvr_ratio_g
            OR ifNull(w.cvr_one_vs_two_ratio, 0) >= t.opp_cvr_ratio_g, '1-Day delivery provides >30% CVR lift. Scale FBA.',
            w.kpi_impression_share < t.opp_impression_share_g, 'High CVR but low Imp Share. Aggressively raise bids.',
            'No clear opportunity.'
        ) AS opportunity_description,

        -- Threshold / ceiling signal (no sqp ceiling rows are evaluated → green)
        CAST('green' AS String) AS threshold_color,
        CAST('no_ceiling' AS String) AS threshold_code,
        CAST('No ceiling detected.' AS String) AS threshold_description,

        -- ─── Diagnostic scenario classification ─────────────────────────────
        multiIf(
            w.kpi_impression_share IS NULL, 'insufficient_data',
            w.kpi_impression_share < ifNull(t.diag_low_bis_r, 0.05), 'A_visibility',
            w.click_through_efficiency < ifNull(t.diag_efficiency_ratio_r, 0.6)
            AND w.kpi_impression_share >= ifNull(t.diag_low_bis_r, 0.05), 'B_creative',
            w.conversion_efficiency IS NOT NULL
            AND w.conversion_efficiency < ifNull(t.diag_efficiency_ratio_r, 0.6), 'C_conversion',
            'D_protect'
        ) AS diagnostic_scenario,
        multiIf(
            w.kpi_impression_share IS NULL,
                'Not enough data to classify scenario.',
            w.kpi_impression_share < ifNull(t.diag_low_bis_r, 0.05),
                'Scenario A — Low Visibility: BIS is ' || toString(round(w.kpi_impression_share * 100, 1)) || '%, below ' || toString(round(ifNull(t.diag_low_bis_r, 0.05) * 100, 0)) || '% threshold. Shoppers cannot click what they cannot see. Root causes: poor organic rank, no sponsored coverage, or listing not indexed for this term. Do NOT change listing creative — this is a visibility/advertising problem.',
            w.click_through_efficiency < ifNull(t.diag_efficiency_ratio_r, 0.6)
            AND w.kpi_impression_share >= ifNull(t.diag_low_bis_r, 0.05),
                'Scenario B — Visual Competition Problem: BIS=' || toString(round(w.kpi_impression_share * 100, 1)) || '% but click-through efficiency=' || toString(round(w.click_through_efficiency, 2)) || ' (below 0.6). Shoppers see you but click competitors. Root causes: weak main image vs top results, uncompetitive title in first 80 chars, lower star rating, lower review count, or higher price visible in search.',
            w.conversion_efficiency IS NOT NULL
            AND w.conversion_efficiency < ifNull(t.diag_efficiency_ratio_r, 0.6),
                'Scenario C — Listing Conversion Problem: BCS=' || toString(round(w.kpi_click_share * 100, 1)) || '% but conversion efficiency=' || toString(round(w.conversion_efficiency, 2)) || ' (below 0.6). Shoppers click you but leave without buying. Root causes: price too high on detail page, secondary images missing key info, bullets not addressing objections, unresolved 3-star review concerns, missing A+ content or video.',
            'Scenario D — Protect & Scale: Funnel is healthy (BIS=' || toString(round(w.kpi_impression_share * 100, 1)) || '%, CTE=' || toString(round(ifNull(w.click_through_efficiency, 0), 2)) || ', CVE=' || toString(round(ifNull(w.conversion_efficiency, 0), 2)) || '). Defend position: push BIS toward 30%+, add Sponsored Brands/Display, monitor for share erosion weekly.'
        ) AS diagnostic_scenario_description,
        multiIf(
            w.kpi_impression_share IS NULL,
                'Gather more data before taking action.',
            w.kpi_impression_share < ifNull(t.diag_low_bis_r, 0.05),
                'Add exact-match Sponsored Products campaign with aggressive bids. Verify organic rank — if page 3+, run a ranking push. Ensure term is in title, bullets, and backend keywords for indexation.',
            w.click_through_efficiency < ifNull(t.diag_efficiency_ratio_r, 0.6)
            AND w.kpi_impression_share >= ifNull(t.diag_low_bis_r, 0.05),
                'Search this exact term on Amazon and compare your main image to top 5 results. Compare star rating and review count vs top 3. Test main image variant via Manage Experiments A/B testing. Consider 10% pricing experiment for 2 weeks.',
            w.conversion_efficiency IS NOT NULL
            AND w.conversion_efficiency < ifNull(t.diag_efficiency_ratio_r, 0.6),
                'Read every 3-star review — address the most common objection in bullet 1 or 2. Audit secondary images: sizing, lifestyle-in-use, comparison chart, objection callout. Check Buy Box consistency. Add video if absent. Compare competitor A+ content.',
            'Increase bid/budget to push BIS toward 30%+. Add Sponsored Brands headline ads and Sponsored Display for this term. Pull SQP comparison every 4 weeks — any BIS/BCS decline without your changes means a competitor is gaining.'
        ) AS diagnostic_scenario_action
    FROM cvr_base AS w
    CROSS JOIN thresholds AS t
),

with_tier_prep AS (
    SELECT
        sb.*,
        -- Trend signals (thresholds from analytics.ba_ryg_thresholds)
        multiIf(
            sb.kpi_impression_share_wow > t.trend_delta_g
            AND sb.kpi_impression_share_wolast4 > t.trend_delta_g
            AND sb.kpi_impression_share_wolast12 > t.trend_delta_g, 'green',
            sb.kpi_impression_share_wow < t.trend_delta_r
            AND sb.kpi_impression_share_wolast4 < t.trend_delta_r
            AND sb.kpi_impression_share_wolast12 < t.trend_delta_r, 'red',
            'yellow'
        ) AS kpi_impression_share_trend_signal,
        multiIf(
            sb.kpi_click_share_wow > t.trend_delta_g
            AND sb.kpi_click_share_wolast4 > t.trend_delta_g
            AND sb.kpi_click_share_wolast12 > t.trend_delta_g, 'green',
            sb.kpi_click_share_wow < t.trend_delta_r
            AND sb.kpi_click_share_wolast4 < t.trend_delta_r
            AND sb.kpi_click_share_wolast12 < t.trend_delta_r, 'red',
            'yellow'
        ) AS kpi_click_share_trend_signal,
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
        multiIf(
            sb.kpi_ctr_advantage_wow > t.trend_delta_g
            AND sb.kpi_ctr_advantage_wolast4 > t.trend_delta_g
            AND sb.kpi_ctr_advantage_wolast12 > t.trend_delta_g, 'green',
            sb.kpi_ctr_advantage_wow < t.trend_delta_r
            AND sb.kpi_ctr_advantage_wolast4 < t.trend_delta_r
            AND sb.kpi_ctr_advantage_wolast12 < t.trend_delta_r, 'red',
            'yellow'
        ) AS kpi_ctr_advantage_trend_signal,
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
        )) AS threshold_signal,
        toJSONString(map(
            'scenario', sb.diagnostic_scenario,
            'description', ifNull(sb.diagnostic_scenario_description, ''),
            'action', sb.diagnostic_scenario_action
        )) AS diagnostic_scenario_signal,
        -- Volume group for priority tiering (1 = top half by volume, 2 = bottom).
        -- ntile needs the whole partition in frame; the default RANGE frame would
        -- only expose rows up to the current one and mis-bucket every row.
        ntile(2) OVER (
            ORDER BY sb.searchquerydata_searchqueryvolume DESC NULLS LAST
            ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
        ) AS volume_ntile
    FROM signal_base AS sb
    CROSS JOIN thresholds AS t
),

final AS (
    SELECT
        d.*,
        -- ─── Priority tier (volume × performance matrix) ────────────────────
        multiIf(
            d.volume_ntile = 1 AND ifNull(d.conversion_efficiency, 0) >= 0.8, 1,
            d.volume_ntile = 1, 2,
            ifNull(d.conversion_efficiency, 0) >= 0.8, 3,
            4
        ) AS priority_tier,
        multiIf(
            d.volume_ntile = 1 AND ifNull(d.conversion_efficiency, 0) >= 0.8,
                'Tier 1: Protect — High volume + strong conversion. Defend at all cost, dominate, scale aggressively.',
            d.volume_ntile = 1,
                'Tier 2: Fix — High volume + underperforming. Highest ROI opportunity — diagnose and fix the funnel.',
            ifNull(d.conversion_efficiency, 0) >= 0.8,
                'Tier 3: Harvest — Lower volume + strong efficiency. Profit-dense terms — maintain and harvest efficiently.',
            'Tier 4: Deprioritize — Low volume + weak performance. Ignore until higher tiers are resolved.'
        ) AS priority_tier_description
    FROM with_tier_prep AS d
)

SELECT f.*
FROM final AS f
WHERE
    f.week_start >= (SELECT start_date FROM date_bounds)
    AND f.week_start <= (SELECT end_date FROM date_bounds)
    AND (length({{row_types_array}}) = 0 OR arrayExists(rt -> lower(rt) = lower(f.row_type), {{row_types_array}}))
    AND (length({{strength_colors_array}}) = 0 OR arrayExists(c -> lower(c) = lower(ifNull(f.strength_color, '')), {{strength_colors_array}}))
    AND (length({{weakness_colors_array}}) = 0 OR arrayExists(c -> lower(c) = lower(f.weakness_color), {{weakness_colors_array}}))
    AND (length({{opportunity_colors_array}}) = 0 OR arrayExists(c -> lower(c) = lower(f.opportunity_color), {{opportunity_colors_array}}))
    AND (length({{threshold_colors_array}}) = 0 OR arrayExists(c -> lower(c) = lower(f.threshold_color), {{threshold_colors_array}}))
    AND (length({{impression_trend_colors_array}}) = 0 OR arrayExists(c -> lower(c) = lower(f.kpi_impression_share_trend_signal), {{impression_trend_colors_array}}))
    AND (length({{click_trend_colors_array}}) = 0 OR arrayExists(c -> lower(c) = lower(f.kpi_click_share_trend_signal), {{click_trend_colors_array}}))
    AND (length({{cart_add_trend_colors_array}}) = 0 OR arrayExists(c -> lower(c) = lower(f.kpi_cart_add_rate_trend_signal), {{cart_add_trend_colors_array}}))
    AND (length({{purchase_trend_colors_array}}) = 0 OR arrayExists(c -> lower(c) = lower(f.kpi_purchase_rate_trend_signal), {{purchase_trend_colors_array}}))
    AND (length({{ctr_advantage_trend_colors_array}}) = 0 OR arrayExists(c -> lower(c) = lower(f.kpi_ctr_advantage_trend_signal), {{ctr_advantage_trend_colors_array}}))
    AND (length({{diagnostic_scenarios_array}}) = 0 OR arrayExists(s -> lower(s) = lower(f.diagnostic_scenario), {{diagnostic_scenarios_array}}))
    AND (length({{term_types_array}}) = 0 OR arrayExists(tt -> lower(tt) = lower(f.term_type), {{term_types_array}}))
    AND (length({{priority_tiers_array}}) = 0 OR arrayExists(pt -> toInt32OrNull(pt) = f.priority_tier, {{priority_tiers_array}}))
ORDER BY f.week_start DESC
LIMIT {{limit_top_n}};
