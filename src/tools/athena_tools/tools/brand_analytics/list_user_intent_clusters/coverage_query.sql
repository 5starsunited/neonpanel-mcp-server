-- For a list of (already lower-cased + de-duplicated) search terms, return
-- the (term, intent_id) pairs mapped for this company. Caller diffs against the
-- input to compute uncovered terms.
SELECT
  lower(search_term) AS search_term,
  intent_id AS intent_id,
  max(confidence) AS confidence
FROM etl.ba_search_term_to_intent_current
WHERE company_id = {{company_id}}
  AND lower(search_term) IN ({{terms_in_list_sql}})
GROUP BY lower(search_term), intent_id
