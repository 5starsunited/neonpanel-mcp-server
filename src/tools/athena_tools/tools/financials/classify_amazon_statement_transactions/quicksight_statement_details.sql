-- QuickSight dataset: Amazon Statement Details (unified for standard + default mode dashboards)
-- Source: sp_api_iceberg.amazon_statement_details (Iceberg, partitioned)
--         + financial_accounting.settlement_subclass_mapping (standard class/subclass rules)
--         + financial_accounting.settlement_subclasses / settlement_classes
--         + financial_accounting.logic_amazon_service_mapping (service_name rules — single source of truth)
--         + neonpanel_iceberg.services / accounts / account_types (CoA mapping)
--         + sp_api_iceberg.amazon_statements (marketplace_name per settlement)
--         + neonpanel_iceberg.amazon_marketplaces (marketplace code/country lookup)
-- ============================================================

WITH
-- ── Marketplace resolution (from amazon_statements.marketplace_name) ─
-- ~10% of statements have NULL marketplace_name → fallback by currency.
-- EUR is ambiguous (multiple EU marketplaces) → mapped to 'Europe'.
statement_marketplace AS (
  SELECT
    s.settlement_id,
    s.company_id,
    COALESCE(s.marketplace_name, m_cur.name,
             CASE WHEN s.currency = 'EUR' THEN 'Europe' END)   AS marketplace_name,
    COALESCE(m.code, m_cur.code)                               AS marketplace_code,
    COALESCE(m.country, m_cur.country,
             CASE WHEN s.currency = 'EUR' THEN 'Europe' END)   AS marketplace_country
  FROM sp_api_iceberg.amazon_statements s
  LEFT JOIN neonpanel_iceberg.amazon_marketplaces m
    ON m.name = s.marketplace_name
  LEFT JOIN (
    SELECT currency_iso,
           MIN(name) AS name, MIN(code) AS code, MIN(country) AS country
    FROM neonpanel_iceberg.amazon_marketplaces
    WHERE currency_iso IS NOT NULL AND currency_iso <> 'EUR'
    GROUP BY currency_iso
  ) m_cur
    ON s.marketplace_name IS NULL AND m_cur.currency_iso = s.currency
),

-- ── Classify transactions (standard class/subclass mapping) ──────────
classified AS (
  SELECT
    d.*,
    m.subclass_code AS mapped_subclass_code,
    ROW_NUMBER() OVER (
      PARTITION BY d.settlement_id, d.posted_date_time_raw,
                   d.transaction_type, d.amount_type,
                   d.amount_description, d.order_id, d.sku, d.amount
      ORDER BY m.rule_priority
    ) AS rn
  FROM sp_api_iceberg.amazon_statement_details d
  LEFT JOIN financial_accounting.settlement_subclass_mapping m
    ON (m.transaction_type IS NULL OR d.transaction_type = m.transaction_type)
   AND (m.amount_type IS NULL OR d.amount_type = m.amount_type)
   AND (m.amount_description IS NULL
        OR (m.match_mode = 'exact' AND d.amount_description = m.amount_description)
        OR (m.match_mode = 'like'  AND d.amount_description LIKE m.amount_description)
        OR (m.match_mode = 'regex' AND regexp_like(d.amount_description, m.amount_description)))
   AND (m.fulfillment_id IS NULL OR d.fulfillment_id = m.fulfillment_id)
   AND (m.amount_sign IS NULL
        OR (m.amount_sign = 'non_negative' AND d.amount >= 0)
        OR (m.amount_sign = 'negative'     AND d.amount < 0))
  WHERE d.settlement_year >= 2024
),

-- ── Resolve standard class/subclass + service-name mapping flags ─────
classified_resolved AS (
  SELECT
    c.settlement_id,
    c.company_id,
    c.amazon_seller_id,
    c.currency,
    c.sku,
    c.order_id,
    c.merchant_order_id,
    c.adjustment_id,
    c.shipment_id,
    c.fulfillment_id,
    c.merchant_order_item_id,
    c.merchant_order_item_code,
    c.merchant_adjustment_item_id,
    c.promotion_id,
    c.transaction_type,
    c.amount_type,
    c.amount_description,
    c.posted_date_time_raw,
    c.transaction_date,
    c.quantity,
    c.amount,
    -- Standard class/subclass (reference mode)
    COALESCE(c.mapped_subclass_code, '9.99') AS subclass_code,
    sc.subclass_name,
    sc.class_code,
    cl.class_name,
    -- Service-name mapping flags
    lm.is_special_reimbursement,
    lm.is_tax_promo,
    lm.is_ad,
    ROW_NUMBER() OVER (
      PARTITION BY c.settlement_id, c.posted_date_time_raw,
                   c.transaction_type, c.amount_type,
                   c.amount_description, c.order_id, c.sku, c.amount
      ORDER BY
        CASE WHEN lm.amount_description IS NOT NULL AND lm.amount_description != 'Any' THEN 0 ELSE 1 END,
        CASE WHEN lm.amount_type IS NOT NULL AND lm.amount_type != 'Any' THEN 0 ELSE 1 END
    ) AS sn_rn
  FROM classified c
  LEFT JOIN financial_accounting.settlement_subclasses sc
    ON sc.subclass_code = COALESCE(c.mapped_subclass_code, '9.99')
  LEFT JOIN financial_accounting.settlement_classes cl
    ON sc.class_code = cl.class_code
  LEFT JOIN financial_accounting.logic_amazon_service_mapping lm
    ON (lm.amount_description = c.amount_description OR lm.amount_description = 'Any')
   AND (lm.amount_type = c.amount_type OR lm.amount_type = 'Any')
  WHERE c.rn = 1
),

