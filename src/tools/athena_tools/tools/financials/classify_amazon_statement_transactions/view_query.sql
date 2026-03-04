-- Classified Statement Details View — Run in Athena (neonpanel-prod workgroup)
-- Joins amazon_statement_details with mapping table to assign class/subclass per row.
-- Uses ROW_NUMBER to pick the single best-matching rule (lowest priority = first match wins).
-- Generates service_name using logic_amazon_service_mapping view (single source of truth).
-- ============================================================

CREATE OR REPLACE VIEW financial_accounting.amazon_statement_details_classified AS
WITH classified AS (
    SELECT
        d.*,
        m.subclass_code AS mapped_subclass_code,
        m.rule_priority,
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
),
-- Match service-name mapping rules (dedup by specificity)
service_matched AS (
    SELECT
        c.*,
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
    LEFT JOIN financial_accounting.logic_amazon_service_mapping lm
        ON (lm.amount_description = c.amount_description OR lm.amount_description = 'Any')
       AND (lm.amount_type = c.amount_type OR lm.amount_type = 'Any')
    WHERE c.rn = 1
)
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
    COALESCE(c.mapped_subclass_code, '9.99') AS subclass_code,
    sc.subclass_name,
    sc.class_code,
    cl.class_name,
    -- service_name: sales_channel + description
    -- Single source of truth: financial_accounting.logic_amazon_service_mapping
    CONCAT(
        CASE
            WHEN c.order_id IS NOT NULL
                 AND c.merchant_order_id IS NOT NULL
                 AND c.order_id != c.merchant_order_id
                 AND NOT regexp_like(c.order_id, '^\d{3}-\d{7}-\d{7}$')
            THEN 'Amazon MCF'
            ELSE 'Amazon'
        END,
        ' ',
        CASE
            WHEN c.is_special_reimbursement THEN c.amount_description || ' ' || c.transaction_type
            WHEN c.is_tax_promo             THEN c.amount_type || ' ' || c.transaction_type
            WHEN c.is_ad                    THEN 'Cost of Advertising ' || c.transaction_type
            ELSE c.amount_description || ' ' || c.transaction_type
        END
    ) AS service_name,
    c.ingest_ts_utc,
    c.settlement_year,
    c.settlement_month
FROM service_matched c
LEFT JOIN financial_accounting.settlement_subclasses sc
    ON sc.subclass_code = COALESCE(c.mapped_subclass_code, '9.99')
LEFT JOIN financial_accounting.settlement_classes cl
    ON sc.class_code = cl.class_code
WHERE c.sn_rn = 1;
