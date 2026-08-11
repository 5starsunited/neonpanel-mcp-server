-- Tool query for brand_analytics_analyze_repeat_purchases (ClickHouse)
--
-- SOURCE CHANGE vs Athena. The Athena version read the raw report table
-- sp_api_iceberg.brand_analytics_repeat_purchase_report and unnested its
-- rspec_marketplaceids array. ClickHouse exposes the same contract already
-- normalised as etl.ba_repeat_purchase_current, one row per
-- company x marketplace x week x ASIN, so both the UNNEST and the
-- deduplication CTE it required disappear.
--
-- WHERE THE METRICS COME FROM. etl.ba_repeat_purchase_current promotes only
-- two Amazon fields to typed columns:
--   repeat_purchase_count == payload `orders`
--   repeat_purchase_rate  == payload `repeatcustomerspcttotal`
-- (verified equal on every row where both are present). The remaining three
-- metrics the tool contract exposes -- unique customers, repeat revenue and
-- repeat revenue % -- exist only inside raw_payload, so they are read with
-- JSONExtract*. raw_payload is populated on this table (unlike
-- etl.ba_search_terms_current, where it is empty), which is what lets the full
-- Athena output contract survive the migration unchanged.
--
-- JSONExtractFloat returns 0.0 for an absent key, which reproduces the
-- COALESCE(..., 0) the Athena version applied.

WITH
-- ─── Own-catalog attributes, pre-collapsed ──────────────────────────────────
-- Grouped before the join: ba_asin_attributes can hold more than one row per
-- (company, marketplace, asin), and a fan-out would multiply the aggregates.
asin_attrs AS (
    SELECT
        ifNull(company_id, 0) AS company_id,
        ifNull(marketplace_id, '') AS marketplace_id,
        asin AS asin,
        any(product_family) AS product_family,
        any(brand) AS brand,
        any(pareto_abc_class) AS pareto_abc_class,
        any(revenue_abcd_class) AS revenue_abcd_class,
        toFloat64(any(revenue_share)) AS revenue_share
    FROM etl.ba_asin_attributes
    WHERE has({{company_ids_array}}, ifNull(company_id, 0))
    GROUP BY company_id, marketplace_id, asin
),

