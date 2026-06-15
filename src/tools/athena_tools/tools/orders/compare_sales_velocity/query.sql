-- Tool: customer_orders_compare_amazon_sales_velocity
-- Source: sp_api_iceberg.orders_v2026 (sales signals)
--         + neonpanel_iceberg.inventory_attributes (inventory_id / brand / product_family)
--
-- Compares period-to-date sales velocity for the CURRENT grain bucket against the same
-- elapsed window shifted back by configurable day offsets (default 1, 7, 30, 365 =
-- yesterday / last week / last month / last year).
--
-- "Period-to-date" means: current window = [bucket_start, now]; each comparison window =
-- that same window shifted back N days, so an in-progress bucket compares fairly against
-- the same slice of a prior period.
--
-- Metrics per window: units_sold (SUM quantity_ordered), sales (SUM item proceeds_total),
-- avg_price (sales / units). Rows are split by company_id x dimension x marketplace x currency
-- (sales are NOT currency-converted).

WITH params AS (
  SELECT
    {{company_ids_array}}          AS company_ids,
    {{marketplaces_array}}         AS marketplaces,
    {{order_statuses_array}}       AS order_statuses,
    {{fulfillment_channels_array}} AS fulfillment_channels,
    {{seller_ids_array}}           AS seller_ids,
    {{skus_array}}                 AS skus,
    {{asins_array}}                AS asins,
    {{brands_array}}               AS brands,
    {{product_families_array}}     AS product_families,
    {{offsets_array}}              AS offsets_days,
    '{{granularity}}'              AS granularity,
    CAST({{prune_months_back}} AS INTEGER) AS prune_months_back
),

-- ── 0. Reference clock + current bucket start (in the requested time zone) ──
-- All bucketing/windowing is done in local wall-clock time so day/week/month
-- boundaries match the seller's reporting time zone (default America/Los_Angeles),
-- not UTC.
bounds AS (
  SELECT
    CAST(CURRENT_TIMESTAMP AT TIME ZONE {{time_zone_sql}} AS TIMESTAMP) AS now_ts,
    CASE p.granularity
      WHEN 'hour'  THEN DATE_TRUNC('hour',  CAST(CURRENT_TIMESTAMP AT TIME ZONE {{time_zone_sql}} AS TIMESTAMP))
      WHEN 'week'  THEN DATE_TRUNC('week',  CAST(CURRENT_TIMESTAMP AT TIME ZONE {{time_zone_sql}} AS TIMESTAMP))
      WHEN 'month' THEN DATE_TRUNC('month', CAST(CURRENT_TIMESTAMP AT TIME ZONE {{time_zone_sql}} AS TIMESTAMP))
      ELSE              DATE_TRUNC('day',   CAST(CURRENT_TIMESTAMP AT TIME ZONE {{time_zone_sql}} AS TIMESTAMP))
    END AS cur_start
  FROM params p
),

-- ── 1. Comparison windows (offset 0 = current) ─────────────────────────────
windows AS (
  SELECT CAST(0 AS BIGINT) AS offset_days, b.cur_start AS win_start, b.now_ts AS win_end
  FROM bounds b
  UNION ALL
  SELECT
    off                                      AS offset_days,
    DATE_ADD('day', -CAST(off AS INTEGER), b.cur_start) AS win_start,
    DATE_ADD('day', -CAST(off AS INTEGER), b.now_ts)    AS win_end
  FROM bounds b
  CROSS JOIN params p
  CROSS JOIN UNNEST(p.offsets_days) AS t(off)
),

-- ── 2. Partition-pruned scan + dedup to latest snapshot per order ──────────
latest AS (
  SELECT
    o.order_id,
    o.company_id,
    o.created_time,
    o.sales_channel.marketplace_id   AS marketplace_id,
    o.fulfillment.fulfillment_status AS fulfillment_status,
    o.fulfillment.fulfilled_by       AS fulfilled_by,
    o.seller_id,
    o.order_items                    AS order_items,
    ROW_NUMBER() OVER (
      PARTITION BY o.order_id, o.company_id
      ORDER BY o.last_updated_time DESC
    ) AS rn
  FROM "{{catalog}}"."sp_api_iceberg"."orders_v2026" o
  CROSS JOIN params p
  WHERE contains(p.company_ids, CAST(o.company_id AS BIGINT))
    AND o.date_month >= DATE_FORMAT(DATE_ADD('month', -p.prune_months_back, CURRENT_DATE), '%Y-%m')
    AND (cardinality(p.seller_ids) = 0 OR contains(p.seller_ids, o.seller_id))
),

filtered AS (
  SELECT l.*
  FROM latest l
  CROSS JOIN params p
  WHERE l.rn = 1
    AND (cardinality(p.marketplaces) = 0         OR contains(p.marketplaces, l.marketplace_id))
    AND (cardinality(p.order_statuses) = 0       OR contains(p.order_statuses, l.fulfillment_status))
    AND (cardinality(p.fulfillment_channels) = 0 OR contains(p.fulfillment_channels, l.fulfilled_by))
),

