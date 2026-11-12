-- Tool: advertising_analyze_campaign_performance  (Athena)
-- Source: amazon_ads.ads_dataset -- the all-company Ads serving table (Iceberg, partitioned by
-- day(time_window_start)) refreshed daily by clickhouse_etl/etl/ads_athena. It replaces the
-- retired ClickHouse unified Ads feed (deleted 2026-10-08).
--
-- ads_dataset is already the merged, de-duplicated BI contract (non-overlapping ads_v1 SKU slices
-- plus Marketing Stream rows) and is pre-enriched with marketplace, brand and product family, so
-- no dimension joins are needed. It also carries `placed_orders` rows (organic order totals, zero
-- ad metrics) that must NOT be counted as ad spend -- they are excluded by the dataset filter.
-- Multi-tenant table: every query is scoped to the authorised company_id (and prunes day partitions
-- through time_window_start).
-- Money: `cost` / `attributed_sales` are in the campaign currency; `currency_rate` is that day's
-- native -> USD rate (NULL for USD), so USD = amount * COALESCE(currency_rate, 1.0).
-- History: rows exist only from the first ads_athena run onward (plus the frozen ads_v1 slices);
-- older periods may be empty for some companies.
WITH params AS (
  SELECT
    {{company_ids_array}}             AS company_ids,
    {{campaign_types_array}}          AS campaign_types,
    {{marketplaces_array}}            AS marketplaces,
    {{campaign_names_array}}          AS campaign_names,
    {{ad_group_names_array}}          AS ad_group_names,
    {{target_keywords_array}}         AS target_keywords,
    {{keyword_match_type_sql}}        AS keyword_match_type,
    {{placements_array}}              AS placements,
    {{match_types_array}}             AS match_types,
    {{asins_array}}                   AS asins,
    {{product_families_array}}        AS product_families,
    {{brands_array}}                  AS brands,
    {{start_date_sql}}                AS start_date,
    {{end_date_sql}}                  AS end_date,
    CAST({{periods_back}} AS INTEGER) AS periods_back
),

