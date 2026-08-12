-- Tool query for brand_analytics_get_search_term_momentum (ClickHouse, detail grain)
--
-- SOURCE CHANGE vs Athena. The Athena version read one pre-materialised table,
-- search_term_smart_snapshot, that the snapshot ETL had already assembled from
-- two different Amazon reports. ClickHouse has no such table, so this query
-- rebuilds it from the two contracts it was built out of:
--
--   * "my" side (volume, my click share, ASIN classification) comes from
--     etl.ba_search_query_performance — exactly the columns the snapshot ETL
--     used: searchquerydata_searchqueryvolume -> search_query_volume and
--     clickdata_asinclickshare -> asin_click_share.
--   * competitor side (the top-3 clicked ASINs of a search term) comes from
--     etl.ba_search_term_smart, pivoted here on click_share_rank 1/2/3. The
--     snapshot stored that pivot pre-flattened.
--
-- DROPPED OUTPUT FIELDS. rank_N_itemname, rank_N_department and the `category`
-- dimension they fed are NOT available in ClickHouse: the Amazon search-terms
-- payload is not retained (raw_payload is empty on etl.ba_search_terms_current),
-- and the competitor ASINs belong to other sellers so etl.ba_asin_attributes
-- cannot supply a title either. They are omitted rather than filled with empty
-- strings, so a caller cannot mistake "unknown" for "no department". asin_class
-- is dropped for the same reason — it was a snapshot-ETL derivation over a
-- pareto percentile column that does not exist here; use pareto_abc_class.
--
-- 12 extra weeks are read before start_date so the rolling baselines have
-- history; `windowed` trims back to the requested range.

WITH {{asin_class_cte_sql}},

{{term_intents_cte_sql}},

-- ─── Top-3 clicked ASINs per search term × week ─────────────────────────────
-- maxIf over an empty match set yields '' for String and NULL for the
-- toNullable()-wrapped floats, which is what "this rank was not reported" must
-- look like downstream.
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

-- ─── Base rows: one SQP row per ASIN × search term × week, plus its top-3 ────
-- No dates are applied here so `date_bounds` below can find the true max week.
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
        cls.revenue_share AS revenue_share,
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
    -- toString on both sides: app_companies.id and company_id are not guaranteed
    -- to share an integer type, and this dimension is tiny.
    LEFT JOIN app.app_companies AS companies
        ON toString(companies.id) = toString(sqp.company_id)
    LEFT JOIN top3
        ON top3.company_id = sqp.company_id
       AND top3.marketplace_id = sqp.marketplace_id
       AND top3.week_start = sqp.week_start
       AND top3.search_term = sqp.search_query
    WHERE
        has({{company_ids_array}}, sqp.company_id)
        -- Scan guard: covers any 52-week lookback plus the 12-week baseline.
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

        -- asins / competitor_asins are an OR pair: when either is supplied the
        -- row must match at least one of them, on my ASIN or in the top 3.
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

-- ─── Date window ────────────────────────────────────────────────────────────
-- max() is wrapped in toNullable so an empty base yields NULL bounds (and thus
-- no rows) instead of the Date epoch, which addWeeks would clamp at 1970-01-01.
date_bounds AS (
    SELECT
        ifNull({{start_date_sql}}, addWeeks(max(toNullable(week_start)), -1 * ({{periods_back}} - 1))) AS start_date,
        ifNull({{end_date_sql}}, max(toNullable(week_start))) AS end_date,
        addWeeks(ifNull({{start_date_sql}}, addWeeks(max(toNullable(week_start)), -1 * ({{periods_back}} - 1))), -12) AS lookback_start
    FROM base_filtered
),

-- ─── Cap the term set before the window functions ───────────────────────────
-- Guards against materialising every term of a large company; the cap is a
-- multiple of the requested limit so post-filters still have candidates.
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

-- ─── Momentum baselines ─────────────────────────────────────────────────────
with_momentum AS (
    SELECT
        *,
        -- toNullable pins the "no preceding row" case to NULL. lagInFrame
        -- otherwise returns the column type's default, which would report a
        -- first week as a gain of its entire click share and hide the 'new'
        -- signal.
        lagInFrame(toNullable(my_click_share), 1) OVER w AS prev_week_share,
        my_click_share - lagInFrame(toNullable(my_click_share), 1) OVER w AS wow_delta,
        avg(my_click_share) OVER (
            PARTITION BY search_term, asin, marketplace_id, company_id
            ORDER BY week_start
            ROWS BETWEEN 3 PRECEDING AND CURRENT ROW
        ) AS avg_share_l4w,
        avg(my_click_share) OVER (
            PARTITION BY search_term, asin, marketplace_id, company_id
            ORDER BY week_start
            ROWS BETWEEN 11 PRECEDING AND CURRENT ROW
        ) AS avg_share_l12w
    FROM expanded
    WINDOW w AS (
        PARTITION BY search_term, asin, marketplace_id, company_id
        ORDER BY week_start
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    )
),

