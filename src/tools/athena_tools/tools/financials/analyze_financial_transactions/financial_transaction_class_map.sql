-- Optional physical classification map for financials_analyze_financial_transactions (JSON).
-- Keyed on (match_key, sign, fulfillment). match_key is either a breakdown leaf
-- type (e.g. 'Commission') or a transaction-level key 'TXN:<transactionType>'.
--   sign:        'POS' (amount >= 0), 'NEG' (amount < 0)
--   fulfillment: 'AFN' / 'MFN' for fulfillment-specific rules, '*' = any (fallback)
-- Resolution in the query prefers a fulfillment-specific row over the '*' row.
--
-- Externalize the query's transaction_class_map CTE by replacing its body with:
--   SELECT match_key, sign, fulfillment, summary_class, summary_subclass, class_order, subclass_order
--   FROM "AwsDataCatalog"."neonpanel_iceberg"."financial_transaction_class_map"
--
-- Edit classification by INSERT/DELETE here -- no query/code change required.

CREATE TABLE IF NOT EXISTS neonpanel_iceberg.financial_transaction_class_map (
  match_key STRING,
  sign STRING,
  fulfillment STRING,
  summary_class STRING,
  summary_subclass STRING,
  class_order INT,
  subclass_order INT
)
LOCATION 's3://etl-glue-amazon-ads-prod-preprocessbucketreports6-1w0usrm0kq0j7/aws_etl/neonpanel_iceberg/financial_transaction_class_map/'
TBLPROPERTIES (
  'table_type' = 'ICEBERG',
  'format' = 'parquet',
  'write_compression' = 'snappy'
);

INSERT INTO neonpanel_iceberg.financial_transaction_class_map
  (match_key, sign, fulfillment, summary_class, summary_subclass, class_order, subclass_order)