-- ─── Normalise + broad date prefilter + optional filters ────────────────────
enriched AS (
  SELECT
    CAST(a.time_window_start AS DATE)                       AS report_date,
    CASE
      WHEN a.dataset IN ('sp_advertised_product', 'sponsored_products') THEN 'sponsored_products'
      WHEN a.dataset IN ('sd_advertised_product', 'sponsored_display')  THEN 'sponsored_display'
      WHEN a.dataset IN ('sb_ads', 'sponsored_brands')                  THEN 'sponsored_brands'
      ELSE a.dataset
    END                                                     AS ad_type,
    a.campaign_name                                         AS campaign_name,
    a.campaign_id                                           AS campaign_id,
    a.ad_group_name                                         AS ad_group_name,
    a.target_keyword                                        AS target_keyword,
    a.placement                                             AS placement,
    a.match_type                                            AS match_type,
    a.currency                                              AS currency,
    a.company_id                                            AS company_id,
    a.advertised_asin                                       AS advertised_asin,
    a.purchased_asin                                        AS purchased_asin,

    -- Core metrics (original currency)
    CAST(a.impressions AS BIGINT)                           AS impressions,
    CAST(a.clicks AS BIGINT)                                AS clicks,
    CAST(a.cost AS DOUBLE)                                  AS cost,
    CAST(a.attributed_sales AS DOUBLE)                      AS attributed_sales,
    CAST(a.conversions AS DOUBLE)                           AS conversions,
    CAST(a.attributed_units_ordered AS DOUBLE)              AS attributed_units_ordered,

    -- USD-normalised amounts (USD has no rate row -> 1.0)
    CAST(a.cost AS DOUBLE)             * COALESCE(a.currency_rate, 1.0) AS cost_usd,
    CAST(a.attributed_sales AS DOUBLE) * COALESCE(a.currency_rate, 1.0) AS attributed_sales_usd,

    -- Dimension columns (fallback to 'undefined' when the SKU has no match)
    COALESCE(a.product_family, 'undefined')                 AS product_family,
    COALESCE(a.brand, 'undefined')                          AS asin_brand,

    -- Marketplace for output
    a.marketplace                                           AS marketplace_name,
    lower(a.marketplace_country_code)                       AS marketplace_country_code,
    lower(a.marketplace_country)                            AS marketplace_country

  FROM "{{catalog}}"."amazon_ads"."ads_dataset" AS a
  CROSS JOIN params p

  WHERE
    -- Ad rows only: the table also holds `placed_orders` (organic) rows.
    a.dataset IN ('sponsored_products', 'sponsored_display', 'sponsored_brands',
                  'sp_advertised_product', 'sd_advertised_product', 'sb_ads')

    -- Authorization: company_id filter
    AND contains(p.company_ids, a.company_id)

    -- Broad date prefilter (partition pruning). The precise window is applied once the
    -- latest available date is known.
    AND a.time_window_start >= CAST(COALESCE(p.start_date, date_add('week', -(p.periods_back + 2), current_date)) AS TIMESTAMP)
    AND a.time_window_start <  CAST(date_add('day', 1, COALESCE(p.end_date, current_date)) AS TIMESTAMP)

    -- Optional campaign type filter (SP / SB / SD via normalised ad_type)
    AND (
      cardinality(p.campaign_types) = 0
      OR any_match(p.campaign_types, ct -> lower(ct) = CASE
           WHEN a.dataset IN ('sp_advertised_product', 'sponsored_products') THEN 'sponsored_products'
           WHEN a.dataset IN ('sd_advertised_product', 'sponsored_display')  THEN 'sponsored_display'
           WHEN a.dataset IN ('sb_ads', 'sponsored_brands')                  THEN 'sponsored_brands'
           ELSE a.dataset END)
    )

    -- Optional marketplace filter (country / country code / marketplace name)
    AND (
      cardinality(p.marketplaces) = 0
      OR any_match(p.marketplaces, m -> lower(m) IN (lower(a.marketplace_country), lower(a.marketplace_country_code), lower(a.marketplace)))
    )

    -- Optional campaign name filter (exact)
    AND (
      cardinality(p.campaign_names) = 0
      OR any_match(p.campaign_names, c -> lower(c) = lower(a.campaign_name))
    )

    -- Optional ad group name filter (exact)
    AND (
      cardinality(p.ad_group_names) = 0
      OR any_match(p.ad_group_names, ag -> lower(ag) = lower(a.ad_group_name))
    )

    -- Optional target keyword filter (with match_type logic)
    AND (
      cardinality(p.target_keywords) = 0
      OR CASE p.keyword_match_type
           WHEN 'exact' THEN
             any_match(p.target_keywords, t -> lower(t) = lower(a.target_keyword))
           WHEN 'starts_with' THEN
             any_match(p.target_keywords, t -> lower(a.target_keyword) LIKE lower(t) || '%')
           ELSE -- 'contains'
             any_match(p.target_keywords, t -> lower(a.target_keyword) LIKE '%' || lower(t) || '%')
         END
    )

    -- Optional placement filter
    AND (
      cardinality(p.placements) = 0
      OR any_match(p.placements, pl -> lower(pl) = lower(a.placement))
    )

    -- Optional match type filter
    AND (
      cardinality(p.match_types) = 0
      OR any_match(p.match_types, mt -> lower(mt) = lower(a.match_type))
    )

    -- ASIN dimension filters (purchased/advertised ASIN, product family, brand)
    AND (cardinality(p.asins) = 0 OR any_match(p.asins, x -> lower(x) = lower(COALESCE(a.purchased_asin, a.advertised_asin))))
    AND (cardinality(p.product_families) = 0 OR any_match(p.product_families, pf -> lower(pf) = lower(a.product_family)))
    AND (cardinality(p.brands) = 0 OR any_match(p.brands, b -> lower(b) = lower(a.brand)))
),

-- ─── Determine date window from the latest available date ───────────────────
latest AS (
  SELECT max(report_date) AS latest_date FROM enriched
),

date_bounds AS (
  SELECT
    COALESCE(p.start_date, date_add('week', -(p.periods_back - 1), l.latest_date)) AS start_date,
    COALESCE(p.end_date, l.latest_date)                                      AS end_date
  FROM params p
  CROSS JOIN latest l
),

