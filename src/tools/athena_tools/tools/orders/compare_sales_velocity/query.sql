-- Tool: customer_orders_compare_amazon_sales_velocity
-- Source: ClickHouse analytics.order_details_v2026_current (sales signals, item grain)
--         + etl.sku_dimensions (inventory_id / brand / product_family, one row per company_id + sku)
--
-- Compares period-to-date sales velocity for the CURRENT grain bucket against the same elapsed
-- window shifted back by configurable day offsets (default 1, 7, 30, 365).
--
-- "Period-to-date" means: current window = [bucket_start, now]; each comparison window = that same
-- window shifted back N days, so an in-progress bucket compares fairly against the same slice of a
-- prior period.
--
-- Metrics per window: units_sold (SUM ordered_quantity), sales (SUM principal + shipping), avg_price
-- (sales / units). Rows are split by company_id x dimension x marketplace x currency; *_main
-- columns convert to the company main currency at the order's local date.
-- NOTE: no join_use_nulls dependency; unmatched LEFT JOIN defaults are mapped back to NULL.
-- Time zone: purchase_date (UTC) shifted by utc_offset_minutes (derived DST-aware from
-- app_companies.timezone in the tool layer; utc_offset_hours overrides).

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
    toInt32({{prune_months_back}}) AS prune_months_back
),

-- ── 0. Reference clock + current bucket start (local wall-clock time) ───────
bounds AS (
  SELECT
    toDateTime(now('UTC')) + toIntervalMinute({{utc_offset_minutes}}) AS now_ts,
    multiIf(
      p.granularity = 'hour',  toStartOfHour(now_ts),
      p.granularity = 'week',  toDateTime(toMonday(toDate(now_ts))),
      p.granularity = 'month', toDateTime(toStartOfMonth(toDate(now_ts))),
      toDateTime(toDate(now_ts))
    ) AS cur_start
  FROM params AS p
),

-- ── 1. Comparison windows (offset 0 = current) ─────────────────────────────
windows AS (
  SELECT toInt64(0) AS offset_days, b.cur_start AS win_start, b.now_ts AS win_end
  FROM bounds AS b
  UNION ALL
  SELECT
    toInt64(o.off)                              AS offset_days,
    b.cur_start - toIntervalDay(o.off)          AS win_start,
    b.now_ts    - toIntervalDay(o.off)          AS win_end
  FROM bounds AS b
  CROSS JOIN (SELECT arrayJoin(offsets_days) AS off FROM params) AS o
),

-- ── 2. Item scan (partition-pruned) with order-level and product filters ────
items AS (
  SELECT
    o.company_id                                              AS company_id,
    toDateTime(o.purchase_date) + toIntervalMinute({{utc_offset_minutes}}) AS created_time,
    o.amazon_marketplace_id                                   AS marketplace_id,
    o.asin                                                    AS asin,
    o.sku                                                     AS sku,
    o.product_name                                            AS title,
    toInt64(greatest(o.ordered_quantity, 0))                  AS units,
    -- Sales = principal + shipping (matches the NeonPanel report "Sales"); NULL -> 0.
    toFloat64(coalesce(o.principal, 0)) + toFloat64(coalesce(o.shipping, 0)) AS sales_amount,
    coalesce(o.principal_currency, o.shipping_currency, o.order_total_currency) AS currency
  FROM analytics.order_details_v2026_current AS o
  CROSS JOIN params AS p
  WHERE has(p.company_ids, o.company_id)
    AND o.purchase_date IS NOT NULL
    AND o.purchase_month >= formatDateTime(addMonths(toDate(now()), -p.prune_months_back), '%Y-%m')
    AND (empty(p.seller_ids) OR has(p.seller_ids, o.seller_id))
    AND (empty(p.marketplaces) OR has(p.marketplaces, o.amazon_marketplace_id))
    AND (empty(p.order_statuses) OR has(p.order_statuses,
          multiIf(o.order_status = 'Shipped', 'SHIPPED',
                  o.order_status = 'PartiallyShipped', 'PARTIALLY_SHIPPED',
                  o.order_status = 'PendingAvailability', 'PENDING_AVAILABILITY',
                  upper(o.order_status))))
    AND (empty(p.fulfillment_channels) OR has(p.fulfillment_channels, if(o.fulfillment_channel = 'AFN', 'AFN', 'MFN')))
    AND (empty(p.skus)  OR has(p.skus, o.sku))
    AND (empty(p.asins) OR has(p.asins, o.asin))
),

