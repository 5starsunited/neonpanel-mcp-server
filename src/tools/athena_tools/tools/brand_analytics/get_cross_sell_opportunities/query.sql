-- Tool query for brand_analytics_get_cross_sell_opportunities (ClickHouse)
--
-- SOURCE CHANGE vs Athena. The Athena version read the raw report table
-- sp_api_iceberg.brand_analytics_market_basket_report and unnested its
-- rspec_marketplaceids array. ClickHouse exposes the same contract already
-- normalised as etl.ba_market_basket_current, one row per
-- company x marketplace x week x ASIN x co-purchased ASIN, so the UNNEST and
-- the deduplication it forced disappear.
--
-- SCALE CORRECTION. combination_pct is a 0-1 fraction (verified: it equals the
-- raw Amazon `combinationpct` field exactly, and the observed maximum across
-- the table is 1.0). The Athena tool documented it as 0-100 and validated
-- min_combination_pct against that range, so any caller passing a real
-- percentage silently matched nothing. The threshold is now on the same 0-1
-- scale as the data.
--
-- Notes:
--   • combination_pct = share of the primary ASIN's orders that also include
--     the co-purchased ASIN
--   • purchased_with_rank = Amazon's rank (1 = most frequently co-purchased)

WITH {{asin_class_cte_sql}},

-- ─── Own-catalog attributes, pre-collapsed ──────────────────────────────────
-- Grouped before the join: ba_asin_attributes can hold more than one row per
-- (company, marketplace, asin), and a fan-out would duplicate output rows.
--
-- The classification columns deliberately do NOT come from ba_asin_attributes.
-- That view resolves through etl.sku_classification_last30_by_marketplace, which
-- recomputes from a rolling 30-day window on every query, so the same ASIN can
-- change class between two runs minutes apart. asin_revenue_class reads the
-- inventory-planning snapshot instead, which is stable.
asin_attrs AS (
    SELECT
        a.company_id AS company_id,
        a.marketplace_id AS marketplace_id,
        a.asin AS asin,
        a.product_family AS product_family,
        a.brand AS brand,
        cls.pareto_abc_class AS pareto_abc_class,
        cls.revenue_abcd_class AS revenue_abcd_class,
        cls.revenue_share AS revenue_share
    FROM (
        SELECT
            ifNull(company_id, 0) AS company_id,
            ifNull(marketplace_id, '') AS marketplace_id,
            asin AS asin,
            any(product_family) AS product_family,
            any(brand) AS brand
        FROM etl.ba_asin_attributes
        WHERE has({{company_ids_array}}, ifNull(company_id, 0))
        GROUP BY company_id, marketplace_id, asin
    ) AS a
    {{asin_class_join_sql}}
),

-- ─── Base rows ──────────────────────────────────────────────────────────────
-- No date window here so `date_bounds` below can find the true latest week.
raw AS (
    SELECT
        mb.company_id AS company_id,
        mb.marketplace_id AS marketplace_id,
        mb.asin AS primary_asin,
        mb.purchased_with_asin AS co_purchased_asin,
        mb.purchased_with_rank AS co_purchase_rank,
        mb.combination_pct AS combination_pct,
        mb.week_start AS week_start
    FROM etl.ba_market_basket_current AS mb
    WHERE
        has({{company_ids_array}}, mb.company_id)
        -- Scan guard: covers the widest supported window (52 weeks back).
        AND mb.week_start >= addYears(today(), -7)
        AND (
            length({{asins_array}}) = 0
            OR arrayExists(a -> lower(a) = lower(mb.asin), {{asins_array}})
        )
        AND mb.purchased_with_rank <= {{max_rank}}
        AND mb.combination_pct >= {{min_combination_pct}}
),

