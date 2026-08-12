-- Tool query (GROUPED variant) for brand_analytics_analyze_search_query_performance.
-- Produces weighted aggregations over the chosen group_by dimensions.
-- Skips per-row signals/thresholds — those only make sense at row level.
--
-- Like the row-level query, this rebuilds the child and parent rows the Athena
-- snapshot table used to materialize. Only the columns the aggregation needs are
-- carried. See query.sql for the parent-grain and filter-ordering notes.

WITH {{asin_class_cte_sql}},

{{term_intents_cte_sql}},

base_child AS (
    SELECT
        ifNull(companies.name, 'unknown') AS company,
        lower(ifNull(marketplace.marketplace_name, 'unknown')) AS marketplace,
        lower(ifNull(marketplace.country_code, 'unknown')) AS marketplace_country_code,
        ifNull(nullIf(sqp.parent_asin, ''), sqp.asin) AS parent_asin,
        ifNull(cls.revenue_abcd_class, 'D') AS revenue_abcd_class,
        ifNull(cls.pareto_abc_class, 'C') AS pareto_abc_class,
        ifNull(nullIf(sqp.brand, ''), 'unknown') AS brand,
        sqp.asin AS asin,
        sqp.search_query AS searchquerydata_searchquery,
        CAST(sqp.search_query_score AS Nullable(Int64)) AS searchquerydata_searchqueryscore,
        CAST(sqp.search_query_volume AS Nullable(Int64)) AS searchquerydata_searchqueryvolume,
        CAST(sqp.total_query_impression_count AS Nullable(Int64)) AS impressiondata_totalqueryimpressioncount,
        CAST(sqp.asin_impression_count AS Nullable(Int64)) AS impressiondata_asinimpressioncount,
        CAST(sqp.total_click_count AS Nullable(Int64)) AS clickdata_totalclickcount,
        CAST(sqp.asin_click_count AS Nullable(Int64)) AS clickdata_asinclickcount,
        JSONExtract(sqp.raw_payload, 'clickdata_asinmedianclickprice_amount', 'Nullable(Float64)') AS clickdata_asinmedianclickprice_amount,
        CAST(sqp.total_cart_add_count AS Nullable(Int64)) AS cartadddata_totalcartaddcount,
        CAST(sqp.asin_cart_add_count AS Nullable(Int64)) AS cartadddata_asincartaddcount,
        CAST(sqp.total_purchase_count AS Nullable(Int64)) AS purchasedata_totalpurchasecount,
        CAST(sqp.asin_purchase_count AS Nullable(Int64)) AS purchasedata_asinpurchasecount,
        JSONExtract(sqp.raw_payload, 'purchasedata_asinmedianpurchaseprice_amount', 'Nullable(Float64)') AS purchasedata_asinmedianpurchaseprice_amount,
        CAST(
            if(ifNull(sqp.asin_impression_share, 0) = 0, NULL, sqp.asin_click_share / sqp.asin_impression_share)
            AS Nullable(Float64)
        ) AS kpi_ctr_advantage,
        sqp.company_id AS company_id,
        sqp.week_start AS week_start,
        CAST('child' AS String) AS row_type,
        ifNull(nullIf(sqp.product_family, ''), 'unknown') AS product_family
    FROM etl.ba_search_query_performance AS sqp
    {{asin_class_join_sql}}
    LEFT JOIN etl.ba_marketplaces AS marketplace
        ON sqp.marketplace_id = marketplace.marketplace_id
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
            upper(ifNull(cls.revenue_abcd_class, 'D'))
        )
        AND (
            length({{pareto_abc_class_array}}) = 0
            OR arrayExists(c -> upper(c) = upper(ifNull(cls.pareto_abc_class, 'C')), {{pareto_abc_class_array}})
        )
),

date_bounds AS (
    SELECT
        ifNull({{start_date_sql}}, addWeeks(max(week_start), -1 * ({{periods_back}} - 1))) AS start_date,
        ifNull({{end_date_sql}}, max(week_start)) AS end_date
    FROM base_child
),

