-- Tool: brand_analytics_analyze_repeat_purchases
-- Purpose: Repeat purchase behaviour per ASIN from Amazon Brand Analytics
--          Repeat Purchase Report. Shows orders, unique customers,
--          repeat customer %, repeat revenue, and repeat revenue %.
-- Source:  sp_api_iceberg.brand_analytics_repeat_purchase_report (weekly snapshots)
-- Notes:
--   • repeatcustomerspcttotal = fraction of customers who purchased the ASIN
--     more than once in the reporting period (0–1 scale)
--   • repeatpurchaserevenuepcttotal = fraction of total revenue from repeat buyers (0–1 scale)
--   • Some ASINs have NULL metrics (insufficient data from Amazon) — filtered via COALESCE

WITH params AS (
  SELECT
    {{limit_top_n}}                   AS limit_top_n,
    {{start_date_sql}}                AS start_date,
    {{end_date_sql}}                  AS end_date,
    CAST({{periods_back}} AS INTEGER) AS periods_back,

    -- REQUIRED (authorization + partition pruning)
    {{company_ids_array}}             AS company_ids,
    transform({{company_ids_array}}, x -> CAST(x AS VARCHAR)) AS company_ids_str,

    -- OPTIONAL ASIN filter (empty = all ASINs for the company)
    {{asins_array}}                   AS asins,

    -- OPTIONAL marketplace filter
    {{marketplaces_array}}            AS marketplaces,

    -- Minimum orders threshold (default 0 = no filter)
    CAST({{min_orders}} AS DOUBLE)    AS min_orders
),

-- ─── 1. Raw rows with partition pruning ────────────────────────────────────
raw AS (
  SELECT
    rp.asin,
    COALESCE(rp.orders, 0)                         AS orders,
    COALESCE(rp.uniquecustomers, 0)                 AS unique_customers,
    COALESCE(rp.repeatcustomerspcttotal, 0)         AS repeat_customers_pct,
    COALESCE(rp.repeatpurchaserevenue_amount, 0)    AS repeat_revenue,
    rp.repeatpurchaserevenue_currencycode            AS currency,
    COALESCE(rp.repeatpurchaserevenuepcttotal, 0)   AS repeat_revenue_pct,
    rp.week_start,
    rp.rspec_marketplaceids                          AS marketplace_ids,
    CAST(rp.ingest_company_id AS BIGINT)            AS company_id
  FROM "{{catalog}}"."sp_api_iceberg"."brand_analytics_repeat_purchase_report" rp
  CROSS JOIN params p
  WHERE
    -- Partition pruning: company_id
    contains(p.company_ids_str, rp.ingest_company_id)

    -- Optional ASIN filter
    AND (cardinality(p.asins) = 0 OR any_match(p.asins, a -> lower(a) = lower(rp.asin)))
),

-- ─── 2. Resolve marketplace name from ID ───────────────────────────────────
marketplaces_dim AS (
  SELECT
    CAST(amazon_marketplace_id AS VARCHAR) AS amazon_marketplace_id,
    lower(country)    AS country,
    lower(code)       AS country_code,
    lower(name)       AS marketplace_name,
    lower(domain)     AS domain,
    CAST(id AS BIGINT) AS marketplace_numeric_id
  FROM "{{catalog}}"."neonpanel_iceberg"."amazon_marketplaces"
),

with_marketplace_raw AS (
  SELECT
    r.*,
    COALESCE(upper(m.country_code), r.marketplace_ids[1]) AS marketplace,
    m.marketplace_numeric_id
  FROM raw r
  CROSS JOIN UNNEST(r.marketplace_ids) AS t(marketplace_id)
  LEFT JOIN marketplaces_dim m
    ON lower(m.amazon_marketplace_id) = lower(t.marketplace_id)
  CROSS JOIN params p
  WHERE
    -- Optional marketplace filter
    cardinality(p.marketplaces) = 0
    OR any_match(
      p.marketplaces,
      input -> lower(input) IN (
        m.country,
        m.country_code,
        m.marketplace_name,
        m.domain,
        lower(t.marketplace_id)
      )
    )
),