-- ─── Resolve marketplace, apply the marketplace filter ──────────────────────
-- Columns are projected explicitly rather than with r.*: marketplace_id exists
-- on both sides of the join, and ClickHouse's analyzer would keep the wildcard
-- output qualified as r.marketplace_id, which downstream CTEs cannot address.
with_marketplace AS (
    SELECT
        r.company_id AS company_id,
        r.marketplace_id AS marketplace_id,
        ifNull(nullIf(m.country_code, ''), r.marketplace_id) AS marketplace,
        r.primary_asin AS primary_asin,
        r.co_purchased_asin AS co_purchased_asin,
        r.co_purchase_rank AS co_purchase_rank,
        r.combination_pct AS combination_pct,
        r.week_start AS week_start
    FROM raw AS r
    LEFT JOIN etl.ba_marketplaces AS m
        ON m.marketplace_id = r.marketplace_id
    WHERE
        length({{marketplaces_array}}) = 0
        OR arrayExists(
            input -> lower(input) IN (
                lower(ifNull(m.country, '')),
                lower(ifNull(m.country_code, '')),
                lower(ifNull(m.marketplace_name, '')),
                lower(r.marketplace_id)
            ),
            {{marketplaces_array}}
        )
),

-- ─── Period window ──────────────────────────────────────────────────────────
-- max() is wrapped in toNullable so an empty base yields NULL bounds (and thus
-- no rows) rather than the Date epoch, which the period arithmetic would
-- otherwise clamp at 1970-01-01.
date_bounds AS (
    SELECT
        ifNull({{start_date_sql}}, addWeeks(max(toNullable(week_start)), -1 * ({{periods_back}} - 1))) AS start_date,
        ifNull({{end_date_sql}}, max(toNullable(week_start))) AS end_date
    FROM with_marketplace
),

windowed AS (
    SELECT *
    FROM with_marketplace
    WHERE week_start >= (SELECT start_date FROM date_bounds)
      AND week_start <= (SELECT end_date FROM date_bounds)
),

-- ─── Aggregate the pair across weeks ────────────────────────────────────────
aggregated AS (
    SELECT
        primary_asin AS primary_asin,
        co_purchased_asin AS co_purchased_asin,
        marketplace AS marketplace,
        company_id AS company_id,
        any(marketplace_id) AS marketplace_id,
        min(co_purchase_rank) AS best_rank,
        round(avg(combination_pct), 4) AS avg_combination_pct,
        round(max(combination_pct), 4) AS max_combination_pct,
        round(min(combination_pct), 4) AS min_combination_pct,
        uniqExact(week_start) AS weeks_appearing,
        min(week_start) AS first_seen,
        max(week_start) AS last_seen
    FROM windowed
    GROUP BY primary_asin, co_purchased_asin, marketplace, company_id
),

date_range AS (
    SELECT
        min(week_start) AS window_start,
        max(week_start) AS window_end,
        uniqExact(week_start) AS total_weeks
    FROM windowed
),

-- ─── Own ASINs vs competitor ASINs ──────────────────────────────────────────
-- An ASIN is "mine" if it appears as a primary_asin: Brand Analytics only
-- reports the seller's own products in that position.
my_asins AS (
    SELECT DISTINCT lower(primary_asin) AS asin_lc
    FROM aggregated
),

with_consistency AS (
    SELECT
        a.primary_asin AS primary_asin,
        a.co_purchased_asin AS co_purchased_asin,
        a.marketplace AS marketplace,
        a.company_id AS company_id,
        a.marketplace_id AS marketplace_id,
        a.best_rank AS best_rank,
        a.avg_combination_pct AS avg_combination_pct,
        a.max_combination_pct AS max_combination_pct,
        a.min_combination_pct AS min_combination_pct,
        a.weeks_appearing AS weeks_appearing,
        a.first_seen AS first_seen,
        a.last_seen AS last_seen,
        lower(a.co_purchased_asin) IN (SELECT asin_lc FROM my_asins) AS co_purchased_is_own,
        (SELECT total_weeks FROM date_range) AS total_weeks,
        (SELECT window_start FROM date_range) AS window_start,
        (SELECT window_end FROM date_range) AS window_end,
        -- How consistently the pair appears across the window.
        round(toFloat64(a.weeks_appearing) / nullIf((SELECT total_weeks FROM date_range), 0), 4) AS consistency_score
    FROM aggregated AS a
),