-- ─── Trim to the requested range and label the signal ───────────────────────
windowed AS (
    SELECT
        *,
        multiIf(
            wow_delta IS NULL,                                    'new',
            wow_delta > 0 AND avg_share_l4w > avg_share_l12w,     'accelerating',
            wow_delta > 0,                                        'growing',
            wow_delta < 0 AND avg_share_l4w < avg_share_l12w,     'collapsing',
            wow_delta < 0,                                        'declining',
                                                                  'stable'
        ) AS momentum_signal
    FROM with_momentum
    WHERE week_start >= (SELECT start_date FROM date_bounds)
      AND week_start <= (SELECT end_date FROM date_bounds)
),

-- ─── Latest week per (search_term, asin, marketplace) ───────────────────────
current_rows AS (
    SELECT *
    FROM (
        SELECT
            *,
            row_number() OVER (
                PARTITION BY search_term, asin, marketplace_id
                ORDER BY week_start DESC
            ) AS rn
        FROM windowed
    )
    WHERE rn = 1
),

enriched AS (
    SELECT
        c.search_term AS search_term,
        c.company_name AS company_name,
        c.marketplace AS marketplace,
        c.marketplace_id AS marketplace_id,
        c.currency AS currency,
        c.volume AS search_volume,
        c.week_start AS period_start,
        addDays(c.week_start, 6) AS period_end,

        c.asin AS my_asin,
        c.my_brand AS my_brand,
        c.my_click_share AS my_click_share,
        c.prev_week_share AS prev_week_share,
        round(c.wow_delta, 6) AS wow_delta,
        round(c.avg_share_l4w, 6) AS avg_share_l4w,
        round(c.avg_share_l12w, 6) AS avg_share_l12w,
        c.momentum_signal AS momentum_signal,

        c.revenue_abcd_class AS revenue_abcd_class,
        c.pareto_abc_class AS pareto_abc_class,
        c.product_family AS product_family,
        round(c.revenue_share, 4) AS revenue_share,

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
            lower(c.asin) = lower(c.rank_1_asin), 1,
            lower(c.asin) = lower(c.rank_2_asin), 2,
            lower(c.asin) = lower(c.rank_3_asin), 3,
            CAST(NULL AS Nullable(UInt8))
        ) AS my_position,

        multiIf(
            c.rank_1_conversionshare IS NULL, false,
            c.rank_1_conversionshare <= {{weak_leader_max_conversion_share}}
                AND ifNull(c.volume, 0) >= {{weak_leader_min_search_volume}}, true,
            false
        ) AS is_weak_leader,

        ifNull(c.rank_1_conversionshare, 0.0) AS leader_conversion_share,

        if(
            c.rank_1_conversionshare IS NULL,
            0.0,
            greatest(0.0, 1.0 - c.rank_1_conversionshare) * ifNull(c.volume, 0) / 1000.0
        ) AS displacement_opportunity_score,

        if(
            c.my_click_share IS NOT NULL AND c.rank_1_clickshare IS NOT NULL,
            c.rank_1_clickshare - c.my_click_share,
            CAST(NULL AS Nullable(Float64))
        ) AS click_share_to_leader,

        ti.intent_ids AS intent_ids,
        ti.primary_intent_id AS primary_intent_id,
        ti.primary_intent_label AS primary_intent_label
    FROM current_rows AS c
    LEFT JOIN term_intents AS ti
        ON ti.company_id = c.company_id
       AND ti.term_norm = lower(c.search_term)
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
-- both sorts the same key tiebreakers, keeps the two in lockstep.
SELECT
    row_number() OVER (
        ORDER BY {{sort_column}} {{sort_direction}} NULLS LAST,
                 search_term ASC, my_asin ASC, marketplace_id ASC
    ) AS `rank`,
    f.*,
    (SELECT max(classification_as_of) FROM asin_revenue_class) AS classification_as_of
FROM filtered AS f
ORDER BY `rank` ASC
LIMIT {{limit_top_n}}
