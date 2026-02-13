-- Tool: advertising_analyze_campaign_performance
-- Purpose: Analyse Amazon Advertising Marketing Stream data (SP / SB / SD)
--          enriched with ASIN attributes from brand_analytics_iceberg.asin_attributes.
-- Join chain:
--   marketing_stream_snapshot  MS
--     → amazon_marketplaces    M   ON M.amazon_marketplace_id = MS.marketplace_id
--     → asin_attributes        AA  ON AA.asin = COALESCE(MS."purchased asin", MS."advertised asin")
--                                  AND AA.company_id = MS.company_id
--                                  AND AA.marketplace_id = M.id

WITH params AS (
  SELECT
    {{limit_top_n}}                   AS limit_top_n,
    {{start_date_sql}}                AS start_date,
    {{end_date_sql}}                  AS end_date,
    CAST({{periods_back}} AS INTEGER) AS periods_back,

    -- Authorization
    {{company_ids_array}}             AS company_ids,

    -- Optional filters
    {{campaign_types_array}}          AS campaign_types,
    {{marketplaces_array}}            AS marketplaces,
    {{campaign_names_array}}          AS campaign_names,
    {{ad_group_names_array}}          AS ad_group_names,
    {{target_keywords_array}}         AS target_keywords,
    {{keyword_match_type_sql}}        AS keyword_match_type,
    {{placements_array}}              AS placements,
    {{match_types_array}}             AS match_types,

    -- ASIN dimension filters
    {{asins_array}}                   AS asins,
    {{product_families_array}}        AS product_families,
    {{brands_array}}                  AS brands,
    {{pareto_classes_array}}          AS pareto_classes,
    {{revenue_classes_array}}         AS revenue_classes,

    -- Periodicity: 'day', 'month', 'year', 'total'
    {{periodicity_sql}}               AS periodicity,

    -- Group-by flags (1 = enabled, 0 = disabled)
    CAST({{group_by_campaign_name}} AS INTEGER)   AS group_by_campaign_name,
    CAST({{group_by_ad_group_name}} AS INTEGER)   AS group_by_ad_group_name,
    CAST({{group_by_placement}} AS INTEGER)       AS group_by_placement,
    CAST({{group_by_match_type}} AS INTEGER)      AS group_by_match_type,
    CAST({{group_by_dataset}} AS INTEGER)         AS group_by_dataset,
    CAST({{group_by_target_keyword}} AS INTEGER)  AS group_by_target_keyword,
    CAST({{group_by_advertised_asin}} AS INTEGER) AS group_by_advertised_asin,
    CAST({{group_by_product_family}} AS INTEGER)  AS group_by_product_family,
    CAST({{group_by_brand}} AS INTEGER)           AS group_by_brand,
    CAST({{group_by_pareto_class}} AS INTEGER)    AS group_by_pareto_class,
    CAST({{group_by_revenue_class}} AS INTEGER)   AS group_by_revenue_class,
    CAST({{group_by_company}} AS INTEGER)          AS group_by_company,
    CAST({{group_by_marketplace}} AS INTEGER)      AS group_by_marketplace
),

-- ─── Marketplace dimension ──────────────────────────────────────────────────
marketplaces_dim AS (
  SELECT
    id,
    CAST(amazon_marketplace_id AS VARCHAR) AS amazon_marketplace_id,
    name AS marketplace_name,
    lower(country) AS country,
    lower(code) AS country_code
  FROM "{{catalog}}"."neonpanel_iceberg"."amazon_marketplaces"
),

-- ─── Currency rates (USD is base; no row for USD → COALESCE to 1.0) ─────────
currency_rates AS (
  SELECT currency, date, rate
  FROM "{{catalog}}"."neonpanel_iceberg"."currency_rate"
),

