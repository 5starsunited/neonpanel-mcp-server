-- Tool query for brand_analytics_get_search_term_momentum (ClickHouse, grouped grain)
--
-- Same two sources and the same dropped fields as query.sql — see the header
-- there. This variant de-duplicates to ASIN-week rows first, then aggregates to
-- the requested group and recomputes the momentum baselines on the grouped
-- portfolio click share.
--
-- search_volume is a term-level figure, so it is de-duplicated with max() and
-- never summed across the ASINs of a group.

WITH {{asin_class_cte_sql}},

{{term_intents_cte_sql}},

top3 AS (
    SELECT
        company_id AS company_id,
        marketplace_id AS marketplace_id,
        week_start AS week_start,
        search_term AS search_term,
        maxIf(ifNull(clicked_asin, ''), click_share_rank = 1) AS rank_1_asin,
        maxIf(toNullable(click_share), click_share_rank = 1) AS rank_1_clickshare,
        maxIf(toNullable(conversion_share), click_share_rank = 1) AS rank_1_conversionshare,
        maxIf(ifNull(clicked_asin, ''), click_share_rank = 2) AS rank_2_asin,
        maxIf(toNullable(click_share), click_share_rank = 2) AS rank_2_clickshare,
        maxIf(toNullable(conversion_share), click_share_rank = 2) AS rank_2_conversionshare,
        maxIf(ifNull(clicked_asin, ''), click_share_rank = 3) AS rank_3_asin,
        maxIf(toNullable(click_share), click_share_rank = 3) AS rank_3_clickshare,
        maxIf(toNullable(conversion_share), click_share_rank = 3) AS rank_3_conversionshare
    FROM etl.ba_search_term_smart
    WHERE has({{company_ids_array}}, company_id)
      AND week_start >= addYears(today(), -3)
    GROUP BY company_id, marketplace_id, week_start, search_term
),

base_filtered AS (
    SELECT
        sqp.company_id AS company_id,
        ifNull(companies.name, 'unknown') AS company_name,
        lower(ifNull(marketplace.country_code, '')) AS marketplace,
        sqp.marketplace_id AS marketplace_id,
        marketplace.marketplace_currency AS currency,
        sqp.week_start AS week_start,
        sqp.search_query AS search_term,
        sqp.asin AS asin,
        ifNull(nullIf(sqp.brand, ''), 'unknown') AS my_brand,
        ifNull(nullIf(sqp.product_family, ''), 'unknown') AS product_family,
        ifNull(cls.revenue_abcd_class, 'D') AS revenue_abcd_class,
        ifNull(cls.pareto_abc_class, 'C') AS pareto_abc_class,
        CAST(sqp.revenue_share AS Nullable(Float64)) AS revenue_share,
        CAST(sqp.search_query_volume AS Nullable(Int64)) AS volume,
        CAST(sqp.asin_click_share AS Nullable(Float64)) AS my_click_share,
        top3.rank_1_asin AS rank_1_asin,
        top3.rank_1_clickshare AS rank_1_clickshare,
        top3.rank_1_conversionshare AS rank_1_conversionshare,
        top3.rank_2_asin AS rank_2_asin,
        top3.rank_2_clickshare AS rank_2_clickshare,
        top3.rank_2_conversionshare AS rank_2_conversionshare,
        top3.rank_3_asin AS rank_3_asin,
        top3.rank_3_clickshare AS rank_3_clickshare,
        top3.rank_3_conversionshare AS rank_3_conversionshare
    FROM etl.ba_search_query_performance AS sqp
    {{asin_class_join_sql}}
    LEFT JOIN etl.ba_marketplaces AS marketplace
        ON sqp.marketplace_id = marketplace.marketplace_id
    LEFT JOIN app.app_companies AS companies
        ON toString(companies.id) = toString(sqp.company_id)
    LEFT JOIN top3
        ON top3.company_id = sqp.company_id
       AND top3.marketplace_id = sqp.marketplace_id
       AND top3.week_start = sqp.week_start
       AND top3.search_term = sqp.search_query
    WHERE
        has({{company_ids_array}}, sqp.company_id)
        AND sqp.week_start >= addYears(today(), -3)

        AND (
            length({{search_terms_array}}) = 0
            OR {{search_term_match_sql}}
        )

        AND ({{intent_terms_filter_sql}})

        AND (
            length({{marketplaces_array}}) = 0
            OR arrayExists(
                m -> lower(m) IN (
                    lower(ifNull(marketplace.country_code, '')),
                    lower(ifNull(marketplace.marketplace_name, '')),
                    lower(sqp.marketplace_id)
                ),
                {{marketplaces_array}}
            )
        )

        AND (
            length({{brands_array}}) = 0
            OR arrayExists(b -> lower(b) = lower(ifNull(sqp.brand, '')), {{brands_array}})
        )

        AND (
            length({{revenue_abcd_class_array}}) = 0
            OR arrayExists(c -> upper(c) = upper(ifNull(cls.revenue_abcd_class, 'D')), {{revenue_abcd_class_array}})
        )

        AND (
            length({{pareto_abc_class_array}}) = 0
            OR arrayExists(c -> upper(c) = upper(ifNull(cls.pareto_abc_class, 'C')), {{pareto_abc_class_array}})
        )

        AND (
            length({{product_families_array}}) = 0
            OR arrayExists(f -> lower(f) = lower(ifNull(sqp.product_family, '')), {{product_families_array}})
        )

        AND (
            (length({{asins_array}}) = 0 AND length({{competitor_asins_array}}) = 0)
            OR arrayExists(a -> lower(a) = lower(sqp.asin), {{asins_array}})
            OR arrayExists(
                a -> lower(a) IN (
                    lower(ifNull(top3.rank_1_asin, '')),
                    lower(ifNull(top3.rank_2_asin, '')),
                    lower(ifNull(top3.rank_3_asin, ''))
                ),
                {{competitor_asins_array}}
            )
        )
),

