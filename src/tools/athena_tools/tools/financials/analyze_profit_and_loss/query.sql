-- Tool: financials_analyze_profit_and_loss
-- Purpose: Compute the P&L waterfall from GL journal entry data.
--          Returns: Gross Revenue, VAT Collected, Sales, Reimbursements,
--          Promo Discounts, Refunds, Liquidations, Revenue, Cost of Inventory Sold,
--          CM1, CM1%, Amazon Fees, CM2, CM2%, Amazon Promotion, CM3, CM3%,
--          Expenses, EBITDA, Margin
-- Join chain:
--   journal_entry_details  JED  (fact – debit/credit in main currency)
--     → journal_entries     JE  ON JE.id = JED.journal_entry_id   (date, company)
--     → accounts            A   ON A.id  = JED.account_id         (chart of accounts)
--     → accounts            PA  ON PA.id = A.parent_id            (parent account for COIS / Amazon Promo)
--     → app_companies       C   ON C.id  = JE.company_id          (company name, currency)
-- Notes:
--   • PnL Balance = credit − debit (reversed from GL net convention).
--     Revenue is positive, Expenses are negative.
--   • Account type classification mapping (from QuickSight template):
--       Income / REVENUE         → 1.Income
--       Cost of Goods Sold / DIRECTCOSTS → 2.Cost of Goods Sold
--       Expense / EXPENSE        → 3.Expense
--       Other Expense / OVERHEADS → 4.Other Expense
--   • Account number prefix mapping (template CoA):
--       Sales:            40011, 40013, 46000
--       VAT Collected:    22021
--       Reimbursements:   40015, 40103, 40105
--       Promo Discounts:  40107, 40108
--       Refunds:          40014, 40104, 40106
--       Liquidations:     40101, 40102
--   • Parent-account matching uses self-join on accounts.parent_id:
--       Cost of Inventory Sold:  PA.name = 'Cost of Inventory Sold' or 'Cost of Inventory sold'
--       Amazon Promotion:        PA.name = 'Amazon Promotion'

WITH params AS (
  SELECT
    {{start_date_sql}}                AS start_date,
    {{end_date_sql}}                  AS end_date,
    {{company_ids_array}}             AS company_ids,
    {{periodicity_sql}}               AS periodicity,
    CAST({{group_by_company}} AS INTEGER) AS group_by_company
),

-- ─── Enriched fact rows with P&L classification ─────────────────────────────
enriched AS (
  SELECT
    je.transaction_date,
    je.company_id,
    c.name                              AS company_name,
    c.currency                          AS main_currency,

    -- Account classification (map to QuickSight convention)
    CASE
      WHEN lower(a.type) IN ('income', 'other income', 'revenue')
        THEN '1.Income'
      WHEN lower(a.type) IN ('cost of goods sold', 'directcosts')
        THEN '2.Cost of Goods Sold'
      WHEN lower(a.type) IN ('expense')
        THEN '3.Expense'
      WHEN lower(a.type) IN ('other expense', 'overheads')
        THEN '4.Other Expense'
      ELSE a.type
    END                                  AS account_type,

    -- PnL Balance = credit − debit (revenue positive, expenses negative)
    COALESCE(jed.credit, 0) - COALESCE(jed.debit, 0) AS pnl_balance,

    -- Account number prefix (first 5 chars)
    SUBSTR(a.number, 1, 5)               AS acct_prefix,

    -- Parent account name (via self-join)
    pa.name                              AS parent_name

  FROM "{{catalog}}"."neonpanel_iceberg"."journal_entry_details" jed

  INNER JOIN "{{catalog}}"."neonpanel_iceberg"."journal_entries" je
    ON je.id = jed.journal_entry_id

  INNER JOIN "{{catalog}}"."neonpanel_iceberg"."accounts" a
    ON a.id = jed.account_id

  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."accounts" pa
    ON pa.id = a.parent_id
    AND pa.company_id = a.company_id

  INNER JOIN "{{catalog}}"."neonpanel_iceberg"."app_companies" c
    ON c.id = je.company_id

  CROSS JOIN params p

  WHERE
    -- Authorization
    contains(p.company_ids, je.company_id)
    AND a.company_id = je.company_id

    -- Date filter
    AND je.transaction_date >= p.start_date
    AND je.transaction_date <= p.end_date

    -- Only P&L-relevant account types (Income, COGS, Expense, Other Expense)
    AND lower(a.type) IN (
      'income', 'other income', 'revenue',
      'cost of goods sold', 'directcosts',
      'expense',
      'other expense', 'overheads'
    )
),

