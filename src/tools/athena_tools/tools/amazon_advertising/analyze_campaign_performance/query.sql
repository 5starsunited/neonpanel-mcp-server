-- Tool: advertising_analyze_campaign_performance  (ClickHouse)
-- ClickHouse rewrite of the (now retired) Athena twin. Same input contract, same
-- output columns / KPI model. Only the data source + dialect change.
--
-- BASE:  analytics.amazon_ads_unified AS a  — the MERGED ads feed. It carries the
--   amazon_ads_v1 61-col canonical schema PLUS a leading `source` column
--   ('ads_v1' | 'ms'). Within source='ads_v1' the table stores MANY report-type
--   slices that re-slice the SAME spend/sales, so summing all of them double-counts.
--   We keep ONLY the non-overlapping SKU-level slices; source='ms' rows are a single
--   additive grain and are all kept. The two sources never overlap a (company,
--   marketplace, date), so the union is additive:
--     WHERE (a.source='ads_v1' AND a.dataset IN
--              ('sp_advertised_product','sd_advertised_product','sb_ads'))
--        OR a.source='ms'
--   (Mirrors data-ingestion CH-01 RLS Amazon Ads, the validated production query.)
--
-- ENRICHMENT (LEFT JOIN, join_use_nulls=1 so misses -> NULL):
--   Marketplace / country / code  <- raw.neonpanel_amazon_marketplaces  (FINAL, not deleted)
--   FX rate (local -> USD)        <- raw.neonpanel_currency_rates       (FINAL, not deleted)
--   Brand / Product Family        <- etl.sku_dimensions  (join on sku_key = a.ads_sku_key)
--
-- ads_v1 and ms use different `dataset` vocabularies for the SP/SB/SD family, so we
-- normalise to a stable `ad_type` ('sponsored_products' | 'sponsored_display' |
-- 'sponsored_brands') for both the campaign_types filter and the `dataset` output.
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
    toInt64({{periods_back}})         AS periods_back
),

-- ─── Marketplace dimension ──────────────────────────────────────────────────
mp AS (
  SELECT
    amazon_marketplace_id,
    name           AS marketplace_name,
    lower(country) AS country,
    lower(code)    AS country_code
  FROM raw.neonpanel_amazon_marketplaces FINAL
  WHERE _peerdb_is_deleted = 0 AND amazon_marketplace_id IS NOT NULL
),

-- ─── Currency rates (local -> USD; USD has no row -> COALESCE to 1.0) ────────
cr AS (
  SELECT currency, date, rate
  FROM raw.neonpanel_currency_rates FINAL
  WHERE _peerdb_is_deleted = 0
),

-- ─── SKU catalog: one row per sku_key (prefer verified/newest inventory) ─────
sku_dim AS (
  SELECT sku_key, brand, product_family
  FROM etl.sku_dimensions
  WHERE sku_key IS NOT NULL
  ORDER BY verified DESC, inventory_id DESC
  LIMIT 1 BY sku_key
),

