-- Tool: customer_orders_list_top_performance_on_amazon
-- Source: ClickHouse analytics.order_details_v2026_current (item grain, latest generation per order)
-- Revenue: item principal + shipping (the item-level `proceeds_total` of the old Athena source is no
--   longer available; principal + shipping matches the "Sales" definition of the other order tools).

WITH params AS (
  SELECT
    {{company_ids_array}}               AS company_ids,
    {{asins_array}}                     AS asins,
    {{skus_array}}                      AS skus,
    {{marketplaces_array}}              AS marketplaces,
    {{order_statuses_array}}            AS order_statuses,
    {{start_date_sql}}                  AS start_date,
    {{end_date_sql}}                    AS end_date,
    toInt32({{periods_back}})           AS periods_back,
    toInt32({{min_orders}})             AS min_orders
),

-- ── 1. Item scan with order-level and product filters ──────────────────────
items AS (
  SELECT
    o.amazon_order_id                                       AS order_id,
    o.purchase_date                                         AS created_time,
    o.amazon_marketplace_id                                 AS marketplace_id,
    o.company_id                                            AS company_id,
    o.asin                                                  AS asin,
    o.sku                                                   AS seller_sku,
    o.product_name                                          AS title,
    toInt64(greatest(o.ordered_quantity, 0))                AS quantity_ordered,
    toFloat64(coalesce(o.principal, 0)) + toFloat64(coalesce(o.shipping, 0)) AS item_revenue,
    coalesce(o.principal_currency, o.shipping_currency, o.order_total_currency) AS currency
  FROM analytics.order_details_v2026_current AS o
  CROSS JOIN params AS p
  WHERE has(p.company_ids, o.company_id)
    AND o.purchase_date IS NOT NULL
    AND o.purchase_month >= formatDateTime(
          addMonths(coalesce(p.start_date, toDate(now())),
                    -if(isNull(p.start_date), p.periods_back + 1, 1)), '%Y-%m')
    AND (isNull(p.start_date) OR toDate(o.purchase_date) >= p.start_date)
    AND (isNull(p.end_date)   OR toDate(o.purchase_date) <= p.end_date)
    AND (isNotNull(p.start_date) OR toDate(o.purchase_date) >= addMonths(toDate(now()), -p.periods_back))
    AND (empty(p.marketplaces) OR has(p.marketplaces, o.amazon_marketplace_id))
    AND (empty(p.order_statuses) OR has(p.order_statuses,
          multiIf(o.order_status = 'Shipped', 'SHIPPED',
                  o.order_status = 'PartiallyShipped', 'PARTIALLY_SHIPPED',
                  o.order_status = 'PendingAvailability', 'PENDING_AVAILABILITY',
                  upper(o.order_status))))
    AND (empty(p.asins) OR has(p.asins, o.asin))
    AND (empty(p.skus)  OR has(p.skus, o.sku))
),

-- ── 2. Aggregate per product ───────────────────────────────────────────────
agg AS (
  SELECT
    asin,
    seller_sku,
    max(title)                                  AS title,
    marketplace_id,
    coalesce(currency, 'UNKNOWN')               AS currency,
    company_id,
    uniqExact(order_id)                         AS orders,
    sum(quantity_ordered)                       AS units_ordered,
    round(sum(item_revenue), 2)                 AS gross_revenue,
    round(sum(item_revenue) / nullIf(sum(quantity_ordered), 0), 2) AS avg_unit_price,
    min(toDate(created_time))                   AS first_order_date,
    max(toDate(created_time))                   AS last_order_date
  FROM items
  GROUP BY asin, seller_sku, marketplace_id, currency, company_id
),

-- ── 3. Rank within each marketplace x currency x company group ─────────────
ranked AS (
  SELECT
    agg.*,
    row_number() OVER (
      PARTITION BY agg.marketplace_id, agg.currency, agg.company_id
      ORDER BY
        multiIf('{{sort_column}}' = 'orders', toFloat64(agg.orders),
                '{{sort_column}}' = 'units_ordered', toFloat64(agg.units_ordered),
                toFloat64(agg.gross_revenue))
        {{sort_direction}}
    ) AS rank
  FROM agg
  CROSS JOIN params AS p
  WHERE agg.orders >= p.min_orders
)

SELECT
  rank,
  asin,
  seller_sku,
  title,
  marketplace_id,
  currency,
  toString(company_id) AS company_id,
  orders,
  units_ordered,
  gross_revenue,
  avg_unit_price,
  toString(first_order_date) AS first_order_date,
  toString(last_order_date)  AS last_order_date
FROM ranked
WHERE rank <= {{limit_top_n}}
ORDER BY company_id, marketplace_id, currency, rank