-- ── 3. Dimension mapping (one row per company_id + sku) ────────────────────
ia_dedup AS (
  SELECT company_id, sku, inventory_id, brand, product_family
  FROM etl.sku_dimensions
  WHERE company_id IN (SELECT arrayJoin(company_ids) FROM params)
  ORDER BY source_updated_at DESC, inventory_id DESC
  LIMIT 1 BY company_id, sku
),

enriched AS (
  SELECT
    i.company_id    AS company_id,
    i.created_time  AS created_time,
    i.marketplace_id AS marketplace_id,
    i.asin          AS asin,
    i.sku           AS sku,
    i.title         AS title,
    i.units         AS units,
    i.sales_amount  AS sales_amount,
    i.currency      AS currency,
    nullIf(ia.inventory_id, 0) AS inventory_id,
    nullIf(ia.brand, '')       AS brand,
    nullIf(ia.product_family, '') AS product_family
  FROM items AS i
  LEFT JOIN ia_dedup AS ia ON ia.company_id = i.company_id AND ia.sku = i.sku
  CROSS JOIN params AS p
  WHERE (empty(p.brands)           OR has(p.brands, ia.brand))
    AND (empty(p.product_families) OR has(p.product_families, ia.product_family))
),

-- ── 3b. Per-company main reporting currency + FX (native -> USD) ────────────
company_main AS (
  SELECT id AS company_id, currency AS main_currency
  FROM app.app_companies
  WHERE id IN (SELECT arrayJoin(company_ids) FROM params)
),

fx AS (
  SELECT upper(toString(currency)) AS currency, toDate(date) AS rate_date, max(toFloat64(rate)) AS rate
  FROM app.currency_rates
  GROUP BY currency, rate_date
),

-- amount_main = amount_native * rate(native) / rate(main), at the order's local date.
converted AS (
  SELECT
    e.company_id, e.created_time, e.marketplace_id, e.asin, e.sku, e.title, e.units, e.sales_amount,
    e.currency, e.inventory_id, e.brand, e.product_family,
    nullIf(cm.main_currency, '') AS main_currency,
    if(fxn.rate > 0 AND fxm.rate > 0, e.sales_amount * fxn.rate / fxm.rate, NULL) AS sales_amount_main
  FROM enriched AS e
  LEFT JOIN company_main AS cm ON cm.company_id = e.company_id
  ASOF LEFT JOIN fx AS fxn ON fxn.currency = upper(e.currency) AND toDate(e.created_time) >= fxn.rate_date
  ASOF LEFT JOIN fx AS fxm ON fxm.currency = upper(cm.main_currency) AND toDate(e.created_time) >= fxm.rate_date
),

-- ── 4. Assign each item to every window it falls in ────────────────────────
joined AS (
  SELECT
    e.company_id                    AS company_id,
    {{group_dim_expr}}              AS group_value,
    e.marketplace_id                AS marketplace_id,
    coalesce(e.currency, 'UNKNOWN') AS currency,
    e.main_currency                 AS main_currency,
    e.title                         AS title,
    w.offset_days                   AS offset_days,
    e.units                         AS units,
    e.sales_amount                  AS sales_amount,
    e.sales_amount_main             AS sales_amount_main
  FROM converted AS e
  CROSS JOIN windows AS w
  WHERE e.created_time >= w.win_start
    AND e.created_time <  w.win_end
),

-- ── 5. Pivot windows into per-period metric columns ────────────────────────
agg AS (
  SELECT
    company_id,
    group_value,
    marketplace_id,
    currency,
    max(main_currency) AS main_currency,
    max(title) AS representative_title,
    {{metric_pivot_columns}}
  FROM joined
  GROUP BY company_id, group_value, marketplace_id, currency
)

SELECT
  '{{group_by}}' AS group_by,
  toString(company_id) AS company_id,
  group_value,
  representative_title,
  marketplace_id,
  currency,
  main_currency,
  {{select_columns}}
FROM agg
ORDER BY current_sales DESC NULLS LAST
LIMIT {{limit_top_n}}