-- ─── Enrich + broad date prefilter + optional filters ───────────────────────
enriched AS (
  SELECT
    a.transaction_date                                      AS report_date,
    multiIf(
      a.dataset IN ('sp_advertised_product', 'sponsored_products'), 'sponsored_products',
      a.dataset IN ('sd_advertised_product', 'sponsored_display'),  'sponsored_display',
      a.dataset IN ('sb_ads', 'sponsored_brands'),                  'sponsored_brands',
      toString(a.dataset)
    )                                                       AS ad_type,
    a.campaign_name                                         AS campaign_name,
    a.campaign_id                                           AS campaign_id,
    a.ad_group_name                                         AS ad_group_name,
    a.ad_group_id                                           AS ad_group_id,
    coalesce(a.keyword, a.targeting)                        AS target_keyword,
    coalesce(a.keyword_id, a.targeting_id)                  AS target_keyword_id,
    a.placement_classification                              AS placement,
    a.match_type                                            AS match_type,
    toString(a.campaign_budget_currency)                    AS currency,
    a.company_id                                            AS company_id,

    -- Advertised / purchased ASINs
    a.promoted_asin                                         AS advertised_asin,
    a.promoted_sku                                          AS advertised_sku,
    a.purchased_asin                                        AS purchased_asin,

    -- Core metrics (original currency)
    toInt64(a.impressions)                                  AS impressions,
    toInt64(a.clicks)                                       AS clicks,
    toFloat64(a.cost)                                       AS cost,
    toFloat64(a.attributed_sales)                           AS attributed_sales,
    toFloat64(a.conversions)                                AS conversions,
    toFloat64(a.attributed_units_ordered)                   AS attributed_units_ordered,

    -- USD-normalised amounts (multiply by rate; USD has no rate row -> 1.0)
    toFloat64(a.cost)             * coalesce(toFloat64(cr.rate), 1.0) AS cost_usd,
    toFloat64(a.attributed_sales) * coalesce(toFloat64(cr.rate), 1.0) AS attributed_sales_usd,

    -- SKU dimension columns (fallback to 'undefined' when no match).
    coalesce(sku_dim.product_family, 'undefined')           AS product_family,
    coalesce(sku_dim.brand, 'undefined')                    AS asin_brand,

    -- Marketplace for output
    mp.marketplace_name                                     AS marketplace_name,
    mp.country_code                                         AS marketplace_country_code,
    mp.country                                              AS marketplace_country

  FROM analytics.amazon_ads_unified AS a
  LEFT JOIN mp      ON mp.amazon_marketplace_id = a.marketplace_id
  LEFT JOIN cr      ON cr.currency = toString(a.campaign_budget_currency)
                   AND cr.date = a.transaction_date
  LEFT JOIN sku_dim ON sku_dim.sku_key = a.ads_sku_key
  CROSS JOIN params p

  WHERE
    -- Double-count guard: keep the non-overlapping ads_v1 SKU slices + all ms rows.
    (
      (a.source = 'ads_v1' AND a.dataset IN ('sp_advertised_product', 'sd_advertised_product', 'sb_ads'))
      OR a.source = 'ms'
    )

    -- Authorization: company_id filter
    AND has(p.company_ids, a.company_id)

    -- Broad date prefilter on the business date (transaction_date). The precise
    -- window is applied later once the latest available date is known.
    AND a.transaction_date >= coalesce(p.start_date, subtractWeeks(today(), p.periods_back + 2))
    AND a.transaction_date <= coalesce(p.end_date, today())

    -- Optional campaign type filter (SP / SB / SD via normalised ad_type)
    AND (
      length(p.campaign_types) = 0
      OR arrayExists(ct -> lower(ct) = multiIf(
           a.dataset IN ('sp_advertised_product', 'sponsored_products'), 'sponsored_products',
           a.dataset IN ('sd_advertised_product', 'sponsored_display'),  'sponsored_display',
           a.dataset IN ('sb_ads', 'sponsored_brands'),                  'sponsored_brands',
           toString(a.dataset)), p.campaign_types)
    )

    -- Optional marketplace filter (country / country code / marketplace name)
    AND (
      length(p.marketplaces) = 0
      OR arrayExists(m -> lower(m) IN (mp.country, mp.country_code, lower(mp.marketplace_name)), p.marketplaces)
    )

    -- Optional campaign name filter (exact)
    AND (
      length(p.campaign_names) = 0
      OR arrayExists(c -> lower(c) = lower(a.campaign_name), p.campaign_names)
    )

    -- Optional ad group name filter (exact)
    AND (
      length(p.ad_group_names) = 0
      OR arrayExists(ag -> lower(ag) = lower(a.ad_group_name), p.ad_group_names)
    )

    -- Optional target keyword filter (with match_type logic)
    AND (
      length(p.target_keywords) = 0
      OR multiIf(
           p.keyword_match_type = 'exact',
             arrayExists(t -> lower(t) = lower(coalesce(a.keyword, a.targeting)), p.target_keywords),
           p.keyword_match_type = 'starts_with',
             arrayExists(t -> lower(coalesce(a.keyword, a.targeting)) LIKE concat(lower(t), '%'), p.target_keywords),
           -- 'contains'
             arrayExists(t -> lower(coalesce(a.keyword, a.targeting)) LIKE concat('%', lower(t), '%'), p.target_keywords)
         )
    )

    -- Optional placement filter
    AND (
      length(p.placements) = 0
      OR arrayExists(pl -> lower(pl) = lower(a.placement_classification), p.placements)
    )

    -- Optional match type filter
    AND (
      length(p.match_types) = 0
      OR arrayExists(mt -> lower(mt) = lower(a.match_type), p.match_types)
    )

    -- ASIN dimension filters (purchased/advertised ASIN, product family, brand)
    AND (length(p.asins) = 0 OR arrayExists(x -> lower(x) = lower(coalesce(a.purchased_asin, a.promoted_asin)), p.asins))
    AND (length(p.product_families) = 0 OR arrayExists(pf -> lower(pf) = lower(sku_dim.product_family), p.product_families))
    AND (length(p.brands) = 0 OR arrayExists(b -> lower(b) = lower(sku_dim.brand), p.brands))
),

-- ─── Determine date window from the latest available date ───────────────────
latest AS (
  SELECT max(report_date) AS latest_date FROM enriched
),

date_bounds AS (
  SELECT
    coalesce(p.start_date, subtractWeeks(l.latest_date, p.periods_back - 1)) AS start_date,
    coalesce(p.end_date, l.latest_date)                                      AS end_date
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
    uniqExact(w.report_date)           AS days_active,
    uniqExact(w.advertised_asin)       AS asin_count,

  FROM windowed w
  GROUP BY
    time_period,
    campaign_name,
    ad_group_name,
    placement,
    match_type,
    dataset,
    target_keyword,
    advertised_asin,
    product_family,
    brand,
    company_id,
    marketplace,
    marketplace_country_code,
    currency
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
    if(a.impressions > 0, round(100.0 * a.clicks / a.impressions, 2), NULL)       AS ctr_pct,
    if(a.clicks > 0, round(100.0 * a.conversions / a.clicks, 2), NULL)            AS cvr_pct,
    if(a.attributed_sales_usd > 0, round(100.0 * a.cost_usd / a.attributed_sales_usd, 2), NULL) AS acos_pct,
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
SETTINGS join_use_nulls = 1