windowed AS (
  SELECT e.*
  FROM enriched e
  CROSS JOIN date_bounds d
  WHERE e.report_date BETWEEN d.start_date AND d.end_date
),

-- ─── Aggregate by dynamic group-by ──────────────────────────────────────────
aggregated AS (
  SELECT
    -- Periodicity key (derived from the business date). {{period_expr}} is
    -- CAST(NULL AS Nullable(String)) for periodicity='total'.
    {{period_expr}}                                                              AS time_period,

    -- Conditional group-by keys (NULL when not grouped)
    if({{group_by_campaign_name}} = 1, w.campaign_name, NULL)                    AS campaign_name,
    if({{group_by_ad_group_name}} = 1, w.ad_group_name, NULL)                    AS ad_group_name,
    if({{group_by_placement}} = 1, w.placement, NULL)                            AS placement,
    if({{group_by_match_type}} = 1, w.match_type, NULL)                          AS match_type,
    if({{group_by_dataset}} = 1, w.ad_type, NULL)                                AS dataset,
    if({{group_by_target_keyword}} = 1, w.target_keyword, NULL)                  AS target_keyword,
    if({{group_by_advertised_asin}} = 1, w.advertised_asin, NULL)                AS advertised_asin,
    if({{group_by_product_family}} = 1, w.product_family, NULL)                  AS product_family,
    if({{group_by_brand}} = 1, w.asin_brand, NULL)                               AS brand,
    if({{group_by_company}} = 1, w.company_id, NULL)                             AS company_id,
    if({{group_by_marketplace}} = 1, w.marketplace_name, NULL)                   AS marketplace,
    if({{group_by_marketplace}} = 1, w.marketplace_country_code, NULL)           AS marketplace_country_code,
    if({{group_by_marketplace}} = 1, w.currency, NULL)                           AS currency,

    -- Metrics (USD-normalised for cross-marketplace correctness)
    sum(w.impressions)                 AS impressions,
    sum(w.clicks)                      AS clicks,
    sum(w.cost_usd)                    AS cost_usd,
    sum(w.attributed_sales_usd)        AS attributed_sales_usd,
    sum(w.conversions)                 AS conversions,
    sum(w.attributed_units_ordered)    AS attributed_units_ordered,

    -- Context
    COUNT(DISTINCT w.report_date)      AS days_active,
    COUNT(DISTINCT w.advertised_asin)  AS asin_count

  FROM windowed w
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14
),

-- ─── Final output with computed KPIs ────────────────────────────────────────
with_kpis AS (
  SELECT
    a.time_period,
    a.campaign_name,
    a.ad_group_name,
    a.placement,
    a.match_type,
    a.dataset,
    a.target_keyword,
    a.advertised_asin,
    a.product_family,
    a.brand,
    a.company_id,
    a.marketplace,
    a.marketplace_country_code,
    a.currency,

    a.impressions,
    a.clicks,
    round(a.cost_usd, 2)                                                          AS cost_usd,
    round(a.attributed_sales_usd, 2)                                              AS attributed_sales_usd,
    a.conversions,
    a.attributed_units_ordered,

    -- Efficiency KPIs (all in USD)
    if(a.clicks > 0, round(a.cost_usd / a.clicks, 2), NULL)                       AS cpc_usd,
    if(a.impressions > 0, ROUND(100.0 * a.clicks / a.impressions, 2), NULL)       AS ctr_pct,
    if(a.clicks > 0, ROUND(100.0 * a.conversions / a.clicks, 2), NULL)            AS cvr_pct,
    if(a.attributed_sales_usd > 0, ROUND(100.0 * a.cost_usd / a.attributed_sales_usd, 2), NULL) AS acos_pct,
    if(a.cost_usd > 0, round(a.attributed_sales_usd / a.cost_usd, 2), NULL)       AS roas,

    -- Context
    a.days_active,
    a.asin_count

  FROM aggregated a
)

-- ─── Ranked output ──────────────────────────────────────────────────────────
SELECT
  row_number() OVER (ORDER BY {{sort_column}} {{sort_direction}} NULLS LAST) AS rank,
  k.*
FROM with_kpis k
ORDER BY {{sort_column}} {{sort_direction}} NULLS LAST
LIMIT {{limit_top_n}}
