-- Tool: shopify_list_orders (grouped/aggregated mode)
-- Purpose: Aggregated view of Shopify orders with events, grouped by caller-specified dimensions.
-- Notes:
--   - Dimensions injected via template variables (group_select_base, group_by_clause_base)
--   - company_id always included in GROUP BY for authorization

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

t_base AS (
  SELECT
    sl.company_id,
    c.name AS company_name,

    o.id AS order_id,
    o.name AS order_name,
    CAST(o.subtotal_amount AS DOUBLE) AS subtotal_amount,
    CAST(o.total_amount AS DOUBLE) AS total_amount,
    o.currency AS order_currency,
    o.financial_status,
    o.fulfillment_status,
    o.shopify_created_at AS order_created_at,

    o.seller_id,
    sl.name AS seller_name,
    sl.status AS store_status,
    sl.domain AS store_domain,

    oi.id AS item_id,
    oi.inventory_id,
    oi.quantity AS item_quantity,
    CAST(oi.amount AS DOUBLE) AS item_amount,
    oi.sku,
    oi.title AS item_title,

    oe.event AS event_type,
    oe.status AS event_status,
    oe.quantity AS event_quantity,
    CAST(oe.amount AS DOUBLE) AS event_amount,
    oe.currency AS event_currency,
    w.name AS warehouse_name

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
    contains(p.company_ids, sl.company_id)

    AND (p.date_from IS NULL OR CAST(o.shopify_created_at AS DATE) >= CAST(p.date_from AS DATE))
    AND (p.date_to   IS NULL OR CAST(o.shopify_created_at AS DATE) <= CAST(p.date_to   AS DATE))

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
),

t_grouped AS (
  SELECT
    {{group_select_base}},

    COUNT(DISTINCT t.order_id) AS order_count,
    COUNT(DISTINCT t.item_id) AS line_item_count,
    COUNT(DISTINCT t.sku) AS distinct_skus,

    SUM(COALESCE(t.item_quantity, 0)) AS total_item_quantity,
    SUM(COALESCE(t.item_amount, 0.0)) AS total_item_amount,
    SUM(COALESCE(t.event_quantity, 0)) AS total_event_quantity,
    SUM(COALESCE(t.event_amount, 0.0)) AS total_event_amount,

    SUM(COALESCE(t.total_amount, 0.0)) AS total_order_amount,
    SUM(COALESCE(t.subtotal_amount, 0.0)) AS total_order_subtotal,

    MIN(CAST(t.order_created_at AS VARCHAR)) AS earliest_order_date,
    MAX(CAST(t.order_created_at AS VARCHAR)) AS latest_order_date

  FROM t_base t
  GROUP BY {{group_by_clause_base}}
)

SELECT g.*
FROM t_grouped g
ORDER BY g.total_order_amount DESC
LIMIT {{limit_top_n}}
