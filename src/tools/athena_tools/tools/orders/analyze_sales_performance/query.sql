-- Tool: customer_orders_analyze_amazon_sales_performance
-- Source: ClickHouse analytics.order_details_v2026_current (item grain; the view already keeps the
--   latest generation per (company_id, amazon_order_id) and drops tombstones).
-- Revenue: Sales = principal + shipping, summed over an order's item rows (NULL -> 0).
-- Time zone: purchase_date (UTC) is shifted by utc_offset_minutes before date filtering and
--   day/week/month/hour bucketing, so periods match the seller's calendar. The offset is derived
--   (DST-aware) from the company's app_companies.timezone in the tool layer; utc_offset_hours
--   can override it.
-- FX: app.currency_rates.rate is native->USD (USD = 1.0); the latest rate on or before the order's
--   local date is used (ASOF), converting native -> company main currency.

WITH params AS (
  SELECT
    {{company_ids_array}}               AS company_ids,
    {{marketplaces_array}}              AS marketplaces,
    {{order_statuses_array}}            AS order_statuses,
    {{fulfillment_channels_array}}      AS fulfillment_channels,
    {{seller_ids_array}}                AS seller_ids,
    {{start_date_sql}}                  AS start_date,
    {{end_date_sql}}                    AS end_date,
    toInt32({{periods_back}})           AS periods_back,
    '{{granularity}}'                   AS granularity
),

-- ── 1. Partition-pruned item scan with order-level filters ─────────────────
items AS (
  SELECT
    o.amazon_order_id                                         AS order_id,
    o.company_id                                              AS company_id,
    o.amazon_marketplace_id                                   AS marketplace_id,
    o.purchase_date + toIntervalMinute({{utc_offset_minutes}}) AS created_local,
    multiIf(o.order_status = 'Shipped', 'SHIPPED',
            o.order_status = 'PartiallyShipped', 'PARTIALLY_SHIPPED',
            o.order_status = 'PendingAvailability', 'PENDING_AVAILABILITY',
            upper(o.order_status))                            AS fulfillment_status,
    if(o.fulfillment_channel = 'AFN', 'AMAZON', 'MERCHANT')   AS fulfilled_by,
    toFloat64(coalesce(o.principal, 0)) + toFloat64(coalesce(o.shipping, 0)) AS item_sales,
    coalesce(o.principal_currency, o.shipping_currency, o.order_total_currency) AS item_currency
  FROM analytics.order_details_v2026_current AS o
  CROSS JOIN params AS p
  WHERE has(p.company_ids, o.company_id)
    AND o.purchase_date IS NOT NULL
    AND o.purchase_month >= formatDateTime(
          addMonths(coalesce(p.start_date, toDate(now())),
                    -if(isNull(p.start_date), p.periods_back + 1, 1)), '%Y-%m')
    AND (empty(p.seller_ids) OR has(p.seller_ids, o.seller_id))
    AND (empty(p.marketplaces) OR has(p.marketplaces, o.amazon_marketplace_id))
    AND (empty(p.order_statuses) OR has(p.order_statuses, fulfillment_status))
    AND (empty(p.fulfillment_channels) OR has(p.fulfillment_channels, if(o.fulfillment_channel = 'AFN', 'AFN', 'MFN')))
),

-- ── 2. Order level: Sales = principal + shipping across items ──────────────
order_sales AS (
  SELECT
    i.order_id                                   AS order_id,
    i.company_id                                 AS company_id,
    any(i.marketplace_id)                        AS marketplace_id,
    any(i.created_local)                         AS created_local,
    toDate(any(i.created_local))                 AS local_date,
    any(i.fulfillment_status)                    AS fulfillment_status,
    any(i.fulfilled_by)                          AS fulfilled_by,
    sum(i.item_sales)                            AS order_total,
    anyIf(i.item_currency, isNotNull(i.item_currency)) AS currency
  FROM items AS i
  GROUP BY i.order_id, i.company_id
),

filtered AS (
  SELECT f.*
  FROM order_sales AS f
  CROSS JOIN params AS p
  WHERE (isNull(p.start_date) OR f.local_date >= p.start_date)
    AND (isNull(p.end_date)   OR f.local_date <= p.end_date)
    AND (isNotNull(p.start_date)
         OR f.local_date >= addMonths(toDate(now('UTC') + toIntervalMinute({{utc_offset_minutes}})), -p.periods_back))
),

-- ── 3. Per-company main reporting currency + FX ────────────────────────────
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

-- ── 4. Bucket by period + convert to main currency at the order's local date ─
bucketed AS (
  SELECT
    multiIf(
      p.granularity = 'hour',  formatDateTime(toStartOfHour(f.created_local), '%Y-%m-%dT%H:00'),
      p.granularity = 'week',  toString(toMonday(f.local_date)),
      p.granularity = 'month', toString(toStartOfMonth(f.local_date)),
      toString(f.local_date)
    )                                           AS period_start,
    f.marketplace_id                            AS marketplace_id,
    f.currency                                  AS currency,
    nullIf(cm.main_currency, '')                AS main_currency,
    f.company_id                                AS company_id,
    f.order_id                                  AS order_id,
    f.order_total                               AS order_total,
    if(fxn.rate > 0 AND fxm.rate > 0, f.order_total * fxn.rate / fxm.rate, NULL) AS order_total_main,
    f.fulfillment_status                        AS fulfillment_status,
    f.fulfilled_by                              AS fulfilled_by
  FROM filtered AS f
  CROSS JOIN params AS p
  LEFT JOIN company_main AS cm ON cm.company_id = f.company_id
  ASOF LEFT JOIN fx AS fxn ON fxn.currency = upper(f.currency) AND f.local_date >= fxn.rate_date
  ASOF LEFT JOIN fx AS fxm ON fxm.currency = upper(cm.main_currency) AND f.local_date >= fxm.rate_date
),

-- ── 5. Aggregate ───────────────────────────────────────────────────────────
agg AS (
  SELECT
    period_start,
    marketplace_id,
    coalesce(currency, 'UNKNOWN')                  AS currency,
    max(main_currency)                             AS main_currency,
    company_id,
    uniqExact(order_id)                            AS orders,
    round(sum(order_total), 2)                     AS gross_revenue,
    round(sum(order_total_main), 2)                AS gross_revenue_main,
    round(sum(order_total) / nullIf(uniqExact(order_id), 0), 2)       AS avg_order_value,
    round(sum(order_total_main) / nullIf(uniqExact(order_id), 0), 2)  AS avg_order_value_main,
    countIf(fulfillment_status = 'SHIPPED')        AS shipped_count,
    countIf(fulfillment_status = 'PENDING')        AS pending_count,
    countIf(fulfillment_status = 'CANCELED')       AS canceled_count,
    countIf(fulfilled_by = 'AMAZON')               AS fba_count,
    countIf(fulfilled_by != 'AMAZON')              AS fbm_count
  FROM bucketed
  GROUP BY period_start, marketplace_id, currency, company_id
)

SELECT
  period_start,
  marketplace_id,
  currency,
  main_currency,
  toString(company_id) AS company_id,
  orders,
  gross_revenue,
  gross_revenue_main,
  avg_order_value,
  avg_order_value_main,
  shipped_count,
  pending_count,
  canceled_count,
  fba_count,
  fbm_count
FROM agg
ORDER BY period_start DESC, marketplace_id, currency
LIMIT {{limit_top_n}}
