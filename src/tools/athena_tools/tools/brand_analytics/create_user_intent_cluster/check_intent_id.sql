-- Uniqueness pre-check: does (company_id, intent_id) already exist?
SELECT count() AS existing_count
FROM etl.ba_user_intents_current
WHERE company_id = {{company_id}}
  AND intent_id = {{intent_id}}
  AND status != 'archived'