enriched AS (
    SELECT
        c.primary_asin AS primary_asin,
        ifNull(nullIf(pa.product_family, ''), 'unknown') AS primary_product_family,
        ifNull(nullIf(pa.brand, ''), 'unknown') AS primary_brand,
        ifNull(nullIf(pa.pareto_abc_class, ''), 'unknown') AS primary_pareto_abc_class,
        ifNull(nullIf(pa.revenue_abcd_class, ''), 'unknown') AS primary_revenue_abcd_class,
        pa.revenue_share AS primary_revenue_share,
        c.co_purchased_asin AS co_purchased_asin,
        ifNull(nullIf(ca.product_family, ''), 'unknown') AS co_purchased_product_family,
        ifNull(nullIf(ca.brand, ''), 'unknown') AS co_purchased_brand,
        ifNull(nullIf(ca.pareto_abc_class, ''), 'unknown') AS co_purchased_pareto_abc_class,
        ifNull(nullIf(ca.revenue_abcd_class, ''), 'unknown') AS co_purchased_revenue_abcd_class,
        ca.revenue_share AS co_purchased_revenue_share,
        c.marketplace AS marketplace,
        c.best_rank AS best_rank,
        c.avg_combination_pct AS avg_combination_pct,
        c.max_combination_pct AS max_combination_pct,
        c.min_combination_pct AS min_combination_pct,
        c.weeks_appearing AS weeks_appearing,
        c.total_weeks AS total_weeks,
        c.consistency_score AS consistency_score,
        c.co_purchased_is_own AS co_purchased_is_own,
        c.first_seen AS first_seen,
        c.last_seen AS last_seen,
        c.window_start AS window_start,
        c.window_end AS window_end
    FROM with_consistency AS c
    LEFT JOIN asin_attrs AS pa
        ON pa.company_id = c.company_id
       AND pa.marketplace_id = c.marketplace_id
       AND pa.asin = c.primary_asin
    LEFT JOIN asin_attrs AS ca
        ON ca.company_id = c.company_id
       AND ca.marketplace_id = c.marketplace_id
       AND ca.asin = c.co_purchased_asin
),

-- The sort key ties heavily (combination_pct saturates at 1.0), so the window
-- ordering is extended with a deterministic tiebreaker and the outer query then
-- orders by the computed rank. Ordering the outer query by the sort key instead
-- would let it break ties differently from the window, which returned rows
-- numbered 182-184 as the "top 3".
ranked AS (
    SELECT
        *,
        row_number() OVER (
            ORDER BY
                {{sort_column}} {{sort_direction}} NULLS LAST,
                primary_asin ASC,
                co_purchased_asin ASC,
                marketplace ASC
        ) AS `rank`
    FROM enriched
)

SELECT
    `rank`,
    primary_asin,
    primary_product_family,
    primary_brand,
    primary_pareto_abc_class,
    primary_revenue_abcd_class,
    primary_revenue_share,
    co_purchased_asin,
    co_purchased_product_family,
    co_purchased_brand,
    co_purchased_pareto_abc_class,
    co_purchased_revenue_abcd_class,
    co_purchased_revenue_share,
    marketplace,
    best_rank,
    avg_combination_pct,
    max_combination_pct,
    min_combination_pct,
    weeks_appearing,
    total_weeks,
    consistency_score,
    co_purchased_is_own,
    first_seen,
    last_seen,
    window_start,
    window_end,
    (SELECT max(classification_as_of) FROM asin_revenue_class) AS classification_as_of
FROM ranked
ORDER BY `rank` ASC
LIMIT {{limit_top_n}}
