-- Tool query for brand_analytics_get_competitive_landscape (ClickHouse, detail grain)
--
-- SOURCE CHANGE vs Athena. The Athena version read the raw Amazon report table
-- sp_api_iceberg.brand_analytics_search_terms_report and unnested its
-- rspec_marketplaceids array. ClickHouse exposes the same contract already
-- normalised, one row per company x marketplace x week x search term x clicked
-- ASIN, as etl.ba_search_terms_current — so the UNNEST and the marketplace
-- fan-out disappear.
--
-- DROPPED `category`. departmentname came from the raw Amazon payload, which is
-- not retained in ClickHouse (raw_payload is empty on etl.ba_search_terms_current).
-- The `category` filter and the `category` group_by dimension are therefore gone
-- rather than silently matching nothing.
--
-- title / brand are now NULL for competitor ASINs. Amazon's clickeditemname is
-- likewise not retained, so the only titles available are the ones NeonPanel
-- holds for the seller's OWN catalog (etl.ba_asin_attributes). Competitor rows
-- carry JSON null instead of a fabricated string, so a caller cannot mistake
-- "we do not know this product" for "this product has no title".

WITH {{term_intents_cte_sql}},

-- ─── Own-catalog titles, pre-collapsed ──────────────────────────────────────
-- Grouped before the join: ba_asin_attributes can hold more than one row per
-- (company, marketplace, asin), and a fan-out here would double-count the
-- AVG(click_share) in `aggregated_base`.
asin_attrs AS (
    SELECT
        ifNull(company_id, 0) AS company_id,
        ifNull(marketplace_id, '') AS marketplace_id,
        asin AS asin,
        any(title) AS title,
        any(brand) AS brand
    FROM etl.ba_asin_attributes
    WHERE has({{company_ids_array}}, ifNull(company_id, 0))
    GROUP BY company_id, marketplace_id, asin
),

-- ─── Base rows ──────────────────────────────────────────────────────────────
-- No date window here so `date_bounds` below can find the true latest week.
base_filtered AS (
    SELECT
        st.company_id AS company_id,
        st.marketplace_id AS marketplace_id,
        lower(ifNull(nullIf(marketplace.country_code, ''), st.marketplace_id)) AS marketplace,
        st.week_start AS week_start,
        st.search_term AS search_term,
        st.search_frequency_rank AS search_frequency_rank,
        ifNull(st.clicked_asin, '') AS asin,
        st.click_share_rank AS click_share_rank,
        st.click_share AS click_share,
        st.conversion_share AS conversion_share,
        attrs.title AS title,
        attrs.brand AS brand
    FROM etl.ba_search_terms_current AS st
    LEFT JOIN etl.ba_marketplaces AS marketplace
        ON st.marketplace_id = marketplace.marketplace_id
    LEFT JOIN asin_attrs AS attrs
        ON attrs.company_id = st.company_id
       AND attrs.marketplace_id = st.marketplace_id
       AND attrs.asin = ifNull(st.clicked_asin, '')
    WHERE
        has({{company_ids_array}}, st.company_id)
        -- Scan guard: covers the widest supported window (26 quarters back).
        AND st.week_start >= addYears(today(), -7)

        AND (
            length({{search_terms_array}}) = 0
            OR arrayExists(term -> lower(term) = lower(st.search_term), {{search_terms_array}})
        )

        AND ({{intent_terms_filter_sql}})

        AND (
            length({{marketplaces_array}}) = 0
            OR arrayExists(
                m -> lower(m) IN (
                    lower(ifNull(marketplace.country, '')),
                    lower(ifNull(marketplace.country_code, '')),
                    lower(ifNull(marketplace.marketplace_name, '')),
                    lower(st.marketplace_id)
                ),
                {{marketplaces_array}}
            )
        )

        AND (
            (length({{my_asins_array}}) = 0 AND length({{competitor_asins_array}}) = 0)
            OR arrayExists(a -> lower(a) = lower(ifNull(st.clicked_asin, '')), {{my_asins_array}})
            OR arrayExists(a -> lower(a) = lower(ifNull(st.clicked_asin, '')), {{competitor_asins_array}})
        )
),