VALUES
  ('OurPricePrincipal',                    'POS', '*',   'Income',    'Product sales',                                                   1,  1),
  ('OurPricePrincipal',                    'NEG', '*',   'Income',    'Product sale refunds',                                            1,  2),
  ('ShippingPrincipal',                    'POS', '*',   'Income',    'Shipping credits',                                                1,  3),
  ('ShippingPrincipal',                    'NEG', '*',   'Income',    'Shipping credit refunds',                                         1,  4),
  ('OurPriceDiscount',                     'POS', '*',   'Income',    'Promotional rebate refunds',                                      1,  5),
  ('OurPriceDiscount',                     'NEG', '*',   'Income',    'Promotional rebates',                                             1,  5),
  ('ShippingDiscount',                     'POS', '*',   'Income',    'Promotional rebate refunds',                                      1,  5),
  ('ShippingDiscount',                     'NEG', '*',   'Income',    'Promotional rebates',                                             1,  5),
  ('Promo',                                'POS', '*',   'Income',    'Promotional rebate refunds',                                      1,  5),
  ('Promo',                                'NEG', '*',   'Income',    'Promotional rebates',                                             1,  5),
  ('ShippingChargeback',                   'POS', '*',   'Income',    'Chargebacks',                                                     1,  6),
  ('ShippingChargeback',                   'NEG', '*',   'Income',    'Chargebacks',                                                     1,  6),
  ('RecommerceLiquidation',                'POS', '*',   'Income',    'FBA liquidation proceeds',                                        1,  7),
  ('RecommerceLiquidation',                'NEG', '*',   'Income',    'FBA Liquidations proceeds adjustments',                           1,  8),
  ('TXN:FBAInventoryReimbursement',        'POS', '*',   'Income',    'FBA inventory reimbursement',                                     1,  9),
  ('TXN:FBAInventoryReimbursement',        'NEG', '*',   'Income',    'FBA inventory reimbursement adjustments',                         1,  9),
  ('Commission',                           'NEG', 'AFN', 'Expenses',  'FBA selling fees',                                                2,  1),
  ('Commission',                           'NEG', 'MFN', 'Expenses',  'Seller fulfilled selling fees',                                   2,  1),
  ('Commission',                           'NEG', '*',   'Expenses',  'Selling fees',                                                    2,  1),
  ('Commission',                           'POS', '*',   'Expenses',  'Selling fee refunds',                                             2,  2),
  ('RefundCommission',                     'POS', '*',   'Expenses',  'Selling fee refunds',                                             2,  2),
  ('RefundCommission',                     'NEG', '*',   'Expenses',  'Selling fee refunds',                                             2,  2),
  ('FBAPerUnitFulfillmentFee',             'NEG', '*',   'Expenses',  'FBA transaction fees',                                            2,  3),
  ('FBAPerUnitFulfillmentFee',             'POS', '*',   'Expenses',  'FBA transaction fee refunds',                                     2,  4),
  ('FBADisposalFee',                       'NEG', '*',   'Expenses',  'FBA inventory and inbound services fees',                         2,  5),
  ('FBADisposalFee',                       'POS', '*',   'Expenses',  'FBA inventory and inbound services fees',                         2,  5),
  ('AmazonFees',                           'NEG', '*',   'Expenses',  'Service fees',                                                    2,  6),
  ('AmazonFees',                           'POS', '*',   'Expenses',  'Service fee refunds',                                             2,  6),
  ('TXN:ServiceFee',                       'NEG', '*',   'Expenses',  'Service fees',                                                    2,  6),
  ('TXN:ServiceFee',                       'POS', '*',   'Expenses',  'Service fee refunds',                                             2,  6),
  ('Other',                                'NEG', '*',   'Expenses',  'Other transaction fees',                                          2,  7),
  ('Other',                                'POS', '*',   'Expenses',  'Other transaction fee refunds',                                   2,  7),
  ('TXN:Retrocharge',                      'NEG', '*',   'Expenses',  'Adjustments',                                                     2,  8),
  ('TXN:Retrocharge',                      'POS', '*',   'Income',    'Chargebacks',                                                     1,  6),
  ('OurPriceTax',                          'POS', '*',   'Tax',       'Product, shipping, gift wrap taxes and regulatory fee collected', 3,  1),
  ('OurPriceTax',                          'NEG', '*',   'Tax',       'Product, shipping, gift wrap taxes and regulatory fee refunded',  3,  2),
  ('ShippingTax',                          'POS', '*',   'Tax',       'Product, shipping, gift wrap taxes and regulatory fee collected', 3,  1),
  ('ShippingTax',                          'NEG', '*',   'Tax',       'Product, shipping, gift wrap taxes and regulatory fee refunded',  3,  2),
  ('Tax',                                  'POS', '*',   'Tax',       'Product, shipping, gift wrap taxes and regulatory fee collected', 3,  1),
  ('Tax',                                  'NEG', '*',   'Tax',       'Product, shipping, gift wrap taxes and regulatory fee refunded',  3,  2),
  ('MarketplaceFacilitatorTax-Principal',  'POS', '*',   'Tax',       'Amazon Obligated Tax and Regulatory Fee Withheld',                3,  3),
  ('MarketplaceFacilitatorTax-Principal',  'NEG', '*',   'Tax',       'Amazon Obligated Tax and Regulatory Fee Withheld',                3,  3),
  ('MarketplaceFacilitatorTax-Shipping',   'POS', '*',   'Tax',       'Amazon Obligated Tax and Regulatory Fee Withheld',                3,  3),
  ('MarketplaceFacilitatorTax-Shipping',   'NEG', '*',   'Tax',       'Amazon Obligated Tax and Regulatory Fee Withheld',                3,  3),
  ('TXN:Transfer',                         'POS', '*',   'Transfers', 'Transfers to bank account',                                       4,  1),
  ('TXN:Transfer',                         'NEG', '*',   'Transfers', 'Transfers to bank account',                                       4,  1);
