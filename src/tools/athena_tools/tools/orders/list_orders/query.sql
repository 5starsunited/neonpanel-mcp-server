-- Tool: orders_list_orders
-- Source: sp_api_iceberg.orders_v2026
-- Returns one flattened row per order (no item expansion)
-- Dedup: latest last_updated_time per order_id + company_id

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
    CAST({{periods_back}} AS INTEGER)   AS periods_back
),

-- ── 1. Dedup ───────────────────────────────────────────────────────────────
latest AS (
  SELECT
    o.order_id,
    o.created_time,
    o.last_updated_time,
    o.sales_channel.marketplace_id              AS marketplace_id,
    o.sales_channel.marketplace_name            AS marketplace_name,
    o.fulfillment.fulfillment_status            AS fulfillment_status,
    o.fulfillment.fulfilled_by                  AS fulfilled_by,
    o.fulfillment.fulfillment_service_level     AS service_level,
    o.fulfillment.ship_by_window.earliest_date_time AS ship_by_earliest,
    o.fulfillment.ship_by_window.latest_date_time   AS ship_by_latest,
    o.proceeds.grand_total.amount               AS order_total,
    o.proceeds.grand_total.currency_code        AS currency,
    CARDINALITY(o.order_items)                  AS item_count,
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
      cardinality(p.order_ids) > 0
      OR o.date_month >= DATE_FORMAT(
           DATE_ADD('month', -(p.periods_back + 1), CURRENT_DATE), '%Y-%m'
         )
    )
    AND (
      cardinality(p.order_ids) = 0
      OR contains(p.order_ids, o.order_id)
    )
),

-- ── 2. Filter ──────────────────────────────────────────────────────────────
filtered AS (
  SELECT l.*
  FROM latest l
  CROSS JOIN params p
  WHERE l.rn = 1
    AND (
      cardinality(p.order_ids) > 0
      OR (
        (
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
    AND (
      cardinality(p.seller_ids) = 0
      OR contains(p.seller_ids, l.seller_id)
    )
)

SELECT
  order_id,
  CAST(created_time AS VARCHAR)       AS created_time,
  CAST(last_updated_time AS VARCHAR)  AS last_updated_time,
  marketplace_id,
  marketplace_name,
  fulfillment_status,
  fulfilled_by,
  service_level,
  CAST(ship_by_earliest AS VARCHAR)   AS ship_by_earliest,
  CAST(ship_by_latest AS VARCHAR)     AS ship_by_latest,
  order_total,
  currency,
  item_count,
  company_id,
  seller_id
FROM filtered
ORDER BY created_time DESC
LIMIT {{limit_top_n}}