-- ─── Period window ──────────────────────────────────────────────────────────
-- max() is wrapped in toNullable so an empty base yields NULL bounds (and thus
-- no rows) rather than the Date epoch, which the period arithmetic would
-- otherwise clamp at 1970-01-01.
date_bounds AS (
    SELECT
        ifNull(
            {{start_date_sql}},
            {{period_add_sql}}(
                {{period_trunc_sql}}(max(toNullable(week_start))),
                -1 * ({{periods_back}} - 1)
            )
        ) AS start_date,
        ifNull(
            {{end_date_sql}},
            addDays({{period_add_sql}}({{period_trunc_sql}}(max(toNullable(week_start))), 1), -1)
        ) AS end_date
    FROM base_filtered
),

windowed AS (
    SELECT
        *,
        {{period_trunc_sql}}(week_start) AS period_start
    FROM base_filtered
    WHERE week_start >= (SELECT start_date FROM date_bounds)
      AND week_start <= (SELECT end_date FROM date_bounds)
),

-- ─── Collapse to one row per search term x period x ASIN ────────────────────
aggregated_base AS (
    SELECT
        search_term AS search_term,
        period_start AS period_start,
        asin AS asin,
        min(search_frequency_rank) AS search_frequency_rank,
        max(title) AS title,
        max(brand) AS brand,
        min(click_share_rank) AS click_share_rank,
        avg(ifNull(click_share, 0.0)) AS click_share,
        avg(ifNull(conversion_share, 0.0)) AS conversion_share
    FROM windowed
    GROUP BY search_term, period_start, asin
),

aggregated AS (
    SELECT
        *,
        addDays({{period_add_sql}}(period_start, 1), -1) AS period_end
    FROM aggregated_base
),

-- ─── Rank within the period, then read the previous period ──────────────────
-- click_share_rank is Nullable; ifNull pushes unranked ASINs to the back
-- deterministically instead of relying on NULLS LAST inside a window ORDER BY.
ranked_base AS (
    SELECT
        *,
        row_number() OVER (
            PARTITION BY search_term, period_start
            ORDER BY ifNull(click_share_rank, 999999) ASC, click_share DESC
        ) AS rank_position
    FROM aggregated
),

ranked AS (
    SELECT
        *,
        -- toNullable is REQUIRED. lagInFrame returns the column type's default
        -- (0.0 for Float64), not NULL, when there is no preceding row — so an
        -- unwrapped lag would make every first-observation row look like a
        -- gain of its entire click share. Nullable defaults to NULL, which the
        -- ifNull() below then collapses to a zero trend.
        lagInFrame(toNullable(click_share), 1) OVER w AS click_share_prev,
        lagInFrame(toNullable(conversion_share), 1) OVER w AS conversion_share_prev,
        lagInFrame(toNullable(rank_position), 1) OVER w AS prev_position
    FROM ranked_base
    WINDOW w AS (
        PARTITION BY search_term, asin
        ORDER BY period_start
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    )
),

top3 AS (
    SELECT
        *,
        arrayExists(a -> lower(a) = lower(asin), {{my_asins_array}}) AS is_mine,
        arrayExists(a -> lower(a) = lower(asin), {{competitor_asins_array}}) AS is_competitor
    FROM ranked
    WHERE rank_position <= 3
),

