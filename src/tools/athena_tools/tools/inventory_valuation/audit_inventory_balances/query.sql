-- Tool: inventory_valuation_audit_inventory_balances
-- Purpose: Compare actual/source inventory_balances quantities to NeonPanel FIFO-calculated quantities.

WITH params AS (
  SELECT
    {{company_ids_array}} AS company_ids,
    {{skus_array}} AS skus,
    {{sources_array}} AS sources,
    {{statuses_array}} AS statuses,
    {{inventory_ids_array}} AS inventory_ids,
    {{warehouse_ids_array}} AS warehouse_ids,
    {{warehouse_names_array}} AS warehouse_names,
    {{warehouse_names_lower_array}} AS warehouse_names_lower,
    {{snapshot_date_sql}} AS snapshot_date,
    {{quantity_tolerance}} AS quantity_tolerance,
    {{only_discrepancies_sql}} AS only_discrepancies,
    {{sort_field_sql}} AS sort_field,
    {{sort_direction_sql}} AS sort_direction,
    {{limit_rows}} AS limit_rows
),

selected_warehouses AS (
  SELECT
    w.id AS warehouse_id,
    lower(trim(w.name)) AS warehouse_name_lower
  FROM "{{catalog}}"."neonpanel_iceberg"."inventory_warehouses" w
  CROSS JOIN params p
  WHERE (cardinality(p.warehouse_ids) = 0 OR contains(p.warehouse_ids, w.id))
    AND (
      cardinality(p.warehouse_names) = 0
      OR contains(p.warehouse_names_lower, lower(trim(w.name)))
    )
),

actual_pre_date AS (
  SELECT
    ib.company_id,
    c.name AS company_name,
    ib.date AS balance_date,
    ib.source,
    ib.status,
    ib.inventory_id,
    ib.sku,
    ib.warehouse_id,
    w.name AS warehouse_name,
    ib.balance_quantity,
    ib.updated_at
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
    AND (cardinality(p.inventory_ids) = 0 OR contains(p.inventory_ids, ib.inventory_id))
    AND (
      (cardinality(p.warehouse_ids) = 0 AND cardinality(p.warehouse_names) = 0)
      OR EXISTS (
        SELECT 1
        FROM selected_warehouses sw
        WHERE sw.warehouse_id = ib.warehouse_id
          OR sw.warehouse_name_lower = lower(trim(w.name))
      )
    )
),

audit_dates AS (
  SELECT
    company_id,
    CASE
      WHEN (SELECT snapshot_date FROM params) IS NOT NULL THEN (SELECT snapshot_date FROM params)
      ELSE MAX(CAST(balance_date AS DATE))
    END AS audit_date
  FROM actual_pre_date
  GROUP BY company_id
),

actual_balances AS (
  SELECT
    a.company_id,
    MAX(a.company_name) AS company_name,
    CAST(d.audit_date AS VARCHAR) AS audit_date,
    a.source,
    a.status,
    a.inventory_id,
    a.sku,
    a.warehouse_id,
    a.warehouse_name,
    SUM(COALESCE(CAST(a.balance_quantity AS BIGINT), 0)) AS actual_quantity,
    COUNT(*) AS actual_record_count,
    MAX(CAST(a.updated_at AS VARCHAR)) AS actual_latest_updated_at
  FROM actual_pre_date a
  INNER JOIN audit_dates d
    ON d.company_id = a.company_id
    AND CAST(a.balance_date AS DATE) = CAST(d.audit_date AS DATE)
  GROUP BY
    a.company_id,
    CAST(d.audit_date AS VARCHAR),
    a.source,
    a.status,
    a.inventory_id,
    a.sku,
    a.warehouse_id,
    a.warehouse_name
),

ranked_calculated_transactions AS (
  SELECT
    ft.company_id,
    ft.inventory_id,
    ft.sku,
    ft.destination_warehouse AS warehouse_name,
    d.audit_date,
    ft.batch_document_id AS batch_id,
    ft.transaction_id,
    ft.batch_balance,
    ROW_NUMBER() OVER (
      PARTITION BY ft.company_id, d.audit_date, ft.inventory_id, ft.destination_warehouse, ft.batch_document_id
      ORDER BY ft.transaction_id DESC
    ) AS rn
  FROM "{{catalog}}"."neonpanel_iceberg"."fifo_transactions_snapshot" ft
  INNER JOIN audit_dates d
    ON d.company_id = ft.company_id
    AND ft.document_date <= CAST(d.audit_date AS DATE)
  CROSS JOIN params p
  WHERE contains(p.company_ids, ft.company_id)
    AND (cardinality(p.skus) = 0 OR contains(p.skus, ft.sku))
    AND (cardinality(p.inventory_ids) = 0 OR contains(p.inventory_ids, ft.inventory_id))
    AND (
      (cardinality(p.warehouse_ids) = 0 AND cardinality(p.warehouse_names) = 0)
      OR EXISTS (
        SELECT 1
        FROM selected_warehouses sw
        WHERE sw.warehouse_name_lower = lower(trim(ft.destination_warehouse))
      )
    )
),

calculated_balances AS (
  SELECT
    company_id,
    CAST(audit_date AS VARCHAR) AS audit_date,
    inventory_id,
    sku,
    warehouse_name,
    SUM(CASE WHEN rn = 1 AND COALESCE(batch_balance, 0) > 0 THEN CAST(batch_balance AS BIGINT) ELSE 0 END) AS calculated_quantity,
    COUNT(DISTINCT CASE WHEN rn = 1 AND COALESCE(batch_balance, 0) > 0 THEN batch_id ELSE NULL END) AS calculated_batches_count
  FROM ranked_calculated_transactions
  WHERE rn = 1
  GROUP BY company_id, CAST(audit_date AS VARCHAR), inventory_id, sku, warehouse_name
),

comparison AS (
  SELECT
    COALESCE(a.company_id, c.company_id) AS company_id,
    a.company_name,
    COALESCE(a.audit_date, c.audit_date) AS audit_date,
    a.source AS actual_source,
    a.status AS actual_status,
    COALESCE(a.inventory_id, c.inventory_id) AS inventory_id,
    COALESCE(a.sku, c.sku) AS sku,
    a.warehouse_id AS actual_warehouse_id,
    COALESCE(a.warehouse_name, c.warehouse_name) AS warehouse_name,
    a.actual_quantity,
    c.calculated_quantity,
    COALESCE(a.actual_quantity, 0) - COALESCE(c.calculated_quantity, 0) AS quantity_difference,
    ABS(COALESCE(a.actual_quantity, 0) - COALESCE(c.calculated_quantity, 0)) AS abs_quantity_difference,
    CASE
      WHEN c.calculated_quantity IS NULL OR c.calculated_quantity = 0 THEN NULL
      ELSE ROUND((CAST(COALESCE(a.actual_quantity, 0) - c.calculated_quantity AS DOUBLE) / c.calculated_quantity) * 100, 2)
    END AS percent_difference,
    a.actual_record_count,
    c.calculated_batches_count,
    a.actual_latest_updated_at,
    CASE WHEN a.actual_quantity IS NULL THEN true ELSE false END AS missing_actual_data,
    CASE WHEN c.calculated_quantity IS NULL THEN true ELSE false END AS missing_calculated_data,
    CASE
      WHEN a.actual_quantity IS NULL THEN 'missing_actual_data'
      WHEN c.calculated_quantity IS NULL THEN 'missing_calculated_data'
      WHEN ABS(COALESCE(a.actual_quantity, 0) - COALESCE(c.calculated_quantity, 0)) > (SELECT quantity_tolerance FROM params) THEN 'quantity_discrepancy'
      ELSE 'matched_within_tolerance'
    END AS audit_status,
    CASE
      WHEN a.actual_quantity IS NULL OR c.calculated_quantity IS NULL THEN true
      WHEN ABS(COALESCE(a.actual_quantity, 0) - COALESCE(c.calculated_quantity, 0)) > (SELECT quantity_tolerance FROM params) THEN true
      ELSE false
    END AS needs_review
  FROM actual_balances a
  FULL OUTER JOIN calculated_balances c
    ON a.company_id = c.company_id
    AND a.audit_date = c.audit_date
    AND (
      (a.inventory_id IS NOT NULL AND c.inventory_id IS NOT NULL AND a.inventory_id = c.inventory_id)
      OR lower(trim(COALESCE(a.sku, ''))) = lower(trim(COALESCE(c.sku, '')))
    )
    AND lower(trim(COALESCE(a.warehouse_name, ''))) = lower(trim(COALESCE(c.warehouse_name, '')))
)

SELECT
  company_id,
  company_name,
  audit_date,
  actual_source,
  actual_status,
  inventory_id,
  sku,
  actual_warehouse_id,
  warehouse_name,
  actual_quantity,
  calculated_quantity,
  quantity_difference,
  abs_quantity_difference,
  percent_difference,
  actual_record_count,
  calculated_batches_count,
  actual_latest_updated_at,
  missing_actual_data,
  missing_calculated_data,
  audit_status,
  needs_review
FROM comparison
WHERE (SELECT only_discrepancies FROM params) = false OR needs_review = true
{{order_by_clause}}
LIMIT {{limit_rows}}