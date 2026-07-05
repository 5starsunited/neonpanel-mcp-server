-- Tool: financials_list_financial_transaction_class_map
-- Purpose: The classification RULEBOOK -- how services (match_keys) map to summary classes and
--          subclasses. One row per (match_key, sign, fulfillment) rule.
-- Source: neonpanel_iceberg.financial_transaction_class_map (org-level configuration; the same
-- table used by financials_analyze_financial_transactions and the QuickSight datasets).

WITH params AS (
    SELECT
        {{search}} AS search,
        {{summary_classes_array}} AS summary_classes,
        {{limit_top_n}} AS limit_top_n
)
SELECT
    m.match_key            AS service_key,
    m.sign,
    m.fulfillment,
    m.summary_class,
    m.summary_subclass,
    m.class_order,
    m.subclass_order
FROM "{{catalog}}"."neonpanel_iceberg"."financial_transaction_class_map" m
CROSS JOIN params p
WHERE (p.search IS NULL OR lower(m.match_key) LIKE '%' || lower(p.search) || '%'
       OR lower(m.summary_subclass) LIKE '%' || lower(p.search) || '%')
  AND (cardinality(p.summary_classes) = 0
       OR any_match(p.summary_classes, c -> lower(c) = lower(m.summary_class)))
ORDER BY m.class_order, m.subclass_order, m.match_key, m.sign, m.fulfillment
LIMIT {{limit_top_n}}
