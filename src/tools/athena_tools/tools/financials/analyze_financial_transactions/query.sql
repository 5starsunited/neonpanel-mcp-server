-- Tool: financials_analyze_financial_transactions
-- Purpose: Summarize Amazon Monthly Transaction rows into monthly summary report classes.

WITH params AS (
    SELECT
        CAST({{company_id}} AS BIGINT) AS company_id,
        {{report_months_array}} AS report_months,
        {{summary_classes_array}} AS summary_classes,
        {{summary_subclasses_array}} AS summary_subclasses,
        {{limit_top_n}} AS limit_top_n
),
source_rows AS (
    SELECT r.*
    FROM "{{catalog}}"."neonpanel_iceberg"."amazon_monthly_transactions_raw" r
    CROSS JOIN params p
    WHERE CAST(r.company_id AS BIGINT) = p.company_id
      AND (
          cardinality(p.report_months) = 0
          OR contains(p.report_months, r.report_month)
      )
),
amount_lines AS (
    SELECT
        'Income' AS summary_class,
        CASE
            WHEN transaction_type = 'Chargeback Refund' THEN 'Chargebacks'
            WHEN transaction_type = 'Liquidations' THEN 'FBA liquidation proceeds'
            WHEN transaction_type = 'Liquidations Adjustments' THEN 'FBA Liquidations proceeds adjustments'
            WHEN product_sales < 0 AND fulfillment = 'Amazon' THEN 'FBA product sale refunds'
            WHEN product_sales < 0 THEN 'Product sale refunds (non-FBA)'
            WHEN fulfillment = 'Amazon' THEN 'FBA product sales'
            ELSE 'Product sales (non-FBA)'
        END AS summary_subclass,
        product_sales AS amount
    FROM source_rows
    WHERE product_sales <> 0

    UNION ALL

    SELECT
        'Tax',
        CASE
            WHEN product_sales_tax + shipping_credits_tax + gift_wrap_credits_tax + regulatory_fee + tax_on_regulatory_fee < 0
                THEN 'Product, shipping, gift wrap taxes and regulatory fee refunded'
            ELSE 'Product, shipping, gift wrap taxes and regulatory fee collected'
        END,
        product_sales_tax + shipping_credits_tax + gift_wrap_credits_tax + regulatory_fee + tax_on_regulatory_fee
    FROM source_rows
    WHERE transaction_type <> 'Chargeback Refund'
      AND product_sales_tax + shipping_credits_tax + gift_wrap_credits_tax + regulatory_fee + tax_on_regulatory_fee <> 0

    UNION ALL

    SELECT
        'Income',
        CASE WHEN shipping_credits < 0 THEN 'Shipping credit refunds' ELSE 'Shipping credits' END,
        shipping_credits
    FROM source_rows
    WHERE shipping_credits <> 0

    UNION ALL

    SELECT
        'Income',
        CASE WHEN gift_wrap_credits < 0 THEN 'Gift wrap credit refunds' ELSE 'Gift wrap credits' END,
        gift_wrap_credits
    FROM source_rows
    WHERE gift_wrap_credits <> 0

    UNION ALL

    SELECT
        'Income',
        CASE WHEN promotional_rebates < 0 THEN 'Promotional rebates' ELSE 'Promotional rebate refunds' END,
        promotional_rebates
    FROM source_rows
    WHERE promotional_rebates <> 0

    UNION ALL

    SELECT
        'Tax',
        'Amazon Obligated Tax and Regulatory Fee Withheld',
        marketplace_withheld_tax
    FROM source_rows
    WHERE marketplace_withheld_tax <> 0

    UNION ALL

    SELECT
        'Expenses',
        CASE
            WHEN transaction_type = 'Amazon Fees' THEN 'Service fees'
            WHEN selling_fees >= 0 THEN 'Selling fee refunds'
            WHEN fulfillment = 'Amazon' THEN 'FBA selling fees'
            ELSE 'Seller fulfilled selling fees'
        END,
        selling_fees
    FROM source_rows
    WHERE transaction_type <> 'Chargeback Refund'
      AND selling_fees <> 0

    UNION ALL

    SELECT
        'Expenses',
        CASE
            WHEN transaction_type IN ('Service Fee', 'Service Fee - Reversal', 'Service Fee - Correction') THEN 'FBA inventory and inbound services fees'
            WHEN fba_fees >= 0 THEN 'FBA transaction fee refunds'
            ELSE 'FBA transaction fees'
        END,
        fba_fees
    FROM source_rows
    WHERE fba_fees <> 0

    UNION ALL

    SELECT
        CASE
            WHEN transaction_type = 'Service Fee' AND description = 'Refund for Advertiser' THEN 'Expenses'
            WHEN transaction_type IN ('Liquidations', 'Liquidations Adjustments') THEN 'Expenses'
            WHEN other_transaction_fees >= 0 THEN 'Expenses'
            ELSE 'Expenses'
        END,
        CASE
            WHEN transaction_type = 'Service Fee' AND description = 'Refund for Advertiser' THEN 'Refund for Advertiser'
            WHEN transaction_type IN ('Liquidations', 'Liquidations Adjustments') THEN 'Liquidations fees'
            WHEN other_transaction_fees >= 0 THEN 'Other transaction fee refunds'
            ELSE 'Other transaction fees'
        END,
        other_transaction_fees
    FROM source_rows
    WHERE other_transaction_fees <> 0

    UNION ALL

    SELECT
        CASE
            WHEN transaction_type = 'Transfer' THEN 'Transfers'
            WHEN transaction_type = 'Adjustment' AND other_amount > 0 THEN 'Income'
            WHEN transaction_type IS NULL THEN 'Income'
            ELSE 'Expenses'
        END,
        CASE
            WHEN transaction_type = 'Transfer' THEN 'Transfers to bank account'
            WHEN transaction_type = 'Adjustment' AND other_amount > 0 THEN 'FBA inventory credit'
            WHEN transaction_type = 'Adjustment' THEN 'Adjustments'
            WHEN transaction_type = 'FBA Inventory Fee' THEN 'FBA inventory and inbound services fees'
            WHEN transaction_type = 'Service Fee' THEN 'Service fees'
            WHEN transaction_type IS NULL THEN 'Receivables Deductions'
            WHEN other_amount >= 0 THEN 'FBA inventory credit'
            ELSE 'Adjustments'
        END,
        other_amount
    FROM source_rows
    WHERE other_amount <> 0

    UNION ALL

    SELECT
        'Income',
        'Chargebacks',
        product_sales_tax + shipping_credits_tax + gift_wrap_credits_tax + regulatory_fee + tax_on_regulatory_fee + selling_fees + fba_fees + other_transaction_fees + other_amount
    FROM source_rows
    WHERE transaction_type = 'Chargeback Refund'
      AND product_sales_tax + shipping_credits_tax + gift_wrap_credits_tax + regulatory_fee + tax_on_regulatory_fee + selling_fees + fba_fees + other_transaction_fees + other_amount <> 0
),
summary_catalog AS (
    SELECT * FROM (VALUES
        (1,  1, 'Income',   'Product sales (non-FBA)'),
        (1,  2, 'Income',   'Product sale refunds (non-FBA)'),
        (1,  3, 'Income',   'FBA product sales'),
        (1,  4, 'Income',   'FBA product sale refunds'),
        (1,  5, 'Income',   'FBA inventory credit'),
        (1,  6, 'Income',   'FBA liquidation proceeds'),
        (1,  7, 'Income',   'FBA Liquidations proceeds adjustments'),
        (1,  8, 'Income',   'Shipping credits'),
        (1,  9, 'Income',   'Shipping credit refunds'),
        (1, 10, 'Income',   'Gift wrap credits'),
        (1, 11, 'Income',   'Gift wrap credit refunds'),
        (1, 12, 'Income',   'Promotional rebates'),
        (1, 13, 'Income',   'Promotional rebate refunds'),
        (1, 14, 'Income',   'A-to-z Guarantee claims'),
        (1, 15, 'Income',   'Chargebacks'),
        (1, 16, 'Income',   'Amazon Shipping Reimbursement Adjustments'),
        (1, 17, 'Income',   'SAFE-T reimbursement'),
        (1, 18, 'Income',   'Receivables Deductions'),
        (1, 19, 'Income',   'Amazon Shipping Charge Adjustments'),
        (2,  1, 'Expenses', 'Seller fulfilled selling fees'),
        (2,  2, 'Expenses', 'FBA selling fees'),
        (2,  3, 'Expenses', 'Selling fee refunds'),
        (2,  4, 'Expenses', 'FBA transaction fees'),
        (2,  5, 'Expenses', 'FBA transaction fee refunds'),
        (2,  6, 'Expenses', 'Other transaction fees'),
        (2,  7, 'Expenses', 'Other transaction fee refunds'),
        (2,  8, 'Expenses', 'FBA inventory and inbound services fees'),
        (2,  9, 'Expenses', 'Shipping label purchases'),
        (2, 10, 'Expenses', 'Shipping label refunds'),
        (2, 11, 'Expenses', 'Carrier shipping label adjustments'),
        (2, 12, 'Expenses', 'Service fees'),
        (2, 13, 'Expenses', 'Refund administration fees'),
        (2, 14, 'Expenses', 'Adjustments'),
        (2, 15, 'Expenses', 'Cost of Advertising'),
        (2, 16, 'Expenses', 'Refund for Advertiser'),
        (2, 17, 'Expenses', 'Liquidations fees'),
        (3,  1, 'Tax',      'Product, shipping, gift wrap taxes and regulatory fee collected'),
        (3,  2, 'Tax',      'Product, shipping, gift wrap taxes and regulatory fee refunded'),
        (3,  3, 'Tax',      'Amazon Obligated Tax and Regulatory Fee Withheld'),
        (4,  1, 'Transfers','Transfers to bank account'),
        (4,  2, 'Transfers','Failed transfers to bank account'),
        (4,  3, 'Transfers','Disburse to Amazon Gift Card balance'),
        (4,  4, 'Transfers','Charges to credit card and other debt recovery')
    ) AS labels(class_order, subclass_order, summary_class, summary_subclass)
),
subclass_summary AS (
    SELECT
        summary_class,
        summary_subclass,
        SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END) AS debits,
        SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS credits,
        SUM(amount) AS net_amount,
        COUNT(*) AS line_count
    FROM amount_lines
    GROUP BY 1, 2
),
final_rows AS (
    SELECT
        summary_catalog.class_order,
        summary_catalog.subclass_order,
        summary_catalog.summary_class,
        summary_catalog.summary_subclass,
        COALESCE(subclass_summary.debits, CAST(0 AS DECIMAL(18, 2))) AS debits,
        COALESCE(subclass_summary.credits, CAST(0 AS DECIMAL(18, 2))) AS credits,
        COALESCE(subclass_summary.net_amount, CAST(0 AS DECIMAL(18, 2))) AS net_amount,
        COALESCE(subclass_summary.line_count, 0) AS line_count
    FROM summary_catalog
    LEFT JOIN subclass_summary
        ON subclass_summary.summary_class = summary_catalog.summary_class
       AND subclass_summary.summary_subclass = summary_catalog.summary_subclass
    CROSS JOIN params p
    WHERE (
        cardinality(p.summary_classes) = 0
        OR any_match(p.summary_classes, c -> lower(c) = lower(summary_catalog.summary_class))
    )
      AND (
        cardinality(p.summary_subclasses) = 0
        OR any_match(p.summary_subclasses, sc -> lower(summary_catalog.summary_subclass) LIKE '%' || lower(sc) || '%')
    )
)
SELECT *
FROM final_rows
ORDER BY {{sort_column}} {{sort_direction}}, class_order ASC, subclass_order ASC
LIMIT {{limit_top_n}}
