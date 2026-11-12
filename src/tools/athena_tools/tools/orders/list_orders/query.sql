-- Tool: customer_orders_list_amazon_customer_orders
-- Source: ClickHouse analytics.order_details_v2026_current (item grain, latest generation per order)
-- Returns one flattened row per order (no item expansion); item_count = number of item rows.
-- Fields no longer available after the Athena -> ClickHouse move: none removed; `ship_by_*` come from
-- earliest_ship_date / latest_ship_date, `service_level` from ship_service_level.

WITH params AS (
  SELECT
    {{company_ids_array}}               AS company_ids,
    {{order_ids_array}}                 AS order_ids,
    {{marketplaces_array}}              AS marketplaces,
    {{order_statuses_array}}            AS order_statuses,
    {{fulfillment_channels_array}}      AS fulfillment_channels,
    {{seller_ids_array}}                AS seller_ids,
    {{start_date_sql}}                  AS start_date,
    {{end_date_sql}}                    AS end_date,
    toInt32({{periods_back}})           AS periods_back
),

-- ── 1. Item scan (partition-pruned unless specific order ids are requested) ─
orders AS (
  SELECT
    o.amazon_order_id                                   AS order_id,
    o.company_id                                        AS company_id,
    any(o.seller_id)                                    AS seller_id,
    min(o.purchase_date)                                AS created_time,
    max(o.last_updated_date)                            AS last_updated_time,
    any(o.amazon_marketplace_id)                        AS marketplace_id,
    any(o.sales_channel)                                AS marketplace_name,
    any(multiIf(o.order_status = 'Shipped', 'SHIPPED',
                o.order_status = 'PartiallyShipped', 'PARTIALLY_SHIPPED',
                o.order_status = 'PendingAvailability', 'PENDING_AVAILABILITY',
                upper(o.order_status)))                 AS fulfillment_status,
    any(o.fulfillment_channel)                          AS fulfillment_channel,
    any(nullIf(o.ship_service_level, ''))               AS service_level,
    min(o.earliest_ship_date)                           AS ship_by_earliest,
    max(o.latest_ship_date)                             AS ship_by_latest,
    max(o.order_total)                                  AS order_total,
    anyIf(o.order_total_currency, isNotNull(o.order_total_currency)) AS currency,
    count()                                             AS item_count
  FROM analytics.order_details_v2026_current AS o
  CROSS JOIN params AS p
  WHERE has(p.company_ids, o.company_id)
    AND (empty(p.order_ids) OR has(p.order_ids, o.amazon_order_id))
    AND (
      notEmpty(p.order_ids)
      OR o.purchase_month >= formatDateTime(
           addMonths(coalesce(p.start_date, toDate(now())),
                     -if(isNull(p.start_date), p.periods_back + 1, 1)), '%Y-%m')
    )
  GROUP BY o.company_id, o.amazon_order_id
)

SELECT
  order_id,
  formatDateTime(created_time, '%Y-%m-%dT%H:%i:%SZ', 'UTC')       AS created_time,
  formatDateTime(last_updated_time, '%Y-%m-%dT%H:%i:%SZ', 'UTC')  AS last_updated_time,
  marketplace_id,
  marketplace_name,
  fulfillment_status,
  if(fulfillment_channel = 'AFN', 'AMAZON', if(fulfillment_channel = 'MFN', 'MERCHANT', NULL)) AS fulfilled_by,
  service_level,
  formatDateTime(ship_by_earliest, '%Y-%m-%dT%H:%i:%SZ', 'UTC')   AS ship_by_earliest,
  formatDateTime(ship_by_latest, '%Y-%m-%dT%H:%i:%SZ', 'UTC')     AS ship_by_latest,
  toFloat64(order_total)                                          AS order_total,
  currency,
  item_count,
  toString(company_id)                                            AS company_id,
  seller_id
FROM orders AS f
CROSS JOIN params AS p
WHERE (
    notEmpty(p.order_ids)
    OR (
      (isNull(p.start_date) OR toDate(f.created_time) >= p.start_date)
      AND (isNull(p.end_date) OR toDate(f.created_time) <= p.end_date)
      AND (isNotNull(p.start_date) OR toDate(f.created_time) >= addMonths(toDate(now()), -p.periods_back))
    )
  )
  AND (empty(p.marketplaces) OR has(p.marketplaces, f.marketplace_id))
  AND (empty(p.order_statuses) OR has(p.order_statuses, f.fulfillment_status))
  AND (empty(p.fulfillment_channels) OR has(p.fulfillment_channels, if(f.fulfillment_channel = 'AFN', 'AFN', 'MFN')))
  AND (empty(p.seller_ids) OR has(p.seller_ids, f.seller_id))
ORDER BY f.created_time DESC
LIMIT {{limit_top_n}}