per_term AS (
    SELECT
        search_term AS search_term,
        min(search_frequency_rank) AS search_frequency_rank,
        period_start AS period_start,
        period_end AS period_end,
        arraySort(
            product -> product.1,
            groupArray(
                CAST(
                    (
                        rank_position,
                        asin,
                        title,
                        brand,
                        is_mine,
                        click_share,
                        click_share - ifNull(click_share_prev, click_share),
                        conversion_share,
                        conversion_share - ifNull(conversion_share_prev, conversion_share),
                        ifNull(prev_position, rank_position) - rank_position
                    ),
                    'Tuple(position Int32, asin String, title Nullable(String), brand Nullable(String), is_mine Bool, click_share Float64, click_share_trend Float64, conversion_share Float64, conversion_share_trend Float64, position_change Int32)'
                )
            )
        ) AS top_3_products_arr,
        minIf(toNullable(rank_position), is_mine) AS my_position,
        maxIf(toNullable(conversion_share), rank_position = 1) AS leader_conversion_share,
        maxIf(toNullable(click_share), rank_position = 1) AS leader_click_share,
        maxIf(toNullable(click_share), is_mine) AS my_click_share,
        maxIf(toNullable(conversion_share), is_mine) AS my_conversion_share,
        max(if(is_competitor, 1, 0)) AS has_competitor
    FROM top3
    GROUP BY search_term, period_start, period_end
),

-- Intent ids are mapped per company; flatten across the permitted companies so
-- a term carries the union of its intents.
term_intents_flat AS (
    SELECT
        term_norm AS term_norm,
        arrayDistinct(arrayFlatten(groupArray(intent_ids))) AS intent_ids,
        any(primary_intent_id) AS primary_intent_id,
        any(primary_intent_label) AS primary_intent_label
    FROM term_intents
    GROUP BY term_norm
)

SELECT
    pt.search_term AS search_term,
    pt.search_frequency_rank AS search_frequency_rank,
    pt.period_start AS period_start,
    pt.period_end AS period_end,
    toJSONString(pt.top_3_products_arr) AS top_3_products,
    pt.my_position AS my_position,
    toJSONString(
        CAST(
            (
                multiIf(
                    pt.leader_conversion_share IS NULL,
                        false,
                    pt.leader_conversion_share <= {{weak_leader_max_conversion_share}}
                        AND ifNull(pt.search_frequency_rank, 999999999) <= {{weak_leader_min_search_volume_rank}}
                        AND ({{weak_leader_require_my_presence}} = 0 OR pt.my_position IS NOT NULL),
                        true,
                    false
                ),
                ifNull(pt.leader_conversion_share, 0.0),
                multiIf(
                    pt.leader_conversion_share IS NULL,
                        0.0,
                    greatest(0.0, 1.0 - pt.leader_conversion_share)
                        * (1.0 / (1.0 + toFloat64(ifNull(pt.search_frequency_rank, 0))))
                        * 100000.0
                ),
                multiIf(
                    pt.leader_conversion_share IS NULL,
                        'insufficient_data',
                    pt.leader_conversion_share <= {{weak_leader_max_conversion_share}},
                        'optimize_listing_to_displace',
                    'monitor_competitor_strength'
                )
            ),
            'Tuple(is_weak_leader Bool, leader_conversion_share Float64, displacement_opportunity_score Float64, recommended_action String)'
        )
    ) AS weak_leader_analysis,
    -- my_* are NULL when none of my ASINs made the top 3, so the subtraction is
    -- already NULL — no explicit guard needed.
    toJSONString(
        CAST(
            (
                pt.leader_click_share - pt.my_click_share,
                pt.leader_conversion_share - pt.my_conversion_share,
                CAST(NULL AS Nullable(Int64))
            ),
            'Tuple(click_share_to_leader Nullable(Float64), conversion_share_to_leader Nullable(Float64), estimated_clicks_if_leader Nullable(Int64))'
        )
    ) AS share_gaps,
    ti.intent_ids AS intent_ids,
    ti.primary_intent_id AS primary_intent_id,
    ti.primary_intent_label AS primary_intent_label
FROM per_term AS pt
LEFT JOIN term_intents_flat AS ti
    ON ti.term_norm = lower(pt.search_term)
WHERE length({{competitor_asins_array}}) = 0 OR pt.has_competitor = 1
ORDER BY pt.search_frequency_rank ASC NULLS LAST
LIMIT {{limit_top_n}}