-- ── 3. Explode order items + apply ASIN/SKU filters ────────────────────────
items AS (
  SELECT
    f.company_id,
    -- Convert UTC order timestamp to local wall-clock time for window matching.
    CAST((f.created_time AT TIME ZONE 'UTC') AT TIME ZONE {{time_zone_sql}} AS TIMESTAMP) AS created_time,
    f.marketplace_id,
    oi.product.asin                                   AS asin,
    oi.product.seller_sku                             AS sku,
    oi.product.title                                  AS title,
    COALESCE(oi.quantity_ordered, 0)                  AS units,
    COALESCE(oi.proceeds.proceeds_total.amount, 0.0)  AS sales_amount,
    oi.proceeds.proceeds_total.currency_code          AS currency
  FROM filtered f
  CROSS JOIN UNNEST(f.order_items) AS t(oi)
  CROSS JOIN params p
  WHERE (cardinality(p.skus) = 0  OR contains(p.skus,  oi.product.seller_sku))
    AND (cardinality(p.asins) = 0 OR contains(p.asins, oi.product.asin))
),

-- ── 4. Dimension mapping (one row per company_id + sku) ────────────────────
ia_dedup AS (
  SELECT attr_company_id, sku, attr_inventory_id, brand, product_family
  FROM (
    SELECT
      ia.attr_company_id,
      ia.sku,
      ia.attr_inventory_id,
      ia.brand,
      ia."product family" AS product_family,
      ROW_NUMBER() OVER (
        PARTITION BY ia.attr_company_id, ia.sku
        ORDER BY ia.attr_inventory_id
      ) AS rn
    FROM "{{catalog}}"."neonpanel_iceberg"."inventory_attributes" ia
  )
  WHERE rn = 1
),

enriched AS (
  SELECT
    i.company_id,
    i.created_time,
    i.marketplace_id,
    i.asin,
    i.sku,
    i.title,
    i.units,
    i.sales_amount,
    i.currency,
    ia.attr_inventory_id AS inventory_id,
    ia.brand             AS brand,
    ia.product_family    AS product_family
  FROM items i
  LEFT JOIN ia_dedup ia
    ON ia.attr_company_id = TRY_CAST(i.company_id AS BIGINT)
   AND ia.sku = i.sku
  CROSS JOIN params p
  WHERE (cardinality(p.brands) = 0           OR contains(p.brands, ia.brand))
    AND (cardinality(p.product_families) = 0 OR contains(p.product_families, ia.product_family))
),

-- ── 4b. Per-company main reporting currency + FX validity ranges ────────────
company_main AS (
  SELECT id AS company_id, currency AS main_currency
  FROM "{{catalog}}"."neonpanel_iceberg"."app_companies"
),

-- currency_rates.rate is native->USD (USD = 1.0). Rates are sparse (~weekly),
-- so each rate is valid from its date until the next rate for that currency.
fx AS (
  SELECT
    currency,
    date AS from_date,
    COALESCE(
      LEAD(date) OVER (PARTITION BY currency ORDER BY date),
      DATE '9999-12-31'
    ) AS to_date,
    rate
  FROM "{{catalog}}"."neonpanel_iceberg"."currency_rates"
),

-- Convert each item to the company main currency at its own (local) order date:
--   amount_main = amount_native * rate(native) / rate(main)
converted AS (
  SELECT
    e.company_id,
    e.created_time,
    e.marketplace_id,
    e.asin,
    e.sku,
    e.title,
    e.units,
    e.sales_amount,
    e.currency,
    e.inventory_id,
    e.brand,
    e.product_family,
    cm.main_currency,
    e.sales_amount * fxn.rate / NULLIF(fxm.rate, 0.0) AS sales_amount_main
  FROM enriched e
  LEFT JOIN company_main cm ON cm.company_id = TRY_CAST(e.company_id AS BIGINT)
  LEFT JOIN fx fxn
    ON fxn.currency = e.currency
   AND CAST(e.created_time AS DATE) >= fxn.from_date
   AND CAST(e.created_time AS DATE) <  fxn.to_date
  LEFT JOIN fx fxm
    ON fxm.currency = cm.main_currency
   AND CAST(e.created_time AS DATE) >= fxm.from_date
   AND CAST(e.created_time AS DATE) <  fxm.to_date
),

-- ── 5. Assign each item to every window it falls in ────────────────────────
joined AS (
  SELECT
    e.company_id,
    {{group_dim_expr}}              AS group_value,
    e.marketplace_id,
    COALESCE(e.currency, 'UNKNOWN') AS currency,
    e.main_currency,
    e.title,
    w.offset_days,
    e.units,
    e.sales_amount,
    e.sales_amount_main
  FROM converted e
  CROSS JOIN windows w
  WHERE e.created_time >= w.win_start
    AND e.created_time <  w.win_end
),

-- ── 6. Pivot windows into per-period metric columns ────────────────────────
agg AS (
  SELECT
    company_id,
    group_value,
    marketplace_id,
    currency,
    MAX(main_currency) AS main_currency,
    MAX(title) AS representative_title,
    {{metric_pivot_columns}}
  FROM joined
  GROUP BY company_id, group_value, marketplace_id, currency
)

SELECT
  '{{group_by}}' AS group_by,
  company_id,
  group_value,
  representative_title,
  marketplace_id,
  currency,
  main_currency,
  {{select_columns}}
FROM agg
ORDER BY current_sales DESC NULLS LAST
LIMIT {{limit_top_n}}