-- ─── Base rows ──────────────────────────────────────────────────────────────
-- No date window here so `date_bounds` below can find the true latest week.
raw AS (
    SELECT
        rp.company_id AS company_id,
        rp.marketplace_id AS marketplace_id,
        rp.asin AS asin,
        rp.week_start AS week_start,
        toFloat64(ifNull(rp.repeat_purchase_count, 0)) AS orders,
        JSONExtractFloat(rp.raw_payload, 'uniquecustomers') AS unique_customers,
        ifNull(rp.repeat_purchase_rate, 0.0) AS repeat_customers_pct,
        JSONExtractFloat(rp.raw_payload, 'repeatpurchaserevenue_amount') AS repeat_revenue,
        nullIf(JSONExtractString(rp.raw_payload, 'repeatpurchaserevenue_currencycode'), '') AS currency,
        JSONExtractFloat(rp.raw_payload, 'repeatpurchaserevenuepcttotal') AS repeat_revenue_pct
    FROM etl.ba_repeat_purchase_current AS rp
    WHERE
        has({{company_ids_array}}, rp.company_id)
        -- Scan guard: covers the widest supported window (52 weeks back).
        AND rp.week_start >= addYears(today(), -7)
        AND (
            length({{asins_array}}) = 0
            OR arrayExists(a -> lower(a) = lower(rp.asin), {{asins_array}})
        )
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
        r.asin AS asin,
        r.week_start AS week_start,
        r.orders AS orders,
        r.unique_customers AS unique_customers,
        r.repeat_customers_pct AS repeat_customers_pct,
        r.repeat_revenue AS repeat_revenue,
        r.currency AS currency,
        r.repeat_revenue_pct AS repeat_revenue_pct
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

-- One extra prior week so the WoW lag has history even when periods_back = 1.
bounds AS (
    SELECT
        start_date AS start_date,
        end_date AS end_date,
        addWeeks(start_date, -1) AS lookback_start
    FROM date_bounds
),

windowed_expanded AS (
    SELECT *
    FROM with_marketplace
    WHERE week_start >= (SELECT lookback_start FROM bounds)
      AND week_start <= (SELECT end_date FROM bounds)
),

-- The caller's requested window, used for the totals and averages.
windowed AS (
    SELECT *
    FROM windowed_expanded
    WHERE week_start >= (SELECT start_date FROM bounds)
),

-- ─── Aggregate per ASIN x marketplace across weeks ──────────────────────────
aggregated AS (
    SELECT
        asin AS asin,
        marketplace AS marketplace,
        company_id AS company_id,
        any(marketplace_id) AS marketplace_id,
        max(currency) AS currency,

        sum(orders) AS total_orders,
        sum(unique_customers) AS total_unique_customers,
        sum(repeat_revenue) AS total_repeat_revenue,

        round(avg(orders), 2) AS avg_weekly_orders,
        round(avg(unique_customers), 2) AS avg_weekly_unique_customers,
        round(avg(repeat_customers_pct), 4) AS avg_repeat_customers_pct,
        round(avg(repeat_revenue), 2) AS avg_weekly_repeat_revenue,
        round(avg(repeat_revenue_pct), 4) AS avg_repeat_revenue_pct,

        max(repeat_customers_pct) AS max_repeat_customers_pct,
        max(repeat_revenue_pct) AS max_repeat_revenue_pct,

        uniqExact(week_start) AS weeks_with_data,
        min(week_start) AS first_seen,
        max(week_start) AS last_seen
    FROM windowed
    GROUP BY asin, marketplace, company_id
),

-- ─── Latest-week snapshot for the WoW trend ─────────────────────────────────
weekly_series AS (
    SELECT
        asin,
        marketplace,
        company_id,
        week_start,
        orders,
        unique_customers,
        repeat_customers_pct,
        repeat_revenue,
        repeat_revenue_pct,
        -- toNullable is REQUIRED. lagInFrame returns the column type's default
        -- (0.0 for Float64), not NULL, when there is no preceding row, so an
        -- unwrapped lag would report a first week as a swing from zero rather
        -- than as "no prior week".
        lagInFrame(toNullable(repeat_customers_pct), 1) OVER w AS prev_repeat_customers_pct,
        lagInFrame(toNullable(repeat_revenue_pct), 1) OVER w AS prev_repeat_revenue_pct,
        lagInFrame(toNullable(orders), 1) OVER w AS prev_orders,
        row_number() OVER (
            PARTITION BY asin, marketplace, company_id
            ORDER BY week_start DESC
        ) AS rn
    FROM windowed_expanded
    WINDOW w AS (
        PARTITION BY asin, marketplace, company_id
        ORDER BY week_start
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    )
),

latest_week_trend AS (
    SELECT
        asin,
        marketplace,
        company_id,
        orders AS latest_week_orders,
        unique_customers AS latest_week_unique_customers,
        repeat_customers_pct AS latest_week_repeat_customers_pct,
        repeat_revenue AS latest_week_repeat_revenue,
        repeat_revenue_pct AS latest_week_repeat_revenue_pct,
        round(repeat_customers_pct - ifNull(prev_repeat_customers_pct, repeat_customers_pct), 4) AS repeat_customers_pct_wow,
        round(repeat_revenue_pct - ifNull(prev_repeat_revenue_pct, repeat_revenue_pct), 4) AS repeat_revenue_pct_wow,
        round(orders - ifNull(prev_orders, orders), 2) AS orders_wow
    FROM weekly_series
    WHERE rn = 1
),

date_range AS (
    SELECT
        min(week_start) AS window_start,
        max(week_start) AS window_end,
        uniqExact(week_start) AS total_weeks
    FROM windowed
),

combined AS (
    SELECT
        a.asin AS asin,
        a.marketplace AS marketplace,
        a.company_id AS company_id,
        a.marketplace_id AS marketplace_id,
        a.currency AS currency,
        a.total_orders AS total_orders,
        a.total_unique_customers AS total_unique_customers,
        a.total_repeat_revenue AS total_repeat_revenue,
        a.avg_weekly_orders AS avg_weekly_orders,
        a.avg_weekly_unique_customers AS avg_weekly_unique_customers,
        a.avg_repeat_customers_pct AS avg_repeat_customers_pct,
        a.avg_weekly_repeat_revenue AS avg_weekly_repeat_revenue,
        a.avg_repeat_revenue_pct AS avg_repeat_revenue_pct,
        a.max_repeat_customers_pct AS max_repeat_customers_pct,
        a.max_repeat_revenue_pct AS max_repeat_revenue_pct,
        a.weeks_with_data AS weeks_with_data,
        a.first_seen AS first_seen,
        a.last_seen AS last_seen,
        (SELECT total_weeks FROM date_range) AS total_weeks,
        (SELECT window_start FROM date_range) AS window_start,
        (SELECT window_end FROM date_range) AS window_end,
        lt.latest_week_orders AS latest_week_orders,
        lt.latest_week_unique_customers AS latest_week_unique_customers,
        lt.latest_week_repeat_customers_pct AS latest_week_repeat_customers_pct,
        lt.latest_week_repeat_revenue AS latest_week_repeat_revenue,
        lt.latest_week_repeat_revenue_pct AS latest_week_repeat_revenue_pct,
        lt.repeat_customers_pct_wow AS repeat_customers_pct_wow,
        lt.repeat_revenue_pct_wow AS repeat_revenue_pct_wow,
        lt.orders_wow AS orders_wow
    FROM aggregated AS a
    LEFT JOIN latest_week_trend AS lt
        ON lt.asin = a.asin
       AND lt.marketplace = a.marketplace
       AND lt.company_id = a.company_id
    WHERE {{min_orders}} = 0 OR a.total_orders >= {{min_orders}}
),

enriched AS (
    SELECT
        c.asin AS asin,
        ifNull(nullIf(attrs.product_family, ''), 'unknown') AS product_family,
        ifNull(nullIf(attrs.brand, ''), 'unknown') AS asin_brand,
        ifNull(nullIf(attrs.pareto_abc_class, ''), 'unknown') AS pareto_abc_class,
        ifNull(nullIf(attrs.revenue_abcd_class, ''), 'unknown') AS revenue_abcd_class,
        attrs.revenue_share AS revenue_share,
        c.marketplace AS marketplace,
        c.currency AS currency,
        c.total_orders AS total_orders,
        c.total_unique_customers AS total_unique_customers,
        c.total_repeat_revenue AS total_repeat_revenue,
        c.avg_weekly_orders AS avg_weekly_orders,
        c.avg_weekly_unique_customers AS avg_weekly_unique_customers,
        c.avg_repeat_customers_pct AS avg_repeat_customers_pct,
        c.avg_weekly_repeat_revenue AS avg_weekly_repeat_revenue,
        c.avg_repeat_revenue_pct AS avg_repeat_revenue_pct,
        c.max_repeat_customers_pct AS max_repeat_customers_pct,
        c.max_repeat_revenue_pct AS max_repeat_revenue_pct,
        c.weeks_with_data AS weeks_with_data,
        c.total_weeks AS total_weeks,
        c.latest_week_orders AS latest_week_orders,
        c.latest_week_unique_customers AS latest_week_unique_customers,
        c.latest_week_repeat_customers_pct AS latest_week_repeat_customers_pct,
        c.latest_week_repeat_revenue AS latest_week_repeat_revenue,
        c.latest_week_repeat_revenue_pct AS latest_week_repeat_revenue_pct,
        c.repeat_customers_pct_wow AS repeat_customers_pct_wow,
        c.repeat_revenue_pct_wow AS repeat_revenue_pct_wow,
        c.orders_wow AS orders_wow,
        c.first_seen AS first_seen,
        c.last_seen AS last_seen,
        c.window_start AS window_start,
        c.window_end AS window_end
    FROM combined AS c
    LEFT JOIN asin_attrs AS attrs
        ON attrs.company_id = c.company_id
       AND attrs.marketplace_id = c.marketplace_id
       AND attrs.asin = c.asin
),

-- The window ordering carries a deterministic tiebreaker and the outer query
-- orders by the computed rank. Ordering the outer query by the sort key
-- independently would let it break ties differently from the window, so the
-- returned rows would not be the ones numbered 1..N.
ranked AS (
    SELECT
        *,
        row_number() OVER (
            ORDER BY
                {{sort_column}} {{sort_direction}} NULLS LAST,
                asin ASC,
                marketplace ASC
        ) AS `rank`
    FROM enriched
)

SELECT
    `rank`,
    asin,
    product_family,
    asin_brand,
    pareto_abc_class,
    revenue_abcd_class,
    revenue_share,
    marketplace,
    currency,
    total_orders,
    total_unique_customers,
    total_repeat_revenue,
    avg_weekly_orders,
    avg_weekly_unique_customers,
    avg_repeat_customers_pct,
    avg_weekly_repeat_revenue,
    avg_repeat_revenue_pct,
    max_repeat_customers_pct,
    max_repeat_revenue_pct,
    weeks_with_data,
    total_weeks,
    latest_week_orders,
    latest_week_unique_customers,
    latest_week_repeat_customers_pct,
    latest_week_repeat_revenue,
    latest_week_repeat_revenue_pct,
    repeat_customers_pct_wow,
    repeat_revenue_pct_wow,
    orders_wow,
    first_seen,
    last_seen,
    window_start,
    window_end
FROM ranked
ORDER BY `rank` ASC
LIMIT {{limit_top_n}}