-- Deduplicate rows created by CROSS JOIN UNNEST when marketplace_ids has >1 element
-- mapping to the same resolved marketplace code
with_marketplace AS (
  SELECT
    asin,
    marketplace,
    company_id,
    week_start,
    MAX(marketplace_numeric_id)  AS marketplace_numeric_id,
    MAX(currency)                AS currency,
    marketplace_ids,
    SUM(orders)                  AS orders,
    SUM(unique_customers)        AS unique_customers,
    MAX(repeat_customers_pct)    AS repeat_customers_pct,
    SUM(repeat_revenue)          AS repeat_revenue,
    MAX(repeat_revenue_pct)      AS repeat_revenue_pct
  FROM with_marketplace_raw
  GROUP BY asin, marketplace, company_id, week_start, marketplace_ids
),

-- ─── 3. Determine date window ──────────────────────────────────────────────
latest AS (
  SELECT max(week_start) AS latest_week FROM with_marketplace
),

date_bounds AS (
  SELECT
    COALESCE(p.start_date, date_add('week', -1 * (p.periods_back - 1), l.latest_week)) AS start_date,
    COALESCE(p.end_date,   l.latest_week)                                               AS end_date,
    -- 1-week lookback so LAG has a prior row even when periods_back = 1
    date_add('week', -1, COALESCE(p.start_date, date_add('week', -1 * (p.periods_back - 1), l.latest_week))) AS lookback_start
  FROM params p
  CROSS JOIN latest l
),

-- Expanded window includes 1 extra prior week for LAG
windowed_expanded AS (
  SELECT w.*
  FROM with_marketplace w
  CROSS JOIN date_bounds d
  WHERE w.week_start BETWEEN d.lookback_start AND d.end_date
),

-- User's requested window (no lookback) — used for aggregated totals/averages
windowed AS (
  SELECT w.*
  FROM with_marketplace w
  CROSS JOIN date_bounds d
  WHERE w.week_start BETWEEN d.start_date AND d.end_date
),

-- ─── 4. Aggregate per ASIN × marketplace across weeks ─────────────────────
aggregated AS (
  SELECT
    w.asin,
    w.marketplace,
    w.company_id,
    MAX(w.marketplace_numeric_id) AS marketplace_numeric_id,
    MAX(w.currency)                                   AS currency,

    -- Totals
    SUM(w.orders)                                     AS total_orders,
    SUM(w.unique_customers)                           AS total_unique_customers,
    SUM(w.repeat_revenue)                             AS total_repeat_revenue,

    -- Averages (weekly)
    ROUND(AVG(w.orders), 2)                           AS avg_weekly_orders,
    ROUND(AVG(w.unique_customers), 2)                 AS avg_weekly_unique_customers,
    ROUND(AVG(w.repeat_customers_pct), 4)             AS avg_repeat_customers_pct,
    ROUND(AVG(w.repeat_revenue), 2)                   AS avg_weekly_repeat_revenue,
    ROUND(AVG(w.repeat_revenue_pct), 4)               AS avg_repeat_revenue_pct,

    -- Peaks
    MAX(w.repeat_customers_pct)                       AS max_repeat_customers_pct,
    MAX(w.repeat_revenue_pct)                         AS max_repeat_revenue_pct,

    -- Time span
    COUNT(DISTINCT w.week_start)                      AS weeks_with_data,
    MIN(w.week_start)                                 AS first_seen,
    MAX(w.week_start)                                 AS last_seen
  FROM windowed w
  GROUP BY w.asin, w.marketplace, w.company_id
),

-- ─── 5. Latest-week snapshot for WoW trend ─────────────────────────────────
-- Uses windowed_expanded (includes 1 extra prior week) so LAG has history.
-- Partition includes company_id to prevent cross-tenant mixing.
weekly_series AS (
  SELECT
    w.asin,
    w.marketplace,
    w.company_id,
    w.week_start,
    w.orders,
    w.unique_customers,
    w.repeat_customers_pct,
    w.repeat_revenue,
    w.repeat_revenue_pct,
    LAG(w.repeat_customers_pct) OVER (
      PARTITION BY w.asin, w.marketplace, w.company_id ORDER BY w.week_start
    ) AS prev_repeat_customers_pct,
    LAG(w.repeat_revenue_pct) OVER (
      PARTITION BY w.asin, w.marketplace, w.company_id ORDER BY w.week_start
    ) AS prev_repeat_revenue_pct,
    LAG(w.orders) OVER (
      PARTITION BY w.asin, w.marketplace, w.company_id ORDER BY w.week_start
    ) AS prev_orders,
    ROW_NUMBER() OVER (
      PARTITION BY w.asin, w.marketplace, w.company_id ORDER BY w.week_start DESC
    ) AS rn
  FROM windowed_expanded w
),

