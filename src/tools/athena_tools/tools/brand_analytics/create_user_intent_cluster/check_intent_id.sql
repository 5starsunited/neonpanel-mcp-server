-- Uniqueness pre-check: does (company_id, intent_id) already exist?
SELECT COUNT(*) AS existing_count
FROM "{{catalog}}"."brand_analytics_iceberg"."user_intents"
WHERE company_id = {{company_id}}
  AND intent_id = {{intent_id}}
  AND status <> 'archived'
