-- Tool: financials_list_financial_transaction_services
-- Purpose: Catalog of the SERVICES (fee/charge line types) observed in a company's Amazon
--          financial transactions -- what each service is, which transactions it comes from,
--          and how it classifies into summary classes.
--
-- Source: neonpanel_iceberg.financial_transaction_lines_v1 (long/leaf-grain; one row per
-- breakdown leaf). A "service" == the classification key (match_key): the verbatim Amazon
-- breakdownType, a composite '<type>:<description>' for ambiguous leaves, or
-- 'TXN:<transactionType>[:<description>]' for breakdown-less transactions. The CASE below MUST
-- stay in sync with financial_transaction_ledger_v1 / financials_analyze_financial_transactions.
--
-- No amounts are returned -- this is a metadata catalog (line/transaction counts only).

WITH params AS (
    SELECT
        CAST({{company_id}} AS BIGINT) AS company_id,
        {{report_months_array}} AS report_months,
        {{search}} AS search,
        {{only_unclassified}} AS only_unclassified,
        {{limit_top_n}} AS limit_top_n
),
src AS (
    SELECT
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
        END                                        AS service_key,
        r.line_kind,
        r.transaction_type,
        r.description,
        r.fulfillment_network,
        r.posted_month,
        r.transaction_id,
        r.amount
    FROM "{{catalog}}"."neonpanel_iceberg"."financial_transaction_lines_v1" r
    CROSS JOIN params p
    WHERE CAST(r.company_id AS BIGINT) = p.company_id
      AND (cardinality(p.report_months) = 0 OR contains(p.report_months, r.posted_month))
      AND r.amount IS NOT NULL AND r.amount <> 0
),
agg AS (
    SELECT
        service_key,
        arbitrary(line_kind)                                                           AS line_kind,
        array_join(slice(array_agg(DISTINCT transaction_type), 1, 6), ', ')            AS origin_transaction_types,
        array_join(slice(array_agg(DISTINCT COALESCE(description, '')), 1, 6), ' | ')  AS origin_descriptions,
        min(posted_month)                                                              AS first_month,
        max(posted_month)                                                              AS last_month,
        count(*)                                                                       AS line_count,
        count(DISTINCT transaction_id)                                                 AS transaction_count,
        max(CASE WHEN amount > 0 THEN 1 ELSE 0 END)                                    AS has_pos,
        max(CASE WHEN amount < 0 THEN 1 ELSE 0 END)                                    AS has_neg,
        array_join(array_agg(DISTINCT COALESCE(fulfillment_network, '')), ', ')        AS fulfillment_networks
    FROM src
    GROUP BY service_key
),
cls AS (
    SELECT match_key, sign, fulfillment, summary_class, summary_subclass
    FROM "{{catalog}}"."neonpanel_iceberg"."financial_transaction_class_map"
)
SELECT
    a.service_key,
    a.line_kind,
    a.origin_transaction_types,
    a.origin_descriptions,
    a.first_month,
    a.last_month,
    a.line_count,
    a.transaction_count,
    CASE WHEN a.has_pos = 1 AND a.has_neg = 1 THEN 'POS,NEG'
         WHEN a.has_pos = 1 THEN 'POS' ELSE 'NEG' END                                  AS signs_seen,
    a.fulfillment_networks,
    cp.summary_class    AS pos_summary_class,
    cp.summary_subclass AS pos_summary_subclass,
    cn.summary_class    AS neg_summary_class,
    cn.summary_subclass AS neg_summary_subclass,
    CASE WHEN cf.match_key IS NOT NULL THEN 1 ELSE 0 END                               AS has_fulfillment_specific_rules,
    CASE WHEN (a.has_pos = 1 AND cp.match_key IS NULL AND cfp.match_key IS NULL)
           OR (a.has_neg = 1 AND cn.match_key IS NULL AND cfn.match_key IS NULL)
         THEN 1 ELSE 0 END                                                             AS is_unclassified
FROM agg a
LEFT JOIN cls cp  ON cp.match_key = a.service_key AND cp.sign = 'POS' AND cp.fulfillment = '*'
LEFT JOIN cls cn  ON cn.match_key = a.service_key AND cn.sign = 'NEG' AND cn.fulfillment = '*'
LEFT JOIN (SELECT DISTINCT match_key FROM cls WHERE fulfillment <> '*') cf  ON cf.match_key = a.service_key
LEFT JOIN (SELECT DISTINCT match_key FROM cls WHERE fulfillment <> '*' AND sign = 'POS') cfp ON cfp.match_key = a.service_key
LEFT JOIN (SELECT DISTINCT match_key FROM cls WHERE fulfillment <> '*' AND sign = 'NEG') cfn ON cfn.match_key = a.service_key
CROSS JOIN params p
WHERE (p.search IS NULL OR lower(a.service_key) LIKE '%' || lower(p.search) || '%')
  AND (p.only_unclassified = FALSE
       OR (a.has_pos = 1 AND cp.match_key IS NULL AND cfp.match_key IS NULL)
       OR (a.has_neg = 1 AND cn.match_key IS NULL AND cfn.match_key IS NULL))
ORDER BY a.line_count DESC, a.service_key ASC
LIMIT {{limit_top_n}}