windowed AS (
    SELECT *
    FROM base_child
    WHERE week_start >= (SELECT start_date FROM date_bounds)
      AND week_start <= (SELECT end_date FROM date_bounds)
),

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
        max(searchquerydata_searchquery) AS searchquerydata_searchquery,
        max(searchquerydata_searchqueryscore) AS searchquerydata_searchqueryscore,
        max(searchquerydata_searchqueryvolume) AS searchquerydata_searchqueryvolume,
        sum(impressiondata_totalqueryimpressioncount) AS impressiondata_totalqueryimpressioncount,
        sum(impressiondata_asinimpressioncount) AS impressiondata_asinimpressioncount,
        sum(clickdata_totalclickcount) AS clickdata_totalclickcount,
        sum(clickdata_asinclickcount) AS clickdata_asinclickcount,
        sum(cartadddata_totalcartaddcount) AS cartadddata_totalcartaddcount,
        sum(cartadddata_asincartaddcount) AS cartadddata_asincartaddcount,
        sum(purchasedata_totalpurchasecount) AS purchasedata_totalpurchasecount,
        sum(purchasedata_asinpurchasecount) AS purchasedata_asinpurchasecount,
        max(company_id) AS company_id,
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
        parent_asin AS asin,
        searchquerydata_searchquery AS searchquerydata_searchquery,
        CAST(searchquerydata_searchqueryscore AS Nullable(Int64)) AS searchquerydata_searchqueryscore,
        CAST(searchquerydata_searchqueryvolume AS Nullable(Int64)) AS searchquerydata_searchqueryvolume,
        CAST(impressiondata_totalqueryimpressioncount AS Nullable(Int64)) AS impressiondata_totalqueryimpressioncount,
        CAST(impressiondata_asinimpressioncount AS Nullable(Int64)) AS impressiondata_asinimpressioncount,
        CAST(clickdata_totalclickcount AS Nullable(Int64)) AS clickdata_totalclickcount,
        CAST(clickdata_asinclickcount AS Nullable(Int64)) AS clickdata_asinclickcount,
        CAST(NULL AS Nullable(Float64)) AS clickdata_asinmedianclickprice_amount,
        CAST(cartadddata_totalcartaddcount AS Nullable(Int64)) AS cartadddata_totalcartaddcount,
        CAST(cartadddata_asincartaddcount AS Nullable(Int64)) AS cartadddata_asincartaddcount,
        CAST(purchasedata_totalpurchasecount AS Nullable(Int64)) AS purchasedata_totalpurchasecount,
        CAST(purchasedata_asinpurchasecount AS Nullable(Int64)) AS purchasedata_asinpurchasecount,
        CAST(NULL AS Nullable(Float64)) AS purchasedata_asinmedianpurchaseprice_amount,
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
        company_id AS company_id,
        week_start AS week_start,
        CAST('parent' AS String) AS row_type,
        product_family AS product_family
    FROM parent_sums
),

final_base AS (
    SELECT * FROM windowed
    UNION ALL
    SELECT * FROM parent_agg
),

filtered AS (
    SELECT
        fb.*,
        ti.intent_ids AS intent_ids,
        ti.primary_intent_id AS primary_intent_id,
        ti.primary_intent_label AS primary_intent_label
    FROM final_base AS fb
    LEFT JOIN term_intents AS ti
        ON ti.company_id = fb.company_id
       AND ti.term_norm = lower(fb.searchquerydata_searchquery)
    WHERE length({{row_types_array}}) = 0
       OR arrayExists(rt -> lower(rt) = lower(fb.row_type), {{row_types_array}})
),