date_bounds AS (
    SELECT
        ifNull({{start_date_sql}}, addWeeks(max(toNullable(week_start)), -1 * ({{periods_back}} - 1))) AS start_date,
        ifNull({{end_date_sql}}, max(toNullable(week_start))) AS end_date,
        addWeeks(ifNull({{start_date_sql}}, addWeeks(max(toNullable(week_start)), -1 * ({{periods_back}} - 1))), -12) AS lookback_start
    FROM base_filtered
),

top_terms AS (
    SELECT search_term
    FROM (
        SELECT search_term, max(volume) AS max_vol
        FROM base_filtered
        WHERE week_start >= (SELECT start_date FROM date_bounds)
          AND week_start <= (SELECT end_date FROM date_bounds)
        GROUP BY search_term
    )
    ORDER BY max_vol DESC NULLS LAST
    LIMIT {{top_terms_limit}}
),

expanded AS (
    SELECT *
    FROM base_filtered
    WHERE week_start >= (SELECT lookback_start FROM date_bounds)
      AND week_start <= (SELECT end_date FROM date_bounds)
      AND search_term IN (SELECT search_term FROM top_terms)
),

-- ─── One row per ASIN × term × week, with its intent labels attached ────────
asin_weekly AS (
    SELECT
        e.company_id AS company_id,
        max(e.company_name) AS company_name,
        e.marketplace AS marketplace,
        max(e.currency) AS currency,
        e.search_term AS search_term,
        e.week_start AS week_start,
        e.asin AS asin,
        max(e.my_brand) AS my_brand,
        max(e.product_family) AS product_family,
        max(e.revenue_abcd_class) AS revenue_abcd_class,
        max(e.pareto_abc_class) AS pareto_abc_class,
        max(e.volume) AS search_volume,
        max(e.my_click_share) AS my_click_share,
        max(e.revenue_share) AS revenue_share,
        max(e.rank_1_asin) AS rank_1_asin,
        max(e.rank_1_clickshare) AS rank_1_clickshare,
        max(e.rank_1_conversionshare) AS rank_1_conversionshare,
        max(e.rank_2_asin) AS rank_2_asin,
        max(e.rank_2_clickshare) AS rank_2_clickshare,
        max(e.rank_2_conversionshare) AS rank_2_conversionshare,
        max(e.rank_3_asin) AS rank_3_asin,
        max(e.rank_3_clickshare) AS rank_3_clickshare,
        max(e.rank_3_conversionshare) AS rank_3_conversionshare,
        max(ti.primary_intent_id) AS primary_intent_id,
        max(ti.primary_intent_label) AS primary_intent_label
    FROM expanded AS e
    LEFT JOIN term_intents AS ti
        ON ti.company_id = e.company_id
       AND ti.term_norm = lower(e.search_term)
    GROUP BY
        e.company_id,
        e.marketplace,
        e.search_term,
        e.week_start,
        e.asin
),