-- ─── Enrich with marketplace + ASIN attributes ─────────────────────────────
enriched AS (
  SELECT
    ms.time_window_start                         AS report_date,
    ms.dataset                                   AS dataset,
    ms."campaign name"                           AS campaign_name,
    ms.campaign_id,
    ms."ad group name"                           AS ad_group_name,
    ms.adgroup_id,
    ms."target keyword"                          AS target_keyword,
    ms.target_keyword_id,
    ms.placement,
    ms."match type"                              AS match_type,
    ms.currency,
    ms.company_id,

    -- Advertised / purchased ASINs
    ms."advertised asin"                         AS advertised_asin,
    ms."advertised sku"                          AS advertised_sku,
    ms."purchased asin"                          AS purchased_asin,

    -- Core metrics (original currency)
    ms.impressions,
    ms.clicks,
    ms.cost,
    ms."attributed sales"                        AS attributed_sales,
    ms.conversions,
    ms."attributed units ordered"                AS attributed_units_ordered,

    -- USD-normalised amounts (USD base: divide by rate; USD has no rate → 1.0)
    ms.cost / COALESCE(cr.rate, 1.0)             AS cost_usd,
    ms."attributed sales" / COALESCE(cr.rate, 1.0) AS attributed_sales_usd,

    -- ASIN dimension columns (fallback to 'undefined' when no match)
    COALESCE(ms."purchased asin", ms."advertised asin", 'undefined') AS enrichment_asin,
    COALESCE(aa.product_family, 'undefined')     AS product_family,
    COALESCE(aa.brand, 'undefined')              AS asin_brand,
    COALESCE(aa.pareto_abc_class, 'undefined')   AS pareto_abc_class,
    COALESCE(aa.revenue_abcd_class, 'undefined') AS revenue_abcd_class,
    aa.revenue_share,

    -- Marketplace for output
    m.marketplace_name                            AS marketplace_name,
    m.country_code                               AS marketplace_country_code,
    m.country                                    AS marketplace_country

  FROM "{{catalog}}"."brand_analytics_iceberg"."marketing_stream_snapshot" ms

  -- MS → Marketplace
  INNER JOIN marketplaces_dim m
    ON m.amazon_marketplace_id = ms.marketplace_id

  -- MS → Currency rate for USD conversion
  LEFT JOIN currency_rates cr
    ON lower(cr.currency) = lower(ms.currency)
    AND cr.date = CAST(ms.time_window_start AS DATE)

  -- MS → ASIN attributes (via purchased or advertised ASIN)
  LEFT JOIN "{{catalog}}"."brand_analytics_iceberg"."asin_attributes" aa
    ON aa.asin = COALESCE(ms."purchased asin", ms."advertised asin")
    AND aa.company_id = ms.company_id
    AND aa.marketplace_id = m.id

  CROSS JOIN params p

  WHERE
    -- Authorization: company_id filter
    contains(p.company_ids, ms.company_id)

    -- Partition pruning: ad_date is the partition key.
    -- Corrections arrive up to 14 days after time_window_start,
    -- so we scan partitions from start_date to end_date + 14 days.
    AND ms.ad_date >= COALESCE(p.start_date,
                               date_add('week', -1 * (p.periods_back + 2), CURRENT_DATE))
    AND ms.ad_date <= date_add('day', 14,
                               COALESCE(p.end_date, CURRENT_DATE))

    -- Business-date filter on time_window_start
    AND ms.time_window_start >= COALESCE(p.start_date,
                                          date_add('week', -1 * (p.periods_back + 2), CURRENT_DATE))

    -- Optional campaign type filter (dataset: sponsored_products / sponsored_brands / sponsored_display)
    AND (
      cardinality(p.campaign_types) = 0
      OR any_match(p.campaign_types, ct -> lower(ct) = lower(ms.dataset))
    )

    -- Optional marketplace filter
    AND (
      cardinality(p.marketplaces) = 0
      OR any_match(p.marketplaces, mp -> lower(mp) IN (m.country, m.country_code, lower(m.marketplace_name)))
    )

    -- Optional campaign name filter
    AND (
      cardinality(p.campaign_names) = 0
      OR any_match(p.campaign_names, c -> lower(c) = lower(ms."campaign name"))
    )

    -- Optional ad group name filter
    AND (
      cardinality(p.ad_group_names) = 0
      OR any_match(p.ad_group_names, ag -> lower(ag) = lower(ms."ad group name"))
    )

    -- Optional target keyword filter (with match_type logic)
    AND (
      cardinality(p.target_keywords) = 0
      OR (
        CASE p.keyword_match_type
          WHEN 'exact' THEN
            any_match(p.target_keywords, t -> lower(t) = lower(ms."target keyword"))
          WHEN 'starts_with' THEN
            any_match(p.target_keywords, t -> lower(ms."target keyword") LIKE lower(t) || '%')
          ELSE -- 'contains'
            any_match(p.target_keywords, t -> lower(ms."target keyword") LIKE '%' || lower(t) || '%')
        END
      )
    )

    -- Optional placement filter
    AND (
      cardinality(p.placements) = 0
      OR any_match(p.placements, pl -> lower(pl) = lower(ms.placement))
    )

    -- Optional match type filter
    AND (
      cardinality(p.match_types) = 0
      OR any_match(p.match_types, mt -> lower(mt) = lower(ms."match type"))
    )

    -- ASIN dimension filters
    AND (cardinality(p.asins) = 0 OR any_match(p.asins, a -> lower(a) = lower(COALESCE(ms."purchased asin", ms."advertised asin"))))
    AND (cardinality(p.product_families) = 0 OR any_match(p.product_families, pf -> lower(pf) = lower(aa.product_family)))
    AND (cardinality(p.brands) = 0 OR any_match(p.brands, b -> lower(b) = lower(aa.brand)))
    AND (cardinality(p.pareto_classes) = 0 OR any_match(p.pareto_classes, pc -> lower(pc) = lower(aa.pareto_abc_class)))
    AND (cardinality(p.revenue_classes) = 0 OR any_match(p.revenue_classes, rc -> lower(rc) = lower(aa.revenue_abcd_class)))
),