latest_week_trend AS (
  SELECT
    ws.asin,
    ws.marketplace,
    ws.company_id,
    ws.orders                          AS latest_week_orders,
    ws.unique_customers                AS latest_week_unique_customers,
    ws.repeat_customers_pct            AS latest_week_repeat_customers_pct,
    ws.repeat_revenue                  AS latest_week_repeat_revenue,
    ws.repeat_revenue_pct              AS latest_week_repeat_revenue_pct,
    ROUND(ws.repeat_customers_pct - COALESCE(ws.prev_repeat_customers_pct, ws.repeat_customers_pct), 4)
      AS repeat_customers_pct_wow,
    ROUND(ws.repeat_revenue_pct - COALESCE(ws.prev_repeat_revenue_pct, ws.repeat_revenue_pct), 4)
      AS repeat_revenue_pct_wow,
    ROUND(ws.orders - COALESCE(ws.prev_orders, ws.orders), 2)
      AS orders_wow
  FROM weekly_series ws
  WHERE ws.rn = 1
),

-- ─── 6. Date range context ─────────────────────────────────────────────────
date_range AS (
  SELECT
    MIN(week_start) AS window_start,
    MAX(week_start) AS window_end,
    COUNT(DISTINCT week_start) AS total_weeks
  FROM windowed
),

-- ─── 7. Final join ─────────────────────────────────────────────────────────
combined AS (
  SELECT
    a.*,
    dr.total_weeks,
    dr.window_start,
    dr.window_end,
    lt.latest_week_orders,
    lt.latest_week_unique_customers,
    lt.latest_week_repeat_customers_pct,
    lt.latest_week_repeat_revenue,
    lt.latest_week_repeat_revenue_pct,
    lt.repeat_customers_pct_wow,
    lt.repeat_revenue_pct_wow,
    lt.orders_wow
  FROM aggregated a
  CROSS JOIN date_range dr
  LEFT JOIN latest_week_trend lt
    ON  lt.asin        = a.asin
    AND lt.marketplace = a.marketplace
    AND lt.company_id  = a.company_id
  CROSS JOIN params p
  WHERE
    -- Optional min orders filter
    (p.min_orders = 0 OR a.total_orders >= p.min_orders)
)

SELECT
  ROW_NUMBER() OVER (ORDER BY {{sort_column}} {{sort_direction}} NULLS LAST) AS rank,
  c.asin,
  COALESCE(aa.product_family, 'unknown')     AS product_family,
  COALESCE(aa.brand, 'unknown')              AS asin_brand,
  COALESCE(aa.pareto_abc_class, 'unknown')   AS pareto_abc_class,
  COALESCE(aa.revenue_abcd_class, 'unknown') AS revenue_abcd_class,
  aa.revenue_share,
  c.marketplace,
  c.currency,
  c.total_orders,
  c.total_unique_customers,
  c.total_repeat_revenue,
  c.avg_weekly_orders,
  c.avg_weekly_unique_customers,
  c.avg_repeat_customers_pct,
  c.avg_weekly_repeat_revenue,
  c.avg_repeat_revenue_pct,
  c.max_repeat_customers_pct,
  c.max_repeat_revenue_pct,
  c.weeks_with_data,
  c.total_weeks,
  c.latest_week_orders,
  c.latest_week_unique_customers,
  c.latest_week_repeat_customers_pct,
  c.latest_week_repeat_revenue,
  c.latest_week_repeat_revenue_pct,
  c.repeat_customers_pct_wow,
  c.repeat_revenue_pct_wow,
  c.orders_wow,
  CAST(c.first_seen     AS DATE) AS first_seen,
  CAST(c.last_seen      AS DATE) AS last_seen,
  CAST(c.window_start   AS DATE) AS window_start,
  CAST(c.window_end     AS DATE) AS window_end
FROM combined c
LEFT JOIN "{{catalog}}"."brand_analytics_iceberg"."asin_attributes" aa
  ON aa.asin = c.asin
  AND aa.company_id = c.company_id
  AND aa.marketplace_id = c.marketplace_numeric_id
ORDER BY {{sort_column}} {{sort_direction}} NULLS LAST
LIMIT {{limit_top_n}};