weekly_grouped AS (
    SELECT
        max(aw.primary_intent_label) AS primary_intent_label,
        {{group_by_select_clause}},
        aw.week_start AS period_start,
        addDays(aw.week_start, 6) AS period_end,
        max(aw.currency) AS currency,
        max(aw.company_name) AS company_name,
        uniqExact(aw.company_id) AS company_count,
        uniqExact(aw.marketplace) AS marketplace_count,
        max(aw.search_volume) AS search_volume,
        least(1.0, sum(ifNull(aw.my_click_share, 0.0))) AS portfolio_click_share,
        sum(ifNull(aw.my_click_share, 0.0)) AS portfolio_click_share_uncapped,
        least(1.0, sum(ifNull(aw.my_click_share, 0.0))) AS my_click_share,
        avg(aw.my_click_share) AS avg_asin_click_share,
        max(aw.my_click_share) AS max_asin_click_share,
        uniqExact(aw.asin) AS asin_count,
        arrayStringConcat(arraySlice(arraySort(groupUniqArray(aw.asin)), 1, 25), ',') AS portfolio_asins,
        argMax(aw.asin, ifNull(aw.my_click_share, -1.0)) AS top_asin_by_click_share,
        sum(ifNull(aw.revenue_share, 0.0)) AS total_revenue_share,
        max(aw.rank_1_asin) AS rank_1_asin,
        max(aw.rank_1_clickshare) AS rank_1_clickshare,
        max(aw.rank_1_conversionshare) AS rank_1_conversionshare,
        max(aw.rank_2_asin) AS rank_2_asin,
        max(aw.rank_2_clickshare) AS rank_2_clickshare,
        max(aw.rank_2_conversionshare) AS rank_2_conversionshare,
        max(aw.rank_3_asin) AS rank_3_asin,
        max(aw.rank_3_clickshare) AS rank_3_clickshare,
        max(aw.rank_3_conversionshare) AS rank_3_conversionshare
    FROM asin_weekly AS aw
    GROUP BY {{group_by_clause}}, aw.week_start
),

with_momentum AS (
    SELECT
        *,
        -- toNullable is REQUIRED. my_click_share here is least(1.0, sum(...)),
        -- a non-nullable Float64, and lagInFrame returns the type default (0.0)
        -- rather than NULL when there is no preceding row. Unwrapped, a first
        -- week would report wow_delta = its whole click share and could never
        -- be classified 'new'.
        lagInFrame(toNullable(my_click_share), 1) OVER w AS prev_week_share,
        my_click_share - lagInFrame(toNullable(my_click_share), 1) OVER w AS wow_delta,
        avg(my_click_share) OVER (
            PARTITION BY {{partition_by_clause}}
            ORDER BY period_start
            ROWS BETWEEN 3 PRECEDING AND CURRENT ROW
        ) AS avg_share_l4w,
        avg(my_click_share) OVER (
            PARTITION BY {{partition_by_clause}}
            ORDER BY period_start
            ROWS BETWEEN 11 PRECEDING AND CURRENT ROW
        ) AS avg_share_l12w
    FROM weekly_grouped
    WINDOW w AS (
        PARTITION BY {{partition_by_clause}}
        ORDER BY period_start
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    )
),

windowed AS (
    SELECT
        *,
        multiIf(
            wow_delta IS NULL,                                'new',
            wow_delta > 0 AND avg_share_l4w > avg_share_l12w, 'accelerating',
            wow_delta > 0,                                    'growing',
            wow_delta < 0 AND avg_share_l4w < avg_share_l12w, 'collapsing',
            wow_delta < 0,                                    'declining',
                                                              'stable'
        ) AS momentum_signal
    FROM with_momentum
    WHERE period_start >= (SELECT start_date FROM date_bounds)
      AND period_start <= (SELECT end_date FROM date_bounds)
),