-- ── Compute service_name from mapping flags ──────────────────────────
service_named AS (
  SELECT
    cr.*,
    CONCAT(
      CASE
        WHEN cr.order_id IS NOT NULL
             AND cr.merchant_order_id IS NOT NULL
             AND cr.order_id != cr.merchant_order_id
             AND NOT regexp_like(cr.order_id, '^\d{3}-\d{7}-\d{7}$')
        THEN 'Amazon MCF'
        ELSE 'Amazon'
      END,
      ' ',
      CASE
        WHEN cr.is_special_reimbursement THEN cr.amount_description || ' ' || cr.transaction_type
        WHEN cr.is_tax_promo             THEN cr.amount_type || ' ' || cr.transaction_type
        WHEN cr.is_ad                    THEN 'Cost of Advertising ' || cr.transaction_type
        ELSE cr.amount_description || ' ' || cr.transaction_type
      END
    ) AS service_name
  FROM classified_resolved cr
  WHERE cr.sn_rn = 1
)

-- ── Final output (all columns for QuickSight) ────────────────────────
SELECT
  -- Keep original column names from old dataset
  sn.merchant_order_id,
  sn.adjustment_id,
  sn.shipment_id,
  sn.order_id,
  sn.merchant_order_item_id,
  sn.merchant_order_item_code,
  sn.merchant_adjustment_item_id,
  sn.promotion_id,
  sn.sku,
  sn.subclass_code                                        AS "Subclass",
  'Statements'                                            AS "Data Source",
  sn.fulfillment_id                                       AS "Channel",
  CAST(NULL AS INTEGER)                                   AS "PnL Class ID",
  'Statements'                                            AS "Data Type",
  sn.transaction_date                                     AS "Transaction Date",
  substr(cast(sn.transaction_date as varchar), 1, 10)     AS "Str Date",
  sn.transaction_type                                     AS "Transaction Type",
  sn.amount_type                                          AS "Amount Type",
  sn.amount_description                                   AS "Amount Description",
  sn.quantity                                             AS "Transaction Quantity",
  sn.amount                                               AS "Transaction Amount",
  CASE WHEN sn.amount < 0 THEN ABS(sn.amount) ELSE 0 END AS "debit",
  CASE WHEN sn.amount >= 0 THEN sn.amount ELSE 0 END     AS "credit",
  sm.marketplace_code                                     AS "Marketplace",
  CAST(sn.company_id AS INTEGER)                          AS "Company ID",
  sm.marketplace_country                                  AS "Country",
  sm.marketplace_name                                     AS "Marketplace Name",
  sn.currency                                             AS "Currency",
  sn.currency                                             AS "Orig Currency",
  'undefined'                                             AS "expense_key",
  sn.settlement_id                                        AS "Amazon Statement ID",

  -- Standard mode columns (reference classification)
  sn.class_code                                           AS "Standard Class Code",
  sn.class_name                                           AS "Standard Class",
  sn.subclass_code                                        AS "Standard Subclass Code",
  sn.subclass_name                                        AS "Standard Subclass",

  -- Service name (from logic_amazon_service_mapping view)
  sn.service_name                                         AS "Service Name",

  -- Default mode columns (CoA classification)
  a.name                                                  AS "Account Name",
  a.full_name                                             AS "Account Full Name",
  a.number                                                AS "Account Number",
  atypes.name                                             AS "Account Type",
  atypes.classification                                   AS "Account Classification"

FROM service_named sn

-- Marketplace resolution (from amazon_statements header)
LEFT JOIN statement_marketplace sm
  ON sm.settlement_id = sn.settlement_id
  AND sm.company_id = sn.company_id

-- CoA mapping: service_name → services → accounts → account_types
LEFT JOIN neonpanel_iceberg.services s
  ON lower(s.name) = lower(sn.service_name)
  AND s.company_id = CAST(sn.company_id AS BIGINT)
  AND s.template = 0
LEFT JOIN neonpanel_iceberg.accounts a
  ON a.id = s.income_account_id
  AND a.company_id = s.company_id
LEFT JOIN neonpanel_iceberg.account_types atypes
  ON atypes.id = a.account_type_id
