-- Tool: inventory_valuation_analyze_3pl_inventory
-- Purpose: Analyze actual/source inventory balances loaded from 3PL and marketplace systems.
-- Data source: neonpanel_iceberg.inventory_balances

WITH params AS (
  SELECT
    {{company_ids_array}} AS company_ids,
    {{skus_array}} AS skus,
    {{sources_array}} AS sources,
    {{statuses_array}} AS statuses,
    {{seller_ids_array}} AS seller_ids,
    {{inventory_ids_array}} AS inventory_ids,
    {{warehouse_ids_array}} AS warehouse_ids,
    {{warehouse_names_array}} AS warehouse_names,
    {{warehouse_names_lower_array}} AS warehouse_names_lower,
    {{date_from_sql}} AS date_from,
    {{date_to_sql}} AS date_to,
    {{snapshot_date_sql}} AS snapshot_date,
    {{periodicity_sql}} AS periodicity,
    {{group_by_fields_sql}} AS group_by_fields,
    {{sort_field_sql}} AS sort_field,
    {{sort_direction_sql}} AS sort_direction,
    {{limit_rows}} AS limit_rows
),

filtered_pre_date AS (
  SELECT
    ib.id AS balance_id,
    ib.uuid,
    ib.date AS balance_date,
    ib.seller_id,
    ib.inventory_id,
    ib.warehouse_id,
    w.name AS warehouse_name,
    ib.sku,
    ib.status,
    ib.balance_quantity,
    ib.source,
    ib.created_at,
    ib.updated_at,
    ib.company_id,
    c.name AS company_name,
    ib.partition_name
  FROM "{{catalog}}"."neonpanel_iceberg"."inventory_balances" ib
  CROSS JOIN params p
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."inventory_warehouses" w
    ON w.id = ib.warehouse_id
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."app_companies" c
    ON c.id = ib.company_id
  WHERE contains(p.company_ids, ib.company_id)
    AND (cardinality(p.skus) = 0 OR contains(p.skus, ib.sku))
    AND (cardinality(p.sources) = 0 OR contains(p.sources, lower(trim(CAST(ib.source AS VARCHAR)))))
    AND (cardinality(p.statuses) = 0 OR contains(p.statuses, lower(trim(CAST(ib.status AS VARCHAR)))))
    AND (cardinality(p.seller_ids) = 0 OR contains(p.seller_ids, ib.seller_id))
    AND (cardinality(p.inventory_ids) = 0 OR contains(p.inventory_ids, ib.inventory_id))
    AND (cardinality(p.warehouse_ids) = 0 OR contains(p.warehouse_ids, ib.warehouse_id))
    AND (
      cardinality(p.warehouse_names) = 0
      OR contains(p.warehouse_names_lower, lower(trim(w.name)))
    )
),

actual_balances AS (
  SELECT f.*
  FROM filtered_pre_date f
  CROSS JOIN params p
  WHERE
    (p.snapshot_date IS NOT NULL AND CAST(f.balance_date AS DATE) = CAST(p.snapshot_date AS DATE))
    OR (
      p.snapshot_date IS NULL
      AND (p.date_from IS NOT NULL OR p.date_to IS NOT NULL)
      AND (p.date_from IS NULL OR CAST(f.balance_date AS DATE) >= CAST(p.date_from AS DATE))
      AND (p.date_to IS NULL OR CAST(f.balance_date AS DATE) <= CAST(p.date_to AS DATE))
    )
    OR (
      p.snapshot_date IS NULL
      AND p.date_from IS NULL
      AND p.date_to IS NULL
      AND CAST(f.balance_date AS DATE) = (
        SELECT MAX(CAST(f2.balance_date AS DATE))
        FROM filtered_pre_date f2
        WHERE f2.company_id = f.company_id
      )
    )
),

aggregated_balances AS (
  SELECT
    p.periodicity,
    CASE
      WHEN p.periodicity = 'day' THEN CAST(ab.balance_date AS VARCHAR)
      WHEN p.periodicity = 'month' THEN FORMAT('%d-%02d', YEAR(ab.balance_date), MONTH(ab.balance_date))
      WHEN p.periodicity = 'year' THEN CAST(YEAR(ab.balance_date) AS VARCHAR)
      ELSE NULL
    END AS time_period,
    {{group_by_select_clause}}
    SUM(COALESCE(CAST(ab.balance_quantity AS BIGINT), 0)) AS balance_quantity,
    COUNT(*) AS record_count,
    COUNT(DISTINCT ab.inventory_id) AS distinct_inventory_items,
    COUNT(DISTINCT ab.sku) AS distinct_skus,
    COUNT(DISTINCT ab.warehouse_id) AS distinct_warehouses,
    COUNT(DISTINCT ab.source) AS distinct_sources,
    MIN(CAST(ab.balance_date AS VARCHAR)) AS earliest_balance_date,
    MAX(CAST(ab.balance_date AS VARCHAR)) AS latest_balance_date,
    MAX(CAST(ab.updated_at AS VARCHAR)) AS latest_updated_at
  FROM actual_balances ab
  CROSS JOIN params p
  GROUP BY {{group_by_clause}}
)

SELECT
  ag.time_period,
  {{select_dimensions}}
  ag.balance_quantity,
  ag.record_count,
  ag.distinct_inventory_items,
  ag.distinct_skus,
  ag.distinct_warehouses,
  ag.distinct_sources,
  ag.earliest_balance_date,
  ag.latest_balance_date,
  ag.latest_updated_at
FROM aggregated_balances ag
{{order_by_clause}}
LIMIT {{limit_rows}}