current_rows AS (
    SELECT *
    FROM (
        SELECT
            *,
            row_number() OVER (
                PARTITION BY {{partition_by_clause}}
                ORDER BY period_start DESC
            ) AS rn
        FROM windowed
    )
    WHERE rn = 1
),

enriched AS (
    SELECT
        {{final_group_by_select_clause}},
        c.period_start AS period_start,
        c.period_end AS period_end,
        c.currency AS currency,
        c.primary_intent_label AS primary_intent_label,
        c.company_name AS company_name,
        c.company_count AS company_count,
        c.marketplace_count AS marketplace_count,
        c.search_volume AS search_volume,
        c.portfolio_click_share AS portfolio_click_share,
        c.portfolio_click_share_uncapped AS portfolio_click_share_uncapped,
        c.my_click_share AS my_click_share,
        c.prev_week_share AS prev_week_share,
        round(c.wow_delta, 6) AS wow_delta,
        round(c.avg_share_l4w, 6) AS avg_share_l4w,
        round(c.avg_share_l12w, 6) AS avg_share_l12w,
        c.momentum_signal AS momentum_signal,
        c.avg_asin_click_share AS avg_asin_click_share,
        c.max_asin_click_share AS max_asin_click_share,
        c.asin_count AS asin_count,
        c.portfolio_asins AS portfolio_asins,
        c.top_asin_by_click_share AS top_asin_by_click_share,
        c.total_revenue_share AS total_revenue_share,
        nullIf(c.rank_1_asin, '') AS rank_1_asin,
        c.rank_1_clickshare AS rank_1_clickshare,
        c.rank_1_conversionshare AS rank_1_conversionshare,
        nullIf(c.rank_2_asin, '') AS rank_2_asin,
        c.rank_2_clickshare AS rank_2_clickshare,
        c.rank_2_conversionshare AS rank_2_conversionshare,
        nullIf(c.rank_3_asin, '') AS rank_3_asin,
        c.rank_3_clickshare AS rank_3_clickshare,
        c.rank_3_conversionshare AS rank_3_conversionshare,
        multiIf(
            c.rank_1_conversionshare IS NULL, false,
            c.rank_1_conversionshare <= {{weak_leader_max_conversion_share}}
                AND ifNull(c.search_volume, 0) >= {{weak_leader_min_search_volume}}, true,
            false
        ) AS is_weak_leader,
        ifNull(c.rank_1_conversionshare, 0.0) AS leader_conversion_share,
        if(
            c.rank_1_conversionshare IS NULL,
            0.0,
            greatest(0.0, 1.0 - c.rank_1_conversionshare) * ifNull(c.search_volume, 0) / 1000.0
        ) AS displacement_opportunity_score,
        if(
            c.my_click_share IS NOT NULL AND c.rank_1_clickshare IS NOT NULL,
            c.rank_1_clickshare - c.my_click_share,
            CAST(NULL AS Nullable(Float64))
        ) AS click_share_to_leader
    FROM current_rows AS c
),

filtered AS (
    SELECT *
    FROM enriched
    WHERE
        (
            length({{momentum_signals_array}}) = 0
            OR arrayExists(s -> lower(s) = lower(momentum_signal), {{momentum_signals_array}})
        )
        AND ({{min_click_share}} = 0 OR ifNull(my_click_share, 0) >= {{min_click_share}})
        AND ({{min_search_volume}} = 0 OR ifNull(search_volume, 0) >= {{min_search_volume}})
)

-- The window ORDER BY and the final ORDER BY must be identical and total.
-- With only {{sort_column}} to order by, ties are broken independently by the
-- window and by the final sort, so a LIMITed "top N" can come back carrying
-- arbitrary rank values. Ordering the result by the computed rank, and giving
-- both sorts the group-by dimensions as tiebreakers, keeps the two in lockstep.
SELECT
    row_number() OVER (
        ORDER BY {{sort_column}} {{sort_direction}} NULLS LAST,
                 {{partition_by_clause}}
    ) AS `rank`,
    f.*
FROM filtered AS f
ORDER BY `rank` ASC
LIMIT {{limit_top_n}}
