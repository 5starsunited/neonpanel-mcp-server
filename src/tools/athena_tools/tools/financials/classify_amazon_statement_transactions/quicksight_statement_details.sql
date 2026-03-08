WITH 
company_list AS (
SELECT 
    c.name AS "Company", 
    c.id AS "company_id",
    c.currency,
    o.name AS "Organisation",
    '/' || media.directory || '/' || media.filename || '.' || media.extension AS "Company Logo"
FROM neonpanel_iceberg.app_companies c
LEFT JOIN neonpanel_iceberg.mediables m 
    ON m.mediable_id = c.id 
    AND m.mediable_type = 'App\Models\App\Company' 
    AND m.tag = 'framed'
LEFT JOIN neonpanel_iceberg.media media
    ON media.id = m.media_id
LEFT JOIN neonpanel_iceberg.app_organizations o 
    ON o.id = c.organization_id
),

service_account_map AS (
    SELECT 
      s.name AS service_name, 
      s.company_id, 
      s.income_account_id AS account_id,
      CONCAT(
               COALESCE(a.number, ''), ' ',
               COALESCE(CONCAT(ap2.name, ': '), ''),
               COALESCE(CONCAT(ap1.name, ': '), ''),
               COALESCE(a.name, '')
        ) AS "Account",
        CASE a.type
          WHEN 'Income' THEN '1.Income'
          WHEN 'REVENUE' THEN '1.Income'
          WHEN 'Cost of Goods Sold' THEN '2.Cost of Goods Sold'
          WHEN 'DIRECTCOSTS' THEN '2.Cost of Goods Sold'
          WHEN 'Expense' THEN '3.Expense'
          WHEN 'EXPENSE' THEN '3.Expense'
          WHEN 'Other Expense' THEN '4.Other Expense'
          WHEN 'OVERHEADS' THEN '4.Other Expense'
        ELSE a.type
        END AS "Account Type",
        a.type_detail AS "Account Type Detail",
        a.description AS "Account Description",
        CASE a.classification 
          WHEN 'Revenue' THEN '1.Revenue'
          WHEN 'Expense' THEN '2.Expense'
          WHEN 'Asset' THEN '3.Asset'
          WHEN 'Liability' THEN '4.Liability'
        ELSE a.classification
        END AS "Account Classification",
        COALESCE(apnl.name,'N/A') AS "PnL Class Name"
    FROM neonpanel_iceberg.services s
    LEFT JOIN neonpanel_iceberg.accounts a ON s.income_account_id = a.id
    LEFT JOIN neonpanel_iceberg.accounts ap1 ON a.parent_id = ap1.id
    LEFT JOIN neonpanel_iceberg.accounts ap2 ON ap1.parent_id = ap2.id
    LEFT JOIN neonpanel_iceberg.account_pnl_classes apnl ON apnl.id = a.id
),

