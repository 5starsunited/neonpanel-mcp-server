-- Tool: customer_orders_analyze_amazon_sales_performance
-- Source: sp_api_iceberg.orders_v2026
-- Revenue: proceeds.grand_total.amount (order-level)
-- Dedup: latest last_updated_time per order_id + company_id

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
    o.created_time,
    o.last_updated_time,
    o.sales_channel.marketplace_id                  AS marketplace_id,
    o.sales_channel.marketplace_name                AS marketplace_name,
    o.fulfillment.fulfillment_status                AS fulfillment_status,
    o.fulfillment.fulfilled_by                      AS fulfilled_by,
    COALESCE(o.proceeds.grand_total.amount, 0.0)    AS order_total,
    o.proceeds.grand_total.currency_code            AS currency,
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
      OR CAST(l.created_time AS DATE) >= p.start_date
    )
    AND (
      p.end_date IS NULL
      OR CAST(l.created_time AS DATE) <= p.end_date
    )
    AND (
      p.start_date IS NOT NULL
      OR CAST(l.created_time AS DATE) >= DATE_ADD('month', -p.periods_back, CURRENT_DATE)
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

-- ── 3. Bucket by period ────────────────────────────────────────────────────
bucketed AS (
  SELECT
    CAST(
      CASE p.granularity
        WHEN 'week'  THEN DATE_TRUNC('week',  CAST(f.created_time AS DATE))
        WHEN 'month' THEN DATE_TRUNC('month', CAST(f.created_time AS DATE))
        ELSE              DATE_TRUNC('day',   CAST(f.created_time AS DATE))
      END
    AS VARCHAR)                       AS period_start,
    f.marketplace_id,
    f.currency,
    f.company_id,
    f.order_id,
    f.order_total,
    f.fulfillment_status,
    f.fulfilled_by
  FROM filtered f
  CROSS JOIN params p
),

-- ── 4. Aggregate ───────────────────────────────────────────────────────────
agg AS (
  SELECT
    period_start,
    marketplace_id,
    COALESCE(currency, 'UNKNOWN')                 AS currency,
    company_id,
    COUNT(DISTINCT order_id)                       AS orders,
    ROUND(SUM(order_total), 2)                     AS gross_revenue,
    ROUND(
      SUM(order_total) / NULLIF(COUNT(DISTINCT order_id), 0),
      2
    )                                              AS avg_order_value,
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
  company_id,
  orders,
  gross_revenue,
  avg_order_value,
  shipped_count,
  pending_count,
  canceled_count,
  fba_count,
  fbm_count
FROM agg
ORDER BY period_start DESC, marketplace_id, currency
LIMIT {{limit_top_n}}
