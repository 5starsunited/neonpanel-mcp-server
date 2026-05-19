-- For a list of (already lower-cased + de-duplicated) search terms, return
-- the (term, intent_id) pairs that exist in search_term_to_intent for this company.
-- Caller diffs against the input to compute uncovered terms.
SELECT
  lower(search_term) AS search_term,
  intent_id,
  MAX(confidence) AS confidence
FROM "{{catalog}}"."brand_analytics_iceberg"."search_term_to_intent"
WHERE company_id = {{company_id}}
  AND lower(search_term) IN ({{terms_in_list_sql}})
GROUP BY lower(search_term), intent_id
