-- Classified Statement Details View — Run in Athena (neonpanel-prod workgroup)
-- Joins amazon_statement_details with settlement_flat_mapping to assign
-- class/subclass + service_name per row.
-- Uses normalized amount_type / amount_description for exact-match mapping.
-- Applies subclass override rules (MFN, Refund/Principal, FBA Reimbursement).
-- ============================================================

CREATE OR REPLACE VIEW financial_accounting.amazon_statement_details_classified AS
WITH
-- ── Normalize amount_type / amount_description before mapping ────────
normalized AS (
  SELECT
    d.*,
    CASE
      WHEN d.amount_type LIKE 'FBA Customer Returns Fee%for ASIN:%'
      THEN 'FBA Customer Returns Fee'
      ELSE d.amount_type
    END AS amount_type_norm,
    CASE
      WHEN d.transaction_type = 'CouponRedemptionFee' THEN '*'
      WHEN d.transaction_type LIKE 'Grade and Resell%' THEN '*'
      WHEN d.transaction_type = 'Debt Adjustment' THEN '*'
      WHEN d.amount_type LIKE 'Inbound Defect Fee%' THEN '*'
      WHEN d.amount_description LIKE 'Transfer of funds unsuccessful%' THEN 'Transfer of funds unsuccessful'
      ELSE TRIM(d.amount_description)
    END AS amount_description_norm
  FROM sp_api_iceberg.amazon_statement_details d
),

-- ── Map via settlement_flat_mapping → subclass + service_name ────────
service_name_builder AS (
  SELECT
    n.*,
    m.subclass_code AS raw_subclass_code,
    CONCAT(
      CASE
        WHEN n.order_id IS NOT NULL
             AND n.merchant_order_id IS NOT NULL
             AND n.order_id != n.merchant_order_id
             AND NOT regexp_like(n.order_id, '^\d{3}-\d{7}-\d{7}$')
        THEN 'Non-Amazon'
        ELSE 'Amazon'
      END,
      ' ',
      COALESCE(m.service_name_suffix, n.amount_description || ' ' || n.transaction_type)
    ) AS service_name
  FROM normalized n
  LEFT JOIN financial_accounting.settlement_flat_mapping m
    ON n.transaction_type = m.transaction_type
   AND n.amount_type_norm = m.amount_type_normalized
   AND n.amount_description_norm = m.amount_description_normalized
)

SELECT
  sb.settlement_id,
  sb.company_id,
  sb.amazon_seller_id,
  sb.currency,
  sb.sku,
  sb.order_id,
  sb.merchant_order_id,
  sb.adjustment_id,
  sb.shipment_id,
  sb.fulfillment_id,
  sb.merchant_order_item_id,
  sb.merchant_order_item_code,
  sb.merchant_adjustment_item_id,
  sb.promotion_id,
  sb.transaction_type,
  sb.amount_type,
  sb.amount_description,
  sb.posted_date_time_raw,
  sb.transaction_date,
  sb.quantity,
  sb.amount,
  -- Subclass with override rules
  CASE
    WHEN sb.raw_subclass_code = '1.03' AND sb.fulfillment_id = 'MFN'
    THEN '1.01'
    WHEN sb.raw_subclass_code = '1.04' AND sb.fulfillment_id = 'MFN'
         AND sb.transaction_type = 'Refund'
         AND sb.amount_type = 'ItemPrice'
         AND sb.amount_description = 'Principal'
    THEN '1.02'
    WHEN sb.raw_subclass_code = '1.05'
         AND sb.amount_type = 'FBA Inventory Reimbursement'
         AND sb.amount < 0
    THEN '2.14'
    ELSE COALESCE(sb.raw_subclass_code, '9.99')
  END AS subclass_code,
  sc.subclass_name,
  sc.class_code,
  cl.class_name,
  sb.service_name,
  sb.ingest_ts_utc,
  sb.settlement_year,
  sb.settlement_month
FROM service_name_builder sb
LEFT JOIN financial_accounting.settlement_subclasses sc
  ON sc.subclass_code = CASE
    WHEN sb.raw_subclass_code = '1.03' AND sb.fulfillment_id = 'MFN' THEN '1.01'
    WHEN sb.raw_subclass_code = '1.04' AND sb.fulfillment_id = 'MFN'
         AND sb.transaction_type = 'Refund' AND sb.amount_type = 'ItemPrice' AND sb.amount_description = 'Principal'
    THEN '1.02'
    WHEN sb.raw_subclass_code = '1.05' AND sb.amount_type = 'FBA Inventory Reimbursement' AND sb.amount < 0
    THEN '2.14'
    ELSE COALESCE(sb.raw_subclass_code, '9.99')
  END
LEFT JOIN financial_accounting.settlement_classes cl
  ON sc.class_code = cl.class_code;
