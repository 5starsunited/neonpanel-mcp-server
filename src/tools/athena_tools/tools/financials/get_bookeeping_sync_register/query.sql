-- Tool: financials_get_bookkeeping_sync_register
-- Purpose: Shows the bookkeeping sync register – the status of document
--          synchronisation with QuickBooks Online (QBO) or Xero.
--          Lists sync entries with status, errors, QBO/Xero links,
--          and the associated journal entry details.
-- Note: "qbo_register" is the legacy table name; it covers both QBO and Xero.
-- Join chain:
--   qbo_register          QR  (sync register – main entity)
--     → journal_entries    JE  ON JE.id = QR.document_id
--     → app_companies      C   ON C.id  = QR.company_id

WITH params AS (
  SELECT
    {{limit_top_n}}                   AS limit_top_n,
    {{start_date_sql}}                AS start_date,
    {{end_date_sql}}                  AS end_date,

    -- Authorization
    {{company_ids_array}}             AS company_ids,

    -- Sync status filters
    {{sync_statuses_array}}           AS sync_statuses,
    {{has_error_filter}}              AS has_error_filter,

    -- Document type filters
    {{source_doc_types_array}}        AS source_doc_types,
    {{target_doc_types_array}}        AS target_doc_types,

    -- Doc number / ref filters
    {{doc_numbers_array}}             AS doc_numbers,
    {{qbo_transaction_refs_array}}    AS qbo_transaction_refs,

    -- Active filter
    {{active_filter}}                 AS active_filter
)

SELECT
  ROW_NUMBER() OVER (ORDER BY qr.transaction_date {{sort_direction}}, qr.id) AS row_num,
  CAST(qr.transaction_date AS DATE)   AS transaction_date,
  je.doc_number,
  je.name                             AS je_name,
  je.message                          AS je_message,

  qr.source_doc_type,
  qr.target_doc_type,

  ROUND(qr.amount, 2)                 AS amount,
  qr.currency,
  ROUND(qr.main_amount, 2)            AS main_amount,
  qr.main_currency,

  -- Sync info
  CASE qr.qbo_sync_status_id
    WHEN 0 THEN 'Off'
    WHEN 1 THEN 'Ready'
    WHEN 2 THEN 'Going'
    WHEN 3 THEN 'Synced'
    WHEN 4 THEN 'Error'
    ELSE 'Unknown'
  END                                  AS sync_status,
  qr.qbo_sync_status_id               AS sync_status_id,
  qr.sync_error,
  qr.qbo_id,
  qr.qbo_transaction_ref,
  qr.bk_document_url,
  qr.synced_at,
  qr.recalculated_at,
  qr.active,

  c.name                               AS company_name,
  qr.company_id

FROM "{{catalog}}"."neonpanel_iceberg"."qbo_register" qr

LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."journal_entries" je
  ON je.id = qr.document_id
  AND qr.document_type LIKE '%JournalEntry%'

INNER JOIN "{{catalog}}"."neonpanel_iceberg"."app_companies" c
  ON c.id = qr.company_id

CROSS JOIN params p

WHERE
  -- Authorization
  contains(p.company_ids, qr.company_id)

  -- Date range
  AND CAST(qr.transaction_date AS DATE) >= p.start_date
  AND CAST(qr.transaction_date AS DATE) <= p.end_date

  -- Sync status filter
  AND (
    cardinality(p.sync_statuses) = 0
    OR any_match(p.sync_statuses, s -> CAST(s AS INTEGER) = qr.qbo_sync_status_id)
  )

  -- Has error filter
  AND (
    p.has_error_filter IS NULL
    OR (p.has_error_filter = 1 AND qr.sync_error IS NOT NULL AND qr.sync_error <> '')
    OR (p.has_error_filter = 0 AND (qr.sync_error IS NULL OR qr.sync_error = ''))
  )

  -- Source doc type filter
  AND (
    cardinality(p.source_doc_types) = 0
    OR any_match(p.source_doc_types, dt -> lower(dt) = lower(qr.source_doc_type))
  )

  -- Target doc type filter
  AND (
    cardinality(p.target_doc_types) = 0
    OR any_match(p.target_doc_types, dt -> lower(dt) = lower(qr.target_doc_type))
  )

  -- Doc number filter (via JE)
  AND (
    cardinality(p.doc_numbers) = 0
    OR any_match(p.doc_numbers, d -> d = je.doc_number)
  )

  -- QBO transaction ref filter
  AND (
    cardinality(p.qbo_transaction_refs) = 0
    OR any_match(p.qbo_transaction_refs, r -> r = qr.qbo_transaction_ref)
  )

  -- Active filter
  AND (p.active_filter IS NULL OR qr.active = p.active_filter)

ORDER BY qr.transaction_date {{sort_direction}}, qr.id
LIMIT {{limit_top_n}}