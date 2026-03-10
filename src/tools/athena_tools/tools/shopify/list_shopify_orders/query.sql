-- Tool: shopify_list_orders (detail mode)
-- Purpose: List Shopify orders with line items, fulfillment events, seller, and warehouse details.
-- Data sources:
--   shopify_orders        O    (order header: amounts, statuses, dates)
--   shopify_sellers       SL   ON SL.id = O.seller_id  (seller name, domain, status; provides company_id)
--   shopify_order_items   OI   ON OI.order_id = O.id   (line items: sku, quantity, amount)
--   shopify_order_events  OE   ON OE.order_id = O.id AND OE.item_id = OI.id  (events: fulfillment, refund, etc.)
--   inventory_warehouses  W    ON W.id = OE.warehouse_id  (warehouse name)
--   app_companies         C    ON C.id = SL.company_id    (company name)

WITH params AS (
  SELECT
    {{limit_top_n}} AS top_results,

    -- REQUIRED (authorization)
    {{company_ids_array}} AS company_ids,

    -- OPTIONAL filters
    {{order_names_array}} AS order_names,
    {{order_names_lower_array}} AS order_names_lower,
    {{skus_array}} AS skus,
    {{skus_lower_array}} AS skus_lower,
    {{seller_names_array}} AS seller_names,
    {{seller_names_lower_array}} AS seller_names_lower,
    {{financial_statuses_array}} AS financial_statuses,
    {{financial_statuses_lower_array}} AS financial_statuses_lower,
    {{fulfillment_statuses_array}} AS fulfillment_statuses,
    {{fulfillment_statuses_lower_array}} AS fulfillment_statuses_lower,
    {{event_types_array}} AS event_types,
    {{event_types_lower_array}} AS event_types_lower,
    {{event_statuses_array}} AS event_statuses,
    {{event_statuses_lower_array}} AS event_statuses_lower,
    {{currencies_array}} AS currencies,
    {{currencies_lower_array}} AS currencies_lower,
    {{warehouse_names_array}} AS warehouse_names,
    {{warehouse_names_lower_array}} AS warehouse_names_lower,
    {{inventory_ids_array}} AS inventory_ids,

    -- Date range
    {{date_from_sql}} AS date_from,
    {{date_to_sql}} AS date_to
),

