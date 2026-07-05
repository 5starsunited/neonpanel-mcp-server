-- Tool: financials_list_financial_transaction_transfers
-- Purpose: List individual Amazon payout/transfer transactions (accrual source) -- one row per
--          transfer-class transaction: disbursements to the bank account, failed disbursements,
--          account-level reserve holds/releases.
--
-- Source: neonpanel_iceberg.financial_transaction_lines_v1. Transfer-class lines are selected
-- DYNAMICALLY via financial_transaction_class_map (summary_class = 'Transfers'), so newly mapped
-- transfer-like services are picked up with no code change. Sign convention: payouts to the bank
-- are NEGATIVE (money leaving the Amazon account balance); failed disbursements returning money
-- are POSITIVE. The match_key CASE must stay in sync with financial_transaction_ledger_v1.

WITH params AS (
    SELECT
        CAST({{company_id}} AS BIGINT) AS company_id,
        {{report_months_array}} AS report_months,
        {{marketplaces_array}} AS marketplaces,
        {{directions_array}} AS directions,
        {{start_date}} AS start_date,
        {{end_date}} AS end_date,
        {{limit_top_n}} AS limit_top_n
),
cls AS (
    SELECT match_key, sign, summary_subclass
    FROM "{{catalog}}"."neonpanel_iceberg"."financial_transaction_class_map"
    WHERE summary_class = 'Transfers' AND fulfillment = '*'
),
lines AS (
    SELECT
        r.transaction_id,
        r.transaction_type,
        r.transaction_status,
        r.description,
        r.posted_date,
        r.posted_date_day,
        r.settlement_id,
        r.financial_event_group_id,
        r.seller_id,
        r.marketplace_id,
        r.marketplace_name,
        r.currency,
        CAST(r.amount AS DOUBLE) AS amount,
        CASE
            WHEN r.breakdown_type IN ('Base', 'BaseTax')
                THEN r.breakdown_type || ':' || COALESCE(r.description, '')
            WHEN r.breakdown_type = 'Promo' AND r.transaction_type = 'ServiceFee'
                THEN r.breakdown_type || ':' || COALESCE(r.description, '')
            WHEN r.breakdown_type = 'FBADisposalFee' AND r.posted_date_day < DATE '2026-06-19'
                THEN 'FBADisposalFee:legacy'
            WHEN r.breakdown_type = 'Tax' AND r.transaction_type = 'Adjustment'
                THEN r.breakdown_type || ':' || COALESCE(r.description, '')
            ELSE r.breakdown_type
        END AS match_key
    FROM "{{catalog}}"."neonpanel_iceberg"."financial_transaction_lines_v1" r
    CROSS JOIN params p
    WHERE CAST(r.company_id AS BIGINT) = p.company_id
      AND (cardinality(p.report_months) = 0 OR contains(p.report_months, r.posted_month))
      AND (p.start_date IS NULL OR r.posted_date_day >= p.start_date)
      AND (p.end_date   IS NULL OR r.posted_date_day <= p.end_date)
      AND (
          cardinality(p.marketplaces) = 0
          OR any_match(p.marketplaces, m -> lower(m) = lower(r.marketplace_name))
          OR contains(p.marketplaces, r.marketplace_id)
      )
      AND r.amount IS NOT NULL AND r.amount <> 0
),
transfer_lines AS (
    SELECT l.*, c.summary_subclass AS direction
    FROM lines l
    JOIN cls c
      ON c.match_key = l.match_key
     AND c.sign = CASE WHEN l.amount >= 0 THEN 'POS' ELSE 'NEG' END
),
txn AS (
    SELECT
        transaction_id,
        arbitrary(transaction_type)          AS transaction_type,
        arbitrary(direction)                 AS direction,
        arbitrary(description)               AS description,
        arbitrary(transaction_status)        AS transaction_status,
        min(posted_date)                     AS posted_date,
        min(posted_date_day)                 AS posted_date_day,
        arbitrary(settlement_id)             AS settlement_id,
        arbitrary(financial_event_group_id)  AS financial_event_group_id,
        arbitrary(seller_id)                 AS seller_id,
        arbitrary(marketplace_id)            AS marketplace_id,
        arbitrary(marketplace_name)          AS marketplace_name,
        arbitrary(currency)                  AS currency,
        SUM(amount)                          AS amount
    FROM transfer_lines
    GROUP BY transaction_id
)
SELECT
    t.posted_date_day,
    t.posted_date,
    t.direction,
    t.amount,
    t.currency,
    t.transaction_type,
    t.description,
    t.transaction_status,
    t.marketplace_name,
    t.marketplace_id,
    t.seller_id,
    t.settlement_id,
    t.financial_event_group_id,
    t.transaction_id
FROM txn t
CROSS JOIN params p
WHERE (cardinality(p.directions) = 0
       OR any_match(p.directions, d -> lower(t.direction) LIKE '%' || lower(d) || '%'))
ORDER BY t.posted_date {{sort_direction}}, t.transaction_id
LIMIT {{limit_top_n}}