-- ─── Aggregate P&L line items per period ────────────────────────────────────
pnl_agg AS (
  SELECT
    -- Period key
    CASE p.periodicity
      WHEN 'month'   THEN DATE_FORMAT(e.transaction_date, '%Y-%m')
      WHEN 'quarter' THEN CAST(YEAR(e.transaction_date) AS VARCHAR) || '-Q' || CAST(QUARTER(e.transaction_date) AS VARCHAR)
      WHEN 'year'    THEN CAST(YEAR(e.transaction_date) AS VARCHAR)
      ELSE 'total'
    END                                                                     AS time_period,

    -- Optional company grouping
    CASE WHEN p.group_by_company = 1 THEN e.company_id ELSE NULL END        AS company_id,
    CASE WHEN p.group_by_company = 1 THEN e.company_name ELSE NULL END      AS company_name,
    CASE WHEN p.group_by_company = 1 THEN e.main_currency ELSE NULL END     AS main_currency,

    -- ── P&L building blocks ──────────────────────────────────────────────

    -- Sales = accounts 40011, 40013, 46000
    SUM(CASE WHEN e.acct_prefix IN ('40011','40013','46000') THEN e.pnl_balance ELSE 0 END) AS sales,

    -- VAT Collected = account 22021
    SUM(CASE WHEN e.acct_prefix = '22021' THEN e.pnl_balance ELSE 0 END) AS vat_collected,

    -- Reimbursements = accounts 40015, 40103, 40105
    SUM(CASE WHEN e.acct_prefix IN ('40015','40103','40105') THEN e.pnl_balance ELSE 0 END) AS reimbursements,

    -- Promo Discounts = accounts 40107, 40108
    SUM(CASE WHEN e.acct_prefix IN ('40107','40108') THEN e.pnl_balance ELSE 0 END) AS promo_discounts,

    -- Refunds = accounts 40014, 40104, 40106
    SUM(CASE WHEN e.acct_prefix IN ('40014','40104','40106') THEN e.pnl_balance ELSE 0 END) AS refunds,

    -- Liquidations = accounts 40101, 40102
    SUM(CASE WHEN e.acct_prefix IN ('40101','40102') THEN e.pnl_balance ELSE 0 END) AS liquidations,

    -- Revenue = all Income-type accounts
    SUM(CASE WHEN e.account_type = '1.Income' THEN e.pnl_balance ELSE 0 END) AS revenue,

    -- Cost of Inventory Sold = parent account 'Cost of Inventory Sold'
    SUM(CASE WHEN lower(e.parent_name) = 'cost of inventory sold' THEN e.pnl_balance ELSE 0 END) AS cost_of_inventory_sold,

    -- Cost of Goods Sold = all COGS-type accounts (negated: −pnl_balance makes it positive)
    SUM(CASE WHEN e.account_type = '2.Cost of Goods Sold' THEN -e.pnl_balance ELSE 0 END) AS cost_of_goods_sold,

    -- Amazon Promotion = parent account 'Amazon Promotion'
    SUM(CASE WHEN lower(e.parent_name) = 'amazon promotion' THEN e.pnl_balance ELSE 0 END) AS amazon_promotion,

    -- Expenses = Expense-type accounts minus Amazon Promotion
    SUM(CASE
      WHEN e.account_type = '3.Expense' THEN e.pnl_balance
      ELSE 0
    END) AS expenses_raw,

    -- Expense (for Net Income) = Expense + Other Expense types (negated)
    SUM(CASE
      WHEN e.account_type IN ('3.Expense', '4.Other Expense') THEN -e.pnl_balance
      ELSE 0
    END) AS expense_negated

  FROM enriched e
  CROSS JOIN params p
  GROUP BY
    CASE p.periodicity
      WHEN 'month'   THEN DATE_FORMAT(e.transaction_date, '%Y-%m')
      WHEN 'quarter' THEN CAST(YEAR(e.transaction_date) AS VARCHAR) || '-Q' || CAST(QUARTER(e.transaction_date) AS VARCHAR)
      WHEN 'year'    THEN CAST(YEAR(e.transaction_date) AS VARCHAR)
      ELSE 'total'
    END,
    CASE WHEN p.group_by_company = 1 THEN e.company_id ELSE NULL END,
    CASE WHEN p.group_by_company = 1 THEN e.company_name ELSE NULL END,
    CASE WHEN p.group_by_company = 1 THEN e.main_currency ELSE NULL END
),