statement_marketplace AS (
  SELECT
    s.settlement_id,
    s.company_id,
    COALESCE(m.currency_iso, m_cur.currency_iso) AS currency,
    COALESCE(s.marketplace_name, m_cur.name,
             CASE WHEN s.currency = 'EUR' THEN 'Europe' END) AS marketplace_name,
    COALESCE(m.code, m_cur.code) AS marketplace_code,
    COALESCE(m.country, m_cur.country,
             CASE WHEN s.currency = 'EUR' THEN 'Europe' END) AS marketplace_country
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

service_name_builder AS (
    SELECT 
        n.*,
        CAST(
        COALESCE(
             TRY(DATE_PARSE(SUBSTR(n.posted_date_time_raw, 1, 19), '%d.%m.%Y %H:%i:%s')),
             TRY(DATE_PARSE(REGEXP_REPLACE(n.posted_date_time_raw, ' UTC$', ''), '%Y-%m-%d %H:%i:%s')),
             TRY(DATE_PARSE(SUBSTR(n.posted_date_time_raw, 1, 19), '%Y/%m/%d %H:%i:%s')),
             TRY(DATE_PARSE(REGEXP_REPLACE(REGEXP_REPLACE(SUBSTR(n.posted_date_time_raw, 1, 19), 'T', ' '), '(Z|[+-][0-9]{2}:[0-9]{2})$', ''), '%Y-%m-%d %H:%i:%s')),
             TIMESTAMP '2010-01-01 00:00:00'
            ) 
            AT TIME ZONE 'UTC' 
            AT TIME ZONE 'America/Los_Angeles' 
        AS DATE) AS transaction_date_tz,
        m.subclass_code AS raw_subclass_code,
        CONCAT(
            CASE
                WHEN n.order_id IS NOT NULL
                     AND n.merchant_order_id IS NOT NULL
                     AND n.order_id != n.merchant_order_id
                     AND NOT REGEXP_LIKE(n.order_id, '^\d{3}-\d{7}-\d{7}$')
                THEN 'Non-Amazon'
                ELSE 'Amazon'
            END,
            ' ',
            COALESCE(m.service_name_suffix, n.amount_description || ' ' || n.transaction_type)
        ) AS derived_service_name
    FROM normalized n
    LEFT JOIN financial_accounting.settlement_flat_mapping m
        ON n.transaction_type = m.transaction_type
       AND n.amount_type_norm = m.amount_type_normalized
       AND n.amount_description_norm = m.amount_description_normalized
)

SELECT
    -- Identifiers
    sb.company_id AS "Company ID",
    comp.Company AS "Company",
    comp.Organisation AS "Organisation",
    comp."Company Logo" AS "Company Logo",
     -- Marketplace details
    sb.settlement_id AS "Amazon Statement ID",
    sb.merchant_order_id,
    sb.adjustment_id,
    sb.shipment_id,
    sb.order_id,
    sb.merchant_order_item_id,
    sb.merchant_order_item_code,
    sb.merchant_adjustment_item_id,
    sb.promotion_id,
    sb.sku,

    -- Dashboard Logic Aliases
    'Statements' AS "Data Source",
    sb.fulfillment_id AS "Channel",
    CAST(NULL AS INTEGER) AS "PnL Class ID",
    'Statements' AS "Data Type",

    -- Dates
    sb.transaction_date_tz AS "Transaction Date",
    SUBSTR(CAST(sb.transaction_date_tz AS VARCHAR), 1, 10) AS "Str Date",

    -- Financial Details
    sb.transaction_type AS "Transaction Type",
    sb.amount_type AS "Amount Type",
    sb.amount_description AS "Amount Description",
    sb.quantity AS "Transaction Quantity",
    sb.amount AS "Transaction Amount",
    CASE WHEN sb.amount < 0 THEN ABS(sb.amount) ELSE 0 END AS "debit",
    CASE WHEN sb.amount >= 0 THEN sb.amount ELSE 0 END AS "credit",
    sb.currency AS "Currency",
    sb.currency AS "Orig Currency",

    -- Account Details (Joined from service_account_map)
    sb.derived_service_name AS "Service Name",
    sam."Account",
    sam."Account Type",
    sam."Account Type Detail",
    sam."Account Description",
    sam."Account Classification",
    sam."PnL Class Name",

    -- Standard Classification with overrides
    sc.class_code AS "Standard Class Code",
    cl.class_name AS "Standard Class",
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
    END AS "Standard Subclass Code",
    sc.subclass_name AS "Standard Subclass",
    -- Original name for backwards compatibility
    CASE
        WHEN sb.raw_subclass_code = '1.03' AND sb.fulfillment_id = 'MFN' THEN '1.01'
        WHEN sb.raw_subclass_code = '1.04' AND sb.fulfillment_id = 'MFN'
             AND sb.transaction_type = 'Refund' AND sb.amount_type = 'ItemPrice' AND sb.amount_description = 'Principal'
        THEN '1.02'
        WHEN sb.raw_subclass_code = '1.05' AND sb.amount_type = 'FBA Inventory Reimbursement' AND sb.amount < 0
        THEN '2.14'
        ELSE COALESCE(sb.raw_subclass_code, '9.99')
    END AS "Subclass",

    -- Meta & Partition Columns
    sb.ingest_ts_utc,
    sb.settlement_year,
    sb.settlement_month,
    -- Marketplace data
    sm.marketplace_name AS "Marketplace",
    sm.marketplace_code AS "Country Code",
    sm.marketplace_country AS "Country",
    sm.currency AS "Marketplace Currency",
    
   -- main currency amount
   sb.amount * COALESCE(cr.rate, 0.00) AS "Transaction USD Amount",
   sb.amount * COALESCE(cr.rate, 0.00) / crm.rate AS "Transaction Main Amount",
   crm.rate as "Main Currency Rate",
   cr.rate AS "Currency Rate",
   crm.currency as "Main Currency"
 
FROM service_name_builder sb
LEFT JOIN company_list comp
    ON comp.company_id = CAST(sb.company_id AS BIGINT)
LEFT JOIN service_account_map sam 
    ON CAST(sam.company_id AS VARCHAR) = sb.company_id
    AND sam.service_name = sb.derived_service_name
LEFT JOIN statement_marketplace sm
    ON sb.settlement_id = sm.settlement_id
    AND sb.company_id = sm.company_id
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
    ON sc.class_code = cl.class_code
LEFT JOIN neonpanel_iceberg.currency_rates cr 
    ON cr.currency = COALESCE(sm.currency,sb.currency)
   AND cr.date  = sb.transaction_date_tz 
LEFT JOIN neonpanel_iceberg.currency_rates crm 
    ON crm.currency = comp.currency
   AND crm.date = sb.transaction_date_tz