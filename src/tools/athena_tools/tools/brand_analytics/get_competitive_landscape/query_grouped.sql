-- Tool query for brand_analytics_get_competitive_landscape (ClickHouse, GROUPED variant)
--
-- Portfolio rollup across search_term / marketplace / intent. Returns one row
-- per bucket in `aggregations` instead of per-term `items`.
--
-- Volume weighting uses 1/(1+search_frequency_rank) so popular keywords dominate.
-- my_term_coverage_rate = distinct terms where any my_asin appears / distinct
-- terms in the bucket.
--
-- The `category` dimension of the Athena version is gone: departmentname came
-- from the raw Amazon payload, which ClickHouse does not retain.

WITH {{term_intents_cte_sql}},

base_filtered AS (
    SELECT
        st.company_id AS company_id,
        lower(ifNull(nullIf(marketplace.country_code, ''), st.marketplace_id)) AS marketplace,
        st.week_start AS week_start,
        st.search_term AS search_term,
        st.search_frequency_rank AS search_frequency_rank,
        ifNull(st.clicked_asin, '') AS asin,
        st.click_share AS click_share,
        st.conversion_share AS conversion_share
    FROM etl.ba_search_terms_current AS st
    LEFT JOIN etl.ba_marketplaces AS marketplace
        ON st.marketplace_id = marketplace.marketplace_id
    WHERE
        has({{company_ids_array}}, st.company_id)
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

term_intents_flat AS (
    SELECT
        term_norm AS term_norm,
        any(primary_intent_id) AS primary_intent_id,
        any(primary_intent_label) AS primary_intent_label
    FROM term_intents
    GROUP BY term_norm
),

enriched AS (
    SELECT
        w.company_id AS company_id,
        w.marketplace AS marketplace,
        w.period_start AS period_start,
        w.search_term AS search_term,
        w.search_frequency_rank AS search_frequency_rank,
        w.asin AS asin,
        w.click_share AS click_share,
        w.conversion_share AS conversion_share,
        ifNull(ti.primary_intent_id, '__UNCLASSIFIED__') AS primary_intent_id,
        ti.primary_intent_label AS primary_intent_label
    FROM windowed AS w
    LEFT JOIN term_intents_flat AS ti
        ON ti.term_norm = lower(w.search_term)
),

aggregated AS (
    SELECT
        {{group_by_select_clause}},
        any(e.primary_intent_label) AS primary_intent_label,
        count() AS row_count,
        uniqExact(e.search_term) AS term_count,
        uniqExact(e.asin) AS asin_count,
        uniqExact(e.marketplace) AS marketplace_count,
        uniqExact(e.period_start) AS period_count,
        sum(1.0 / (1.0 + toFloat64(ifNull(e.search_frequency_rank, 0)))) AS volume_score,
        -- Volume-weighted shares (weight = 1/(1+SFR); popular keywords contribute more)
        sum(ifNull(e.click_share, 0.0) * (1.0 / (1.0 + toFloat64(ifNull(e.search_frequency_rank, 0)))))
            / nullIf(sum(1.0 / (1.0 + toFloat64(ifNull(e.search_frequency_rank, 0)))), 0)
            AS click_share_weighted,
        sum(ifNull(e.conversion_share, 0.0) * (1.0 / (1.0 + toFloat64(ifNull(e.search_frequency_rank, 0)))))
            / nullIf(sum(1.0 / (1.0 + toFloat64(ifNull(e.search_frequency_rank, 0)))), 0)
            AS conversion_share_weighted,
        avg(ifNull(e.click_share, 0.0)) AS click_share_avg,
        avg(ifNull(e.conversion_share, 0.0)) AS conversion_share_avg,
        avg(toFloat64(ifNull(e.search_frequency_rank, 0))) AS search_frequency_rank_avg,
        min(e.search_frequency_rank) AS search_frequency_rank_min,
        -- My presence (distinct terms where any my_asin appears in this bucket)
        uniqExactIf(e.search_term, arrayExists(a -> lower(a) = lower(e.asin), {{my_asins_array}}))
            AS my_term_count,
        uniqExactIf(e.search_term, arrayExists(a -> lower(a) = lower(e.asin), {{my_asins_array}})) * 1.0
            / nullIf(uniqExact(e.search_term), 0) AS my_term_coverage_rate,
        -- Competitor presence
        uniqExactIf(e.search_term, arrayExists(a -> lower(a) = lower(e.asin), {{competitor_asins_array}}))
            AS competitor_term_count
    FROM enriched AS e
    GROUP BY {{group_by_clause}}
)

SELECT *
FROM aggregated
ORDER BY volume_score DESC NULLS LAST
LIMIT {{limit_top_n}}
