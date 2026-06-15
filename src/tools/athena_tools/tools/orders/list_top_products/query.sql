-- Tool: customer_orders_list_top_performance_on_amazon
-- Source: sp_api_iceberg.orders_v2026
-- Revenue: order_items[].proceeds.proceeds_total.amount (item-level)
-- Dedup: latest last_updated_time per order_id + company_id

WITH params AS (
  SELECT
    {{company_ids_array}}               AS company_ids,
    {{asins_array}}                     AS asins,
    {{skus_array}}                      AS skus,
    {{marketplaces_array}}              AS marketplaces,
    {{order_statuses_array}}            AS order_statuses,
    {{start_date_sql}}                  AS start_date,
    {{end_date_sql}}                    AS end_date,
    CAST({{periods_back}} AS INTEGER)   AS periods_back,
    CAST({{min_orders}} AS INTEGER)     AS min_orders
),

-- ── 1. Dedup: latest snapshot per order ───────────────────────────────────
latest AS (
  SELECT
    o.order_id,
    o.created_time,
    o.sales_channel.marketplace_id          AS marketplace_id,
    o.fulfillment.fulfillment_status        AS fulfillment_status,
    o.company_id,
    o.order_items,
    ROW_NUMBER() OVER (
      PARTITION BY o.order_id, o.company_id
      ORDER BY o.last_updated_time DESC
    ) AS rn
  FROM "{{catalog}}"."sp_api_iceberg"."orders_v2026" o
  CROSS JOIN params p
  WHERE
    contains(p.company_ids, CAST(o.company_id AS BIGINT))
    AND o.date_month >= DATE_FORMAT(
      DATE_ADD('month', -(p.periods_back + 1), CURRENT_DATE), '%Y-%m'
    )
),

-- ── 2. Apply order-level filters + date window ────────────────────────────
filtered_orders AS (
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
),

-- ── 3. Unnest order_items ──────────────────────────────────────────────────
items AS (
  SELECT
    fo.order_id,
    fo.created_time,
    fo.marketplace_id,
    fo.company_id,
    oi.product.asin                                         AS asin,
    oi.product.seller_sku                                   AS seller_sku,
    oi.product.title                                        AS title,
    COALESCE(oi.quantity_ordered, 0)                        AS quantity_ordered,
    COALESCE(oi.proceeds.proceeds_total.amount, 0.0)        AS item_revenue,
    oi.proceeds.proceeds_total.currency_code                AS currency
  FROM filtered_orders fo
  CROSS JOIN UNNEST(fo.order_items) AS t(oi)
  CROSS JOIN params p
  WHERE
    (cardinality(p.asins) = 0 OR contains(p.asins, oi.product.asin))
    AND (cardinality(p.skus)  = 0 OR contains(p.skus,  oi.product.seller_sku))
),

-- ── 4. Aggregate per product ───────────────────────────────────────────────
agg AS (
  SELECT
    asin,
    seller_sku,
    MAX(title)                                  AS title,
    marketplace_id,
    COALESCE(currency, 'UNKNOWN')               AS currency,
    company_id,
    COUNT(DISTINCT order_id)                    AS orders,
    SUM(quantity_ordered)                       AS units_ordered,
    ROUND(SUM(item_revenue), 2)                 AS gross_revenue,
    ROUND(
      SUM(item_revenue) / NULLIF(SUM(quantity_ordered), 0),
      2
    )                                           AS avg_unit_price,
    MIN(CAST(created_time AS DATE))             AS first_order_date,
    MAX(CAST(created_time AS DATE))             AS last_order_date
  FROM items
  GROUP BY asin, seller_sku, marketplace_id, currency, company_id
),

-- ── 5. Rank within each marketplace × currency × company group ────────────
ranked AS (
  SELECT
    agg.*,
    ROW_NUMBER() OVER (
      PARTITION BY agg.marketplace_id, agg.currency, agg.company_id
      ORDER BY
        CASE '{{sort_column}}'
          WHEN 'gross_revenue'  THEN agg.gross_revenue
          WHEN 'orders'         THEN CAST(agg.orders AS DOUBLE)
          WHEN 'units_ordered'  THEN CAST(agg.units_ordered AS DOUBLE)
          ELSE agg.gross_revenue
        END
        {{sort_direction}}
    ) AS rank
  FROM agg
  CROSS JOIN params p
  WHERE agg.orders >= p.min_orders
)

SELECT
  rank,
  asin,
  seller_sku,
  title,
  marketplace_id,
  currency,
  company_id,
  orders,
  units_ordered,
  gross_revenue,
  avg_unit_price,
  first_order_date,
  last_order_date
FROM ranked
WHERE rank <= {{limit_top_n}}
ORDER BY company_id, marketplace_id, currency, rank
