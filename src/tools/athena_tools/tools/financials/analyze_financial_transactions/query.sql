-- Tool: financials_analyze_financial_transactions (JSON / financial_transactions table)
-- Purpose: Summarize SP-API financial transactions into monthly summary report
--          classes, mirroring Amazon's Date Range Summary report.
--
-- Classification model:
--   * Money is classified at the BREAKDOWN (leaf) level, not the transaction
--     level -- one Shipment fans out across Income / Expenses / Tax. We unpivot
--     the bd_* leaf columns into lines, then join a rules map on
--     (match_key, sign).
--   * Transactions with NO breakdowns (Transfer, FBAInventoryReimbursement, some
--     ServiceFee) are classified at the transaction level on their total, keyed
--     as 'TXN:<transactionType>'.
--   * The class is constant per breakdown type; only the subclass flips with the
--     sign of the amount (charge vs refund). SUM of all classified lines
--     reconciles to SUM(item_total) because SUM(bd_*) == item_total per row.
--
-- The transaction_class_map CTE is shaped identically to the optional physical
-- table neonpanel_iceberg.financial_transaction_class_map (see seed file
-- financial_transaction_class_map.sql). To externalize, replace the CTE body
-- with: SELECT * FROM "{{catalog}}"."neonpanel_iceberg"."financial_transaction_class_map".