-- ─── Determine date window ──────────────────────────────────────────────────
latest AS (
  SELECT max(report_date) AS latest_date FROM enriched
),

date_bounds AS (
  SELECT
    COALESCE(p.start_date, CAST(date_add('week', -1 * (p.periods_back - 1), CAST(l.latest_date AS DATE)) AS DATE)) AS start_date,
    COALESCE(p.end_date, CAST(l.latest_date AS DATE)) AS end_date
  FROM params p
  CROSS JOIN latest l
),

windowed AS (
  SELECT e.*
  FROM enriched e
  CROSS JOIN date_bounds d
  WHERE CAST(e.report_date AS DATE) BETWEEN d.start_date AND d.end_date
),

-- ─── Aggregate by dynamic group-by ──────────────────────────────────────────
aggregated AS (
  SELECT
    -- Periodicity key (derived from time_window_start = business date)
    CASE p.periodicity
      WHEN 'day'   THEN CAST(CAST(w.report_date AS DATE) AS VARCHAR)
      WHEN 'month' THEN DATE_FORMAT(CAST(w.report_date AS DATE), '%Y-%m')
      WHEN 'year'  THEN CAST(YEAR(CAST(w.report_date AS DATE)) AS VARCHAR)
      ELSE NULL
    END                                                                          AS time_period,

    -- Conditional group-by keys (NULL when not grouped)
    CASE WHEN p.group_by_campaign_name = 1 THEN w.campaign_name ELSE NULL END    AS campaign_name,
    CASE WHEN p.group_by_ad_group_name = 1 THEN w.ad_group_name ELSE NULL END    AS ad_group_name,
    CASE WHEN p.group_by_placement = 1 THEN w.placement ELSE NULL END            AS placement,
    CASE WHEN p.group_by_match_type = 1 THEN w.match_type ELSE NULL END          AS match_type,
    CASE WHEN p.group_by_dataset = 1 THEN w.dataset ELSE NULL END                AS dataset,
    CASE WHEN p.group_by_target_keyword = 1 THEN w.target_keyword ELSE NULL END  AS target_keyword,
    CASE WHEN p.group_by_advertised_asin = 1 THEN w.advertised_asin ELSE NULL END AS advertised_asin,
    CASE WHEN p.group_by_product_family = 1 THEN w.product_family ELSE NULL END  AS product_family,
    CASE WHEN p.group_by_brand = 1 THEN w.asin_brand ELSE NULL END               AS brand,
    CASE WHEN p.group_by_pareto_class = 1 THEN w.pareto_abc_class ELSE NULL END  AS pareto_abc_class,
    CASE WHEN p.group_by_revenue_class = 1 THEN w.revenue_abcd_class ELSE NULL END AS revenue_abcd_class,
    CASE WHEN p.group_by_company = 1 THEN w.company_id ELSE NULL END              AS company_id,
    CASE WHEN p.group_by_marketplace = 1 THEN w.marketplace_name ELSE NULL END    AS marketplace,
    CASE WHEN p.group_by_marketplace = 1 THEN w.marketplace_country_code ELSE NULL END AS marketplace_country_code,
    CASE WHEN p.group_by_marketplace = 1 THEN w.currency ELSE NULL END            AS currency,

    -- Metrics (USD-normalised for cross-marketplace correctness)
    SUM(w.impressions)                 AS impressions,
    SUM(w.clicks)                      AS clicks,
    SUM(w.cost_usd)                    AS cost_usd,
    SUM(w.attributed_sales_usd)        AS attributed_sales_usd,
    SUM(w.conversions)                 AS conversions,
    SUM(w.attributed_units_ordered)    AS attributed_units_ordered,

    -- Context
    COUNT(DISTINCT CAST(w.report_date AS DATE)) AS days_active,
    COUNT(DISTINCT w.advertised_asin)            AS asin_count,

    -- Revenue share (avg when grouped)
    AVG(w.revenue_share)               AS avg_revenue_share

  FROM windowed w
  CROSS JOIN params p
  GROUP BY
    CASE p.periodicity
      WHEN 'day'   THEN CAST(CAST(w.report_date AS DATE) AS VARCHAR)
      WHEN 'month' THEN DATE_FORMAT(CAST(w.report_date AS DATE), '%Y-%m')
      WHEN 'year'  THEN CAST(YEAR(CAST(w.report_date AS DATE)) AS VARCHAR)
      ELSE NULL
    END,
    CASE WHEN p.group_by_campaign_name = 1 THEN w.campaign_name ELSE NULL END,
    CASE WHEN p.group_by_ad_group_name = 1 THEN w.ad_group_name ELSE NULL END,
    CASE WHEN p.group_by_placement = 1 THEN w.placement ELSE NULL END,
    CASE WHEN p.group_by_match_type = 1 THEN w.match_type ELSE NULL END,
    CASE WHEN p.group_by_dataset = 1 THEN w.dataset ELSE NULL END,
    CASE WHEN p.group_by_target_keyword = 1 THEN w.target_keyword ELSE NULL END,
    CASE WHEN p.group_by_advertised_asin = 1 THEN w.advertised_asin ELSE NULL END,
    CASE WHEN p.group_by_product_family = 1 THEN w.product_family ELSE NULL END,
    CASE WHEN p.group_by_brand = 1 THEN w.asin_brand ELSE NULL END,
    CASE WHEN p.group_by_pareto_class = 1 THEN w.pareto_abc_class ELSE NULL END,
    CASE WHEN p.group_by_revenue_class = 1 THEN w.revenue_abcd_class ELSE NULL END,
    CASE WHEN p.group_by_company = 1 THEN w.company_id ELSE NULL END,
    CASE WHEN p.group_by_marketplace = 1 THEN w.marketplace_name ELSE NULL END,
    CASE WHEN p.group_by_marketplace = 1 THEN w.marketplace_country_code ELSE NULL END,
    CASE WHEN p.group_by_marketplace = 1 THEN w.currency ELSE NULL END
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
    a.pareto_abc_class,
    a.revenue_abcd_class,
    a.company_id,
    a.marketplace,
    a.marketplace_country_code,
    a.currency,

    a.impressions,
    a.clicks,
    ROUND(a.cost_usd, 2)                                                          AS cost_usd,
    ROUND(a.attributed_sales_usd, 2)                                              AS attributed_sales_usd,
    a.conversions,
    a.attributed_units_ordered,

    -- Efficiency KPIs (all in USD)
    CASE WHEN a.clicks > 0 THEN ROUND(a.cost_usd / a.clicks, 2) ELSE NULL END     AS cpc_usd,
    CASE WHEN a.impressions > 0 THEN ROUND(100.0 * a.clicks / a.impressions, 2) ELSE NULL END AS ctr_pct,
    CASE WHEN a.clicks > 0 THEN ROUND(100.0 * a.conversions / a.clicks, 2) ELSE NULL END     AS cvr_pct,
    CASE WHEN a.attributed_sales_usd > 0 THEN ROUND(100.0 * a.cost_usd / a.attributed_sales_usd, 2) ELSE NULL END AS acos_pct,
    CASE WHEN a.cost_usd > 0 THEN ROUND(a.attributed_sales_usd / a.cost_usd, 2) ELSE NULL END             AS roas,

    -- Context
    a.days_active,
    a.asin_count,
    ROUND(a.avg_revenue_share, 4)                                                  AS avg_revenue_share

  FROM aggregated a
)

-- ─── Ranked output ──────────────────────────────────────────────────────────
SELECT
  ROW_NUMBER() OVER (ORDER BY {{sort_column}} {{sort_direction}} NULLS LAST) AS rank,
  k.*
FROM with_kpis k
ORDER BY {{sort_column}} {{sort_direction}} NULLS LAST
LIMIT {{limit_top_n}}
