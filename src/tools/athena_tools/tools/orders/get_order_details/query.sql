-- Tool: customer_orders_get_amazon_customer_order_details
-- Source: ClickHouse analytics.order_details_v2026 (item grain; latest generation selected inline, see below)
-- Returns: one row per order-item for the requested order_id.
-- Not available in the ClickHouse source (returned as NULL): promotion_ids.
-- Mapping: unit_list_price = principal / ordered_quantity; quantity_fulfilled = shipped_quantity;
--   proceeds_total = principal + shipping (item level), currency from the principal.

SELECT
  o.amazon_order_id                                                           AS order_id,
  formatDateTime(o.purchase_date, '%Y-%m-%dT%H:%i:%SZ', 'UTC')                AS created_time,
  formatDateTime(o.last_updated_date, '%Y-%m-%dT%H:%i:%SZ', 'UTC')            AS last_updated_time,
  o.amazon_marketplace_id                                                     AS marketplace_id,
  o.sales_channel                                                             AS marketplace_name,
  multiIf(o.order_status = 'Shipped', 'SHIPPED',
          o.order_status = 'PartiallyShipped', 'PARTIALLY_SHIPPED',
          o.order_status = 'PendingAvailability', 'PENDING_AVAILABILITY',
          upper(o.order_status))                                              AS fulfillment_status,
  if(o.fulfillment_channel = 'AFN', 'AMAZON', if(o.fulfillment_channel = 'MFN', 'MERCHANT', NULL)) AS fulfilled_by,
  nullIf(o.ship_service_level, '')                                            AS service_level,
  formatDateTime(o.earliest_ship_date, '%Y-%m-%dT%H:%i:%SZ', 'UTC')           AS ship_by_earliest,
  formatDateTime(o.latest_ship_date, '%Y-%m-%dT%H:%i:%SZ', 'UTC')             AS ship_by_latest,
  toFloat64(o.order_total)                                                    AS order_total,
  o.order_total_currency                                                      AS order_currency,
  toString(o.company_id)                                                      AS company_id,
  o.seller_id                                                                 AS seller_id,
  o.order_item_id                                                             AS order_item_id,
  nullIf(o.asin, '')                                                          AS asin,
  nullIf(o.sku, '')                                                           AS seller_sku,
  nullIf(o.product_name, '')                                                  AS title,
  if(o.ordered_quantity > 0, toFloat64(o.principal) / o.ordered_quantity, NULL) AS unit_list_price,
  o.principal_currency                                                        AS list_price_currency,
  o.ordered_quantity                                                          AS quantity_ordered,
  o.shipped_quantity                                                          AS quantity_fulfilled,
  greatest(o.ordered_quantity - o.shipped_quantity, 0)                        AS quantity_unfulfilled,
  if(isNull(o.principal) AND isNull(o.shipping), NULL,
     toFloat64(coalesce(o.principal, 0)) + toFloat64(coalesce(o.shipping, 0))) AS proceeds_total,
  coalesce(o.principal_currency, o.shipping_currency)                         AS proceeds_currency,
  CAST(NULL AS Nullable(String))                                              AS promotion_ids
FROM analytics.order_details_v2026 AS o
WHERE o.company_id = {{company_id}}
  AND o.amazon_order_id = {{order_id_str}}
-- Same latest-generation semantics as analytics.order_details_v2026_current, applied after the
-- single-order filter (the view's window would otherwise scan the whole company history).
QUALIFY (coalesce(o.last_updated_date, toDateTime64(0, 3, 'UTC')), o.updated_at)
        = max((coalesce(o.last_updated_date, toDateTime64(0, 3, 'UTC')), o.updated_at)) OVER ()
    AND o.is_deleted = 0
ORDER BY o.order_item_id