WITH params AS (
    SELECT
        CAST({{company_id}} AS BIGINT) AS company_id,
        {{report_months_array}} AS report_months,
        {{marketplaces_array}} AS marketplaces,
        {{start_date}} AS start_date,
        {{end_date}} AS end_date,
        {{summary_classes_array}} AS summary_classes,
        {{summary_subclasses_array}} AS summary_subclasses,
        {{limit_top_n}} AS limit_top_n
),
-- posted_month and posted_date_day are derived in the MARKETPLACE-LOCAL report
-- timezone (US/CA=Pacific, UK=London, EU=CET, JP=Tokyo, AU=Sydney), so filtering
-- on them matches Amazon's report calendar. start_date/end_date bound the local
-- day (posted_date_day) inclusively; report_months bounds the local month.
source_rows AS (
    SELECT r.*
    FROM "{{catalog}}"."neonpanel_iceberg"."financial_transactions" r
    CROSS JOIN params p
    WHERE CAST(r.company_id AS BIGINT) = p.company_id
      AND (
          cardinality(p.report_months) = 0
          OR contains(p.report_months, r.posted_month)
      )
      AND (
          cardinality(p.marketplaces) = 0
          OR any_match(p.marketplaces, m -> lower(m) = lower(r.marketplace_name))
          OR contains(p.marketplaces, r.marketplace_id)
      )
      AND (p.start_date IS NULL OR r.posted_date_day >= p.start_date)
      AND (p.end_date   IS NULL OR r.posted_date_day <= p.end_date)
),
-- 1) Unpivot leaf breakdown columns into one line per non-zero amount.
breakdown_lines AS (
    SELECT transaction_id, transaction_type, fulfillment_network, 'OurPricePrincipal'                   AS match_key, bd_price_principal                      AS amount FROM source_rows WHERE bd_price_principal IS NOT NULL AND bd_price_principal <> 0
    UNION ALL SELECT transaction_id, transaction_type, fulfillment_network, 'OurPriceDiscount',                    bd_price_discount                       FROM source_rows WHERE bd_price_discount IS NOT NULL AND bd_price_discount <> 0
    UNION ALL SELECT transaction_id, transaction_type, fulfillment_network, 'OurPriceTax',                         bd_price_tax                            FROM source_rows WHERE bd_price_tax IS NOT NULL AND bd_price_tax <> 0
    UNION ALL SELECT transaction_id, transaction_type, fulfillment_network, 'Commission',                          bd_commission                           FROM source_rows WHERE bd_commission IS NOT NULL AND bd_commission <> 0
    UNION ALL SELECT transaction_id, transaction_type, fulfillment_network, 'RefundCommission',                    bd_refund_commission                    FROM source_rows WHERE bd_refund_commission IS NOT NULL AND bd_refund_commission <> 0
    UNION ALL SELECT transaction_id, transaction_type, fulfillment_network, 'FBAPerUnitFulfillmentFee',            bd_fba_fulfillment_fee                  FROM source_rows WHERE bd_fba_fulfillment_fee IS NOT NULL AND bd_fba_fulfillment_fee <> 0
    UNION ALL SELECT transaction_id, transaction_type, fulfillment_network, 'FBADisposalFee',                      bd_fba_disposal_fee                     FROM source_rows WHERE bd_fba_disposal_fee IS NOT NULL AND bd_fba_disposal_fee <> 0
    UNION ALL SELECT transaction_id, transaction_type, fulfillment_network, 'ShippingPrincipal',                   bd_shipping_principal                   FROM source_rows WHERE bd_shipping_principal IS NOT NULL AND bd_shipping_principal <> 0
    UNION ALL SELECT transaction_id, transaction_type, fulfillment_network, 'ShippingDiscount',                    bd_shipping_discount                    FROM source_rows WHERE bd_shipping_discount IS NOT NULL AND bd_shipping_discount <> 0
    UNION ALL SELECT transaction_id, transaction_type, fulfillment_network, 'ShippingChargeback',                  bd_shipping_chargeback                  FROM source_rows WHERE bd_shipping_chargeback IS NOT NULL AND bd_shipping_chargeback <> 0
    UNION ALL SELECT transaction_id, transaction_type, fulfillment_network, 'ShippingTax',                         bd_shipping_tax                         FROM source_rows WHERE bd_shipping_tax IS NOT NULL AND bd_shipping_tax <> 0
    UNION ALL SELECT transaction_id, transaction_type, fulfillment_network, 'MarketplaceFacilitatorTax-Principal', bd_marketplace_facilitator_tax          FROM source_rows WHERE bd_marketplace_facilitator_tax IS NOT NULL AND bd_marketplace_facilitator_tax <> 0
    UNION ALL SELECT transaction_id, transaction_type, fulfillment_network, 'MarketplaceFacilitatorTax-Shipping',  bd_marketplace_facilitator_tax_shipping FROM source_rows WHERE bd_marketplace_facilitator_tax_shipping IS NOT NULL AND bd_marketplace_facilitator_tax_shipping <> 0
    UNION ALL SELECT transaction_id, transaction_type, fulfillment_network, 'RecommerceLiquidation',               bd_recommerce_liquidation               FROM source_rows WHERE bd_recommerce_liquidation IS NOT NULL AND bd_recommerce_liquidation <> 0
    UNION ALL SELECT transaction_id, transaction_type, fulfillment_network, 'AmazonFees',                          bd_amazon_fees                          FROM source_rows WHERE bd_amazon_fees IS NOT NULL AND bd_amazon_fees <> 0
    UNION ALL SELECT transaction_id, transaction_type, fulfillment_network, 'Tax',                                 bd_tax                                  FROM source_rows WHERE bd_tax IS NOT NULL AND bd_tax <> 0
    UNION ALL SELECT transaction_id, transaction_type, fulfillment_network, 'Promo',                               bd_promo                                FROM source_rows WHERE bd_promo IS NOT NULL AND bd_promo <> 0
    UNION ALL SELECT transaction_id, transaction_type, fulfillment_network, 'GiftwrapPrincipal',                   bd_gift_wrap_principal                  FROM source_rows WHERE bd_gift_wrap_principal IS NOT NULL AND bd_gift_wrap_principal <> 0
    UNION ALL SELECT transaction_id, transaction_type, fulfillment_network, 'Other',                               bd_other                                FROM source_rows WHERE bd_other IS NOT NULL AND bd_other <> 0
),
-- 2) Transaction-level lines for rows that carry no breakdowns.
total_lines AS (
    SELECT
        transaction_id,
        transaction_type,
        fulfillment_network,
        'TXN:' || COALESCE(transaction_type, 'UNKNOWN') AS match_key,
        COALESCE(item_total, transaction_total) AS amount
    FROM source_rows
    WHERE (item_breakdowns_raw IS NULL OR item_breakdowns_raw = '[]')
      AND COALESCE(item_total, transaction_total) IS NOT NULL
      AND COALESCE(item_total, transaction_total) <> 0
),
all_lines AS (
    SELECT match_key, fulfillment_network, amount FROM breakdown_lines
    UNION ALL
    SELECT match_key, fulfillment_network, amount FROM total_lines
),
-- 3) Classification rules. Shape == financial_transaction_class_map table.
--    sign: 'POS' (amount >= 0), 'NEG' (amount < 0).
--    fulfillment: 'AFN' / 'MFN' for fulfillment-specific rules, '*' = any.
--    Resolution prefers a fulfillment-specific row over the '*' fallback.
transaction_class_map AS (
    SELECT * FROM (VALUES
        -- match_key,                             sign,  fulfillment, class,       subclass,                                                          class_order, subclass_order
        ('OurPricePrincipal',                     'POS', '*',  'Income',    'Product sales',                                                   1,  1),
        ('OurPricePrincipal',                     'NEG', '*',  'Income',    'Product sale refunds',                                            1,  2),
        ('ShippingPrincipal',                     'POS', '*',  'Income',    'Shipping credits',                                                1,  3),
        ('ShippingPrincipal',                     'NEG', '*',  'Income',    'Shipping credit refunds',                                         1,  4),
        ('GiftwrapPrincipal',                     'POS', '*',  'Income',    'Gift wrap credits',                                               1,  4),
        ('GiftwrapPrincipal',                     'NEG', '*',  'Income',    'Gift wrap credit refunds',                                        1,  4),
        ('OurPriceDiscount',                      'POS', '*',  'Income',    'Promotional rebate refunds',                                      1,  5),
        ('OurPriceDiscount',                      'NEG', '*',  'Income',    'Promotional rebates',                                             1,  5),
        ('ShippingDiscount',                      'POS', '*',  'Income',    'Promotional rebate refunds',                                      1,  5),
        ('ShippingDiscount',                      'NEG', '*',  'Income',    'Promotional rebates',                                             1,  5),
        ('Promo',                                 'POS', '*',  'Income',    'Promotional rebate refunds',                                      1,  5),
        ('Promo',                                 'NEG', '*',  'Income',    'Promotional rebates',                                             1,  5),
        -- ShippingChargeback is a shipping FEE charged to the seller, not income.
        -- Amazon's report defines "Other transaction fees" as including shipping
        -- chargebacks, so classify it under Expenses (was wrongly Income/Chargebacks).
        ('ShippingChargeback',                    'NEG', '*',  'Expenses',  'Other transaction fees',                                          2,  7),
        ('ShippingChargeback',                    'POS', '*',  'Expenses',  'Other transaction fee refunds',                                   2,  7),
        ('RecommerceLiquidation',                 'POS', '*',  'Income',    'FBA liquidation proceeds',                                        1,  7),
        ('RecommerceLiquidation',                 'NEG', '*',  'Income',    'FBA Liquidations proceeds adjustments',                           1,  8),
        ('TXN:FBAInventoryReimbursement',         'POS', '*',  'Income',    'FBA inventory reimbursement',                                     1,  9),
        -- Negative reimbursements are booked by Amazon as Expenses/'Adjustments'
        -- (the summary splits the Adjustment txn type by sign), not as income.
        ('TXN:FBAInventoryReimbursement',         'NEG', '*',  'Expenses',  'Adjustments',                                                     2,  8),

        ('Commission',                            'NEG', 'AFN','Expenses',  'FBA selling fees',                                                2,  1),
        ('Commission',                            'NEG', 'MFN','Expenses',  'Seller fulfilled selling fees',                                   2,  1),
        ('Commission',                            'NEG', '*',  'Expenses',  'Selling fees',                                                    2,  1),
        ('Commission',                            'POS', '*',  'Expenses',  'Selling fee refunds',                                             2,  2),
        ('RefundCommission',                      'POS', '*',  'Expenses',  'Selling fee refunds',                                             2,  2),
        ('RefundCommission',                      'NEG', '*',  'Expenses',  'Selling fee refunds',                                             2,  2),
        ('FBAPerUnitFulfillmentFee',              'NEG', '*',  'Expenses',  'FBA transaction fees',                                            2,  3),
        ('FBAPerUnitFulfillmentFee',              'POS', '*',  'Expenses',  'FBA transaction fee refunds',                                     2,  4),
        ('FBADisposalFee',                        'NEG', '*',  'Expenses',  'FBA inventory and inbound services fees',                         2,  5),
        ('FBADisposalFee',                        'POS', '*',  'Expenses',  'FBA inventory and inbound services fees',                         2,  5),
        ('AmazonFees',                            'NEG', '*',  'Expenses',  'Service fees',                                                    2,  6),
        ('AmazonFees',                            'POS', '*',  'Expenses',  'Service fee refunds',                                             2,  6),
        ('TXN:ServiceFee',                        'NEG', '*',  'Expenses',  'Service fees',                                                    2,  6),
        ('TXN:ServiceFee',                        'POS', '*',  'Expenses',  'Service fee refunds',                                             2,  6),
        ('Other',                                 'NEG', '*',  'Expenses',  'Other transaction fees',                                          2,  7),
        ('Other',                                 'POS', '*',  'Expenses',  'Other transaction fee refunds',                                   2,  7),
        ('TXN:Retrocharge',                       'NEG', '*',  'Expenses',  'Adjustments',                                                     2,  8),
        ('TXN:Retrocharge',                       'POS', '*',  'Income',    'Chargebacks',                                                     1,  6),

        ('OurPriceTax',                           'POS', '*',  'Tax',       'Product, shipping, gift wrap taxes and regulatory fee collected', 3,  1),
        ('OurPriceTax',                           'NEG', '*',  'Tax',       'Product, shipping, gift wrap taxes and regulatory fee refunded',  3,  2),
        ('ShippingTax',                           'POS', '*',  'Tax',       'Product, shipping, gift wrap taxes and regulatory fee collected', 3,  1),
        ('ShippingTax',                           'NEG', '*',  'Tax',       'Product, shipping, gift wrap taxes and regulatory fee refunded',  3,  2),
        ('Tax',                                   'POS', '*',  'Tax',       'Product, shipping, gift wrap taxes and regulatory fee collected', 3,  1),
        ('Tax',                                   'NEG', '*',  'Tax',       'Product, shipping, gift wrap taxes and regulatory fee refunded',  3,  2),
        ('MarketplaceFacilitatorTax-Principal',  'POS', '*',  'Tax',       'Amazon Obligated Tax and Regulatory Fee Withheld',                3,  3),
        ('MarketplaceFacilitatorTax-Principal',  'NEG', '*',  'Tax',       'Amazon Obligated Tax and Regulatory Fee Withheld',                3,  3),
        ('MarketplaceFacilitatorTax-Shipping',   'POS', '*',  'Tax',       'Amazon Obligated Tax and Regulatory Fee Withheld',                3,  3),
        ('MarketplaceFacilitatorTax-Shipping',   'NEG', '*',  'Tax',       'Amazon Obligated Tax and Regulatory Fee Withheld',                3,  3),

        ('TXN:Transfer',                          'POS', '*',  'Transfers', 'Transfers to bank account',                                       4,  1),
        ('TXN:Transfer',                          'NEG', '*',  'Transfers', 'Transfers to bank account',                                       4,  1)
    ) AS m(match_key, sign, fulfillment, summary_class, summary_subclass, class_order, subclass_order)
),
-- Resolve each line once: a fulfillment-specific rule wins over the '*' fallback.
resolved AS (
    SELECT
        l.match_key,
        l.amount,
        COALESCE(ms.summary_class,    mw.summary_class)    AS summary_class,
        COALESCE(ms.summary_subclass, mw.summary_subclass) AS summary_subclass,
        COALESCE(ms.class_order,      mw.class_order)      AS class_order,
        COALESCE(ms.subclass_order,   mw.subclass_order)   AS subclass_order
    FROM all_lines l
    LEFT JOIN transaction_class_map ms
      ON ms.match_key = l.match_key
     AND ms.sign = CASE WHEN l.amount >= 0 THEN 'POS' ELSE 'NEG' END
     AND ms.fulfillment = l.fulfillment_network
    LEFT JOIN transaction_class_map mw
      ON mw.match_key = l.match_key
     AND mw.sign = CASE WHEN l.amount >= 0 THEN 'POS' ELSE 'NEG' END
     AND mw.fulfillment = '*'
),
-- Lines with no matching rule fall to 'Unclassified' so totals never silently
-- drop; surfaces new Amazon breakdown/transaction types for triage.
combined AS (
    SELECT
        COALESCE(summary_class, 'Unclassified')               AS summary_class,
        COALESCE(summary_subclass, 'Unmapped: ' || match_key) AS summary_subclass,
        COALESCE(class_order, 9)                              AS class_order,
        COALESCE(subclass_order, 999)                         AS subclass_order,
        amount
    FROM resolved
),
subclass_summary AS (
    SELECT
        summary_class,
        summary_subclass,
        MIN(class_order) AS class_order,
        MIN(subclass_order) AS subclass_order,
        SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END) AS debits,
        SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS credits,
        SUM(amount) AS net_amount,
        COUNT(*) AS line_count
    FROM combined
    GROUP BY 1, 2
),
final_rows AS (
    SELECT s.*
    FROM subclass_summary s
    CROSS JOIN params p
    WHERE (
        cardinality(p.summary_classes) = 0
        OR any_match(p.summary_classes, c -> lower(c) = lower(s.summary_class))
    )
      AND (
        cardinality(p.summary_subclasses) = 0
        OR any_match(p.summary_subclasses, sc -> lower(s.summary_subclass) LIKE '%' || lower(sc) || '%')
    )
)
SELECT
    class_order,
    subclass_order,
    summary_class,
    summary_subclass,
    debits,
    credits,
    net_amount,
    line_count
FROM final_rows
ORDER BY {{sort_column}} {{sort_direction}}, class_order ASC, subclass_order ASC
LIMIT {{limit_top_n}}
