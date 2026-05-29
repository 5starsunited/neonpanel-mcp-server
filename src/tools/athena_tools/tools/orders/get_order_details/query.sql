-- Tool: orders_get_order_details
-- Source: sp_api_iceberg.orders_v2026
-- Returns: one row per order-item for the requested order_id

WITH latest AS (
  SELECT
    o.*,
    ROW_NUMBER() OVER (
      PARTITION BY o.order_id, o.company_id
      ORDER BY o.last_updated_time DESC
    ) AS rn
  FROM "{{catalog}}"."sp_api_iceberg"."orders_v2026" o
  WHERE
    o.company_id = {{company_id_str}}
    AND o.order_id = {{order_id_str}}
),

order_head AS (
  SELECT * FROM latest WHERE rn = 1
),

items AS (
  SELECT
    h.order_id,
    DATE_FORMAT(h.created_time    AT TIME ZONE 'UTC', '%Y-%m-%dT%H:%i:%sZ') AS created_time,
    DATE_FORMAT(h.last_updated_time AT TIME ZONE 'UTC', '%Y-%m-%dT%H:%i:%sZ') AS last_updated_time,
    h.sales_channel.marketplace_id                         AS marketplace_id,
    h.sales_channel.marketplace_name                       AS marketplace_name,
    h.fulfillment.fulfillment_status                       AS fulfillment_status,
    h.fulfillment.fulfilled_by                             AS fulfilled_by,
    h.fulfillment.fulfillment_service_level                AS service_level,
    DATE_FORMAT(h.fulfillment.ship_by_window.earliest_date_time AT TIME ZONE 'UTC', '%Y-%m-%dT%H:%i:%sZ') AS ship_by_earliest,
    DATE_FORMAT(h.fulfillment.ship_by_window.latest_date_time   AT TIME ZONE 'UTC', '%Y-%m-%dT%H:%i:%sZ') AS ship_by_latest,
    h.proceeds.grand_total.amount                          AS order_total,
    h.proceeds.grand_total.currency_code                   AS order_currency,
    h.company_id,
    h.seller_id,
    -- item-level fields
    oi.order_item_id,
    oi.product.asin                                        AS asin,
    oi.product.seller_sku                                  AS seller_sku,
    oi.product.title                                       AS title,
    oi.product.price.unit_price.amount                     AS unit_list_price,
    oi.product.price.unit_price.currency_code              AS list_price_currency,
    oi.quantity_ordered,
    oi.fulfillment.quantity_fulfilled,
    oi.fulfillment.quantity_unfulfilled,
    oi.proceeds.proceeds_total.amount                      AS proceeds_total,
    oi.proceeds.proceeds_total.currency_code               AS proceeds_currency,
    -- promotion IDs as comma-separated string
    ARRAY_JOIN(
      transform(
        COALESCE(oi.promotion.breakdowns, CAST(ARRAY[] AS ARRAY(ROW(promotion_id VARCHAR)))),
        x -> x.promotion_id
      ),
      ','
    )                                                       AS promotion_ids
  FROM order_head h
  CROSS JOIN UNNEST(h.order_items) AS t(oi)
)

SELECT *
FROM items
ORDER BY order_item_id