aggregated AS (
    SELECT
        {{group_by_select_clause}},

        -- Sample-size counts
        count() AS row_count,
        uniqExact(w.searchquerydata_searchquery) AS term_count,
        uniqExact(w.asin) AS asin_count,
        uniqExact(w.week_start) AS week_count,
        uniqExact(w.company_id) AS company_count,
        uniqExact(w.marketplace_country_code) AS marketplace_count,

        -- Totals (market)
        sum(ifNull(w.impressiondata_totalqueryimpressioncount, 0)) AS total_impressions,
        sum(ifNull(w.clickdata_totalclickcount, 0)) AS total_clicks,
        sum(ifNull(w.cartadddata_totalcartaddcount, 0)) AS total_cart_adds,
        sum(ifNull(w.purchasedata_totalpurchasecount, 0)) AS total_purchases,
        sum(ifNull(w.searchquerydata_searchqueryvolume, 0)) AS total_search_volume,

        -- Brand (your)
        sum(ifNull(w.impressiondata_asinimpressioncount, 0)) AS brand_impressions,
        sum(ifNull(w.clickdata_asinclickcount, 0)) AS brand_clicks,
        sum(ifNull(w.cartadddata_asincartaddcount, 0)) AS brand_cart_adds,
        sum(ifNull(w.purchasedata_asinpurchasecount, 0)) AS brand_purchases,

        -- Weighted KPIs — shares (brand vs market)
        sum(ifNull(w.impressiondata_asinimpressioncount, 0))
          / nullIf(sum(ifNull(w.impressiondata_totalqueryimpressioncount, 0)), 0) AS impression_share,
        sum(ifNull(w.clickdata_asinclickcount, 0))
          / nullIf(sum(ifNull(w.clickdata_totalclickcount, 0)), 0) AS click_share,
        sum(ifNull(w.cartadddata_asincartaddcount, 0))
          / nullIf(sum(ifNull(w.cartadddata_totalcartaddcount, 0)), 0) AS cart_add_share,
        sum(ifNull(w.purchasedata_asinpurchasecount, 0))
          / nullIf(sum(ifNull(w.purchasedata_totalpurchasecount, 0)), 0) AS purchase_share,

        -- Weighted KPIs — funnel rates (within your brand)
        sum(ifNull(w.clickdata_asinclickcount, 0))
          / nullIf(sum(ifNull(w.impressiondata_asinimpressioncount, 0)), 0) AS click_rate,
        sum(ifNull(w.cartadddata_asincartaddcount, 0))
          / nullIf(sum(ifNull(w.clickdata_asinclickcount, 0)), 0) AS cart_add_rate,
        sum(ifNull(w.purchasedata_asinpurchasecount, 0))
          / nullIf(sum(ifNull(w.clickdata_asinclickcount, 0)), 0) AS purchase_rate,

        -- Weighted CTR advantage (weighted by market impressions)
        sum(ifNull(w.kpi_ctr_advantage, 0) * ifNull(w.impressiondata_totalqueryimpressioncount, 0))
          / nullIf(sum(ifNull(w.impressiondata_totalqueryimpressioncount, 0)), 0) AS ctr_advantage,

        -- Weighted search query score (weighted by search volume)
        sum(ifNull(w.searchquerydata_searchqueryscore, 0) * ifNull(w.searchquerydata_searchqueryvolume, 0))
          / nullIf(sum(ifNull(w.searchquerydata_searchqueryvolume, 0)), 0) AS search_query_score,

        -- Weighted average prices (weighted by per-row count)
        sum(ifNull(w.purchasedata_asinmedianpurchaseprice_amount, 0) * ifNull(w.purchasedata_asinpurchasecount, 0))
          / nullIf(sum(ifNull(w.purchasedata_asinpurchasecount, 0)), 0) AS weighted_avg_purchase_price,
        sum(ifNull(w.clickdata_asinmedianclickprice_amount, 0) * ifNull(w.clickdata_asinclickcount, 0))
          / nullIf(sum(ifNull(w.clickdata_asinclickcount, 0)), 0) AS weighted_avg_click_price
    FROM filtered AS w
    GROUP BY {{group_by_clause}}
)

SELECT *
FROM aggregated
ORDER BY total_search_volume DESC NULLS LAST
LIMIT {{limit_top_n}};
