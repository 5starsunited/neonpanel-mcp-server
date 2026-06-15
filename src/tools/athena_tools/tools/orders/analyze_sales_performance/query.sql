-- Tool: customer_orders_analyze_amazon_sales_performance
-- Source: sp_api_iceberg.orders_v2026
-- Revenue: Sales = principal + shipping (item proceeds.breakdowns; see order_sales)
-- Dedup: latest last_updated_time per order_id + company_id
-- Time zone: order timestamps (UTC) are shifted by utc_offset_minutes before date
--   filtering and day/week/month bucketing, so periods match the seller's calendar.
--   The offset is derived (DST-aware) from the company's app_companies.timezone in the
--   tool layer; utc_offset_hours can override it. (Offset, not AT TIME ZONE: casting a
--   timestamp-with-tz back to timestamp re-renders in the session zone (UTC), undoing it.)

WITH params AS (
  SELECT
    {{company_ids_array}}               AS company_ids,
    {{marketplaces_array}}              AS marketplaces,
    {{order_statuses_array}}            AS order_statuses,
    {{fulfillment_channels_array}}      AS fulfillment_channels,
    {{seller_ids_array}}                AS seller_ids,
    {{start_date_sql}}                  AS start_date,
    {{end_date_sql}}                    AS end_date,
    CAST({{periods_back}} AS INTEGER)   AS periods_back,
    '{{granularity}}'                   AS granularity
),

-- ── 1. Partition-pruned scan + dedup ───────────────────────────────────────
latest AS (
  SELECT
    o.order_id,
    DATE_ADD('minute', {{utc_offset_minutes}}, o.created_time) AS created_local,
    o.last_updated_time,
    o.sales_channel.marketplace_id                  AS marketplace_id,
    o.sales_channel.marketplace_name                AS marketplace_name,
    o.fulfillment.fulfillment_status                AS fulfillment_status,
    o.fulfillment.fulfilled_by                      AS fulfilled_by,
    o.order_items                                   AS order_items,
    o.company_id,
    o.seller_id,
    ROW_NUMBER() OVER (
      PARTITION BY o.order_id, o.company_id
      ORDER BY o.last_updated_time DESC
    ) AS rn
  FROM "{{catalog}}"."sp_api_iceberg"."orders_v2026" o
  CROSS JOIN params p
  WHERE
    contains(p.company_ids, CAST(o.company_id AS BIGINT))
    AND (
      cardinality(p.seller_ids) = 0
      OR contains(p.seller_ids, o.seller_id)
    )
    AND o.date_month >= DATE_FORMAT(
      DATE_ADD('month', -(p.periods_back + 1), CURRENT_DATE), '%Y-%m'
    )
),

-- ── 2. Keep latest snapshot + apply filters ────────────────────────────────
filtered AS (
  SELECT l.*
  FROM latest l
  CROSS JOIN params p
  WHERE l.rn = 1
    AND (
      p.start_date IS NULL
      OR CAST(l.created_local AS DATE) >= p.start_date
    )
    AND (
      p.end_date IS NULL
      OR CAST(l.created_local AS DATE) <= p.end_date
    )
    AND (
      p.start_date IS NOT NULL
      OR CAST(l.created_local AS DATE) >= DATE_ADD(
        'month', -p.periods_back,
        CAST(DATE_ADD('minute', {{utc_offset_minutes}}, CAST(CURRENT_TIMESTAMP AS TIMESTAMP)) AS DATE)
      )
    )
    AND (
      cardinality(p.marketplaces) = 0
      OR contains(p.marketplaces, l.marketplace_id)
    )
    AND (
      cardinality(p.order_statuses) = 0
      OR contains(p.order_statuses, l.fulfillment_status)
    )
    AND (
      cardinality(p.fulfillment_channels) = 0
      OR contains(p.fulfillment_channels, l.fulfilled_by)
    )
),