-- Detail: one row per order-item-event combination
t_base AS (
  SELECT
    -- Company
    sl.company_id,
    c.name AS company_name,

    -- Order header
    o.id AS order_id,
    o.shopify_id AS order_shopify_id,
    o.name AS order_name,
    CAST(o.subtotal_amount AS DOUBLE) AS subtotal_amount,
    CAST(o.total_amount AS DOUBLE) AS total_amount,
    o.currency AS order_currency,
    o.financial_status,
    o.fulfillment_status,
    CAST(o.shopify_created_at AS VARCHAR) AS order_created_at,
    CAST(o.shopify_updated_at AS VARCHAR) AS order_updated_at,
    CAST(o.closed_at AS VARCHAR) AS order_closed_at,
    CAST(o.cancelled_at AS VARCHAR) AS order_cancelled_at,
    o.cancel_reason,

    -- Seller
    o.seller_id,
    sl.name AS seller_name,
    sl.status AS store_status,
    sl.domain AS store_domain,
    sl.state AS connection_state,

    -- Line item
    oi.id AS item_id,
    oi.inventory_id,
    oi.quantity AS item_quantity,
    CAST(oi.amount AS DOUBLE) AS item_amount,
    oi.currency AS item_currency,
    oi.shopify_item_id,
    oi.shopify_variant_id,
    oi.shopify_product_id,
    oi.title AS item_title,
    oi.sku,
    oi.barcode,

    -- Event
    oe.id AS event_id,
    oe.event AS event_type,
    oe.status AS event_status,
    oe.quantity AS event_quantity,
    CAST(oe.amount AS DOUBLE) AS event_amount,
    oe.currency AS event_currency,
    oe.warehouse_id,
    w.name AS warehouse_name,
    CAST(oe.shopify_created_at AS VARCHAR) AS event_shopify_created_at

  FROM "{{catalog}}"."neonpanel_iceberg"."shopify_orders" o
  CROSS JOIN params p

  INNER JOIN "{{catalog}}"."neonpanel_iceberg"."shopify_sellers" sl
    ON sl.id = o.seller_id

  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."app_companies" c
    ON c.id = sl.company_id

  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."shopify_order_items" oi
    ON oi.order_id = o.id

  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."shopify_order_events" oe
    ON oe.order_id = o.id
    AND oe.item_id = oi.id

  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."inventory_warehouses" w
    ON w.id = oe.warehouse_id

  WHERE
    -- REQUIRED: company authorization
    contains(p.company_ids, sl.company_id)

    -- Date range on order creation
    AND (p.date_from IS NULL OR CAST(o.shopify_created_at AS DATE) >= CAST(p.date_from AS DATE))
    AND (p.date_to   IS NULL OR CAST(o.shopify_created_at AS DATE) <= CAST(p.date_to   AS DATE))

    -- Optional filters (case-insensitive)
    AND (
      cardinality(p.order_names) = 0
      OR contains(p.order_names_lower, lower(trim(o.name)))
    )
    AND (
      cardinality(p.skus) = 0
      OR contains(p.skus, oi.sku)
      OR contains(p.skus_lower, lower(trim(oi.sku)))
    )
    AND (
      cardinality(p.seller_names) = 0
      OR contains(p.seller_names_lower, lower(trim(sl.name)))
    )
    AND (
      cardinality(p.financial_statuses) = 0
      OR contains(p.financial_statuses_lower, lower(trim(o.financial_status)))
    )
    AND (
      cardinality(p.fulfillment_statuses) = 0
      OR contains(p.fulfillment_statuses_lower, lower(trim(o.fulfillment_status)))
    )
    AND (
      cardinality(p.event_types) = 0
      OR contains(p.event_types_lower, lower(trim(oe.event)))
    )
    AND (
      cardinality(p.event_statuses) = 0
      OR contains(p.event_statuses_lower, lower(trim(oe.status)))
    )
    AND (
      cardinality(p.currencies) = 0
      OR contains(p.currencies_lower, lower(trim(o.currency)))
    )
    AND (
      cardinality(p.warehouse_names) = 0
      OR contains(p.warehouse_names_lower, lower(trim(w.name)))
    )
    AND (cardinality(p.inventory_ids) = 0 OR contains(p.inventory_ids, oi.inventory_id))
)

-- Detail output
SELECT
  t.company_id,
  t.company_name,

  t.order_id,
  t.order_shopify_id,
  t.order_name,
  t.subtotal_amount,
  t.total_amount,
  t.order_currency,
  t.financial_status,
  t.fulfillment_status,
  t.order_created_at,
  t.order_updated_at,
  t.order_closed_at,
  t.order_cancelled_at,
  t.cancel_reason,

  t.seller_id,
  t.seller_name,
  t.store_status,
  t.store_domain,
  t.connection_state,

  t.item_id,
  t.inventory_id,
  t.item_quantity,
  t.item_amount,
  t.item_currency,
  t.shopify_item_id,
  t.shopify_variant_id,
  t.shopify_product_id,
  t.item_title,
  t.sku,
  t.barcode,

  t.event_id,
  t.event_type,
  t.event_status,
  t.event_quantity,
  t.event_amount,
  t.event_currency,
  t.warehouse_id,
  t.warehouse_name,
  t.event_shopify_created_at

FROM t_base t

ORDER BY
  t.order_created_at DESC,
  t.order_id DESC,
  t.item_id,
  t.event_id

LIMIT {{limit_top_n}}