-- ─── Compute derived waterfall lines ────────────────────────────────────────
waterfall AS (
  SELECT
    a.time_period,
    a.company_id,
    a.company_name,
    a.main_currency,

    -- Gross Revenue = Sales + VAT Collected
    a.sales + a.vat_collected                             AS gross_revenue,
    a.vat_collected,
    a.sales,
    a.reimbursements,
    a.promo_discounts,
    a.refunds,
    a.liquidations,

    -- Revenue (all Income accounts)
    a.revenue,

    -- Cost of Inventory Sold
    a.cost_of_inventory_sold,

    -- CM1 = Revenue + Cost of Inventory Sold
    a.revenue + a.cost_of_inventory_sold                  AS cm1,

    -- Amazon Fees = −COGS − Cost of Inventory Sold
    -a.cost_of_goods_sold - a.cost_of_inventory_sold      AS amazon_fees,

    -- CM2 = Revenue − Cost of Goods Sold
    a.revenue - a.cost_of_goods_sold                      AS cm2,

    -- Amazon Promotion
    a.amazon_promotion,

    -- CM3 = CM2 + Amazon Promotion
    (a.revenue - a.cost_of_goods_sold) + a.amazon_promotion AS cm3,

    -- Expenses = Expense-type PnL balance minus Amazon Promotion
    a.expenses_raw - a.amazon_promotion                   AS expenses,

    -- EBITDA = CM3 + Expenses
    (a.revenue - a.cost_of_goods_sold) + a.amazon_promotion
      + (a.expenses_raw - a.amazon_promotion)             AS ebitda,

    -- Net Income = Revenue − COGS − Expense(negated)
    a.revenue - a.cost_of_goods_sold - a.expense_negated  AS net_income

  FROM pnl_agg a
)

-- ─── Final output with margin percentages ───────────────────────────────────
SELECT
  w.time_period,
  w.company_id,
  w.company_name,
  w.main_currency,

  ROUND(w.gross_revenue, 2)           AS gross_revenue,
  ROUND(w.vat_collected, 2)           AS vat_collected,
  ROUND(w.sales, 2)                   AS sales,
  ROUND(w.reimbursements, 2)          AS reimbursements,
  ROUND(w.promo_discounts, 2)         AS promo_discounts,
  ROUND(w.refunds, 2)                 AS refunds,
  ROUND(w.liquidations, 2)            AS liquidations,
  ROUND(w.revenue, 2)                 AS revenue,
  ROUND(w.cost_of_inventory_sold, 2)  AS cost_of_inventory_sold,
  ROUND(w.cm1, 2)                     AS cm1,
  CASE WHEN w.revenue <> 0
    THEN ROUND(w.cm1 / w.revenue, 4)
    ELSE NULL
  END                                 AS cm1_pct,
  ROUND(w.amazon_fees, 2)             AS amazon_fees,
  ROUND(w.cm2, 2)                     AS cm2,
  CASE WHEN w.revenue <> 0
    THEN ROUND(w.cm2 / w.revenue, 4)
    ELSE NULL
  END                                 AS cm2_pct,
  ROUND(w.amazon_promotion, 2)        AS amazon_promotion,
  ROUND(w.cm3, 2)                     AS cm3,
  CASE WHEN w.revenue <> 0
    THEN ROUND(w.cm3 / w.revenue, 4)
    ELSE NULL
  END                                 AS cm3_pct,
  ROUND(w.expenses, 2)               AS expenses,
  ROUND(w.ebitda, 2)                  AS ebitda,
  CASE WHEN w.revenue <> 0
    THEN ROUND(w.ebitda / w.revenue, 4)
    ELSE NULL
  END                                 AS margin,
  ROUND(w.net_income, 2)             AS net_income

FROM waterfall w
ORDER BY w.time_period ASC