-- ── 2a. Order-level Sales = principal + shipping (matches NeonPanel report) ──
-- principal = ITEM breakdown subtotal, fallback unit_price * qty; shipping = SHIPPING breakdown.
-- Avoids proceeds.grand_total, which is NULL for orders Amazon hasn't finalized.
order_sales AS (
  SELECT
    f.order_id,
    f.created_local,
    f.marketplace_id,
    f.marketplace_name,
    f.fulfillment_status,
    f.fulfilled_by,
    f.company_id,
    f.seller_id,
    SUM(
      COALESCE(
        element_at(FILTER(oi.proceeds.breakdowns, b -> b.type = 'ITEM'), 1).subtotal.amount,
        oi.product.price.unit_price.amount * oi.quantity_ordered
      )
      + COALESCE(element_at(FILTER(oi.proceeds.breakdowns, b -> b.type = 'SHIPPING'), 1).subtotal.amount, 0.0)
    ) AS order_total,
    ARBITRARY(
      COALESCE(
        element_at(FILTER(oi.proceeds.breakdowns, b -> b.type = 'ITEM'), 1).subtotal.currency_code,
        oi.product.price.unit_price.currency_code
      )
    ) AS currency
  FROM filtered f
  CROSS JOIN UNNEST(f.order_items) AS t(oi)
  GROUP BY
    f.order_id, f.created_local, f.marketplace_id, f.marketplace_name,
    f.fulfillment_status, f.fulfilled_by, f.company_id, f.seller_id
),

-- ── 2b. Per-company main reporting currency + FX validity ranges ────────────
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

-- ── 3. Bucket by period + convert to main currency at the order's local date ─
--   order_total_main = order_total * rate(native) / rate(main)
bucketed AS (
  SELECT
    CAST(
      CASE p.granularity
        WHEN 'week'  THEN DATE_TRUNC('week',  CAST(f.created_local AS DATE))
        WHEN 'month' THEN DATE_TRUNC('month', CAST(f.created_local AS DATE))
        ELSE              DATE_TRUNC('day',   CAST(f.created_local AS DATE))
      END
    AS VARCHAR)                       AS period_start,
    f.marketplace_id,
    f.currency,
    cm.main_currency,
    f.company_id,
    f.order_id,
    f.order_total,
    f.order_total * fxn.rate / NULLIF(fxm.rate, 0.0) AS order_total_main,
    f.fulfillment_status,
    f.fulfilled_by
  FROM order_sales f
  CROSS JOIN params p
  LEFT JOIN company_main cm ON cm.company_id = TRY_CAST(f.company_id AS BIGINT)
  LEFT JOIN fx fxn
    ON fxn.currency = f.currency
   AND CAST(f.created_local AS DATE) >= fxn.from_date
   AND CAST(f.created_local AS DATE) <  fxn.to_date
  LEFT JOIN fx fxm
    ON fxm.currency = cm.main_currency
   AND CAST(f.created_local AS DATE) >= fxm.from_date
   AND CAST(f.created_local AS DATE) <  fxm.to_date
),

-- ── 4. Aggregate ───────────────────────────────────────────────────────────
agg AS (
  SELECT
    period_start,
    marketplace_id,
    COALESCE(currency, 'UNKNOWN')                 AS currency,
    MAX(main_currency)                            AS main_currency,
    company_id,
    COUNT(DISTINCT order_id)                       AS orders,
    ROUND(SUM(order_total), 2)                     AS gross_revenue,
    ROUND(SUM(order_total_main), 2)                AS gross_revenue_main,
    ROUND(
      SUM(order_total) / NULLIF(COUNT(DISTINCT order_id), 0),
      2
    )                                              AS avg_order_value,
    ROUND(
      SUM(order_total_main) / NULLIF(COUNT(DISTINCT order_id), 0),
      2
    )                                              AS avg_order_value_main,
    COUNT(CASE WHEN fulfillment_status = 'SHIPPED'   THEN 1 END) AS shipped_count,
    COUNT(CASE WHEN fulfillment_status = 'PENDING'   THEN 1 END) AS pending_count,
    COUNT(CASE WHEN fulfillment_status = 'CANCELED'  THEN 1 END) AS canceled_count,
    COUNT(CASE WHEN fulfilled_by = 'AMAZON'          THEN 1 END) AS fba_count,
    COUNT(CASE WHEN fulfilled_by != 'AMAZON'
               AND fulfilled_by IS NOT NULL         THEN 1 END) AS fbm_count
  FROM bucketed
  GROUP BY period_start, marketplace_id, currency, company_id
)

SELECT
  period_start,
  marketplace_id,
  currency,
  main_currency,
  company_id,
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
