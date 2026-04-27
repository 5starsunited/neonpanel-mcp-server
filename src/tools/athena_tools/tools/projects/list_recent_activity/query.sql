WITH activity_events AS (
  SELECT
    al.created_at AS event_time,
    'task_status_changed' AS event_type,
    'task' AS entity_type,
    t.id AS entity_id,
    t.content AS entity_name,
    t.content AS item_content,
    t.extension_type AS task_extensions,
    COALESCE(parent.id, t.id) AS project_id,
    COALESCE(parent.content, t.content) AS project_name,
    t.company_id AS company_id,
    al.subject_id AS actor_user_id
  FROM "{{catalog}}"."neonpanel_iceberg"."activity_log" al
  INNER JOIN "{{catalog}}"."neonpanel_iceberg"."app_tasks" t
    ON t.id = al.causer_id
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."app_tasks" parent
    ON parent.id = t.task_id
  WHERE al.log_name = 'edit-history'
    AND al.subject_id IS NOT NULL
    AND al.causer_type = 'App\\Models\\App\\Task'

  UNION ALL

  SELECT
    al.created_at AS event_time,
    'field_value_changed' AS event_type,
    'field' AS entity_type,
    f.id AS entity_id,
    f.name AS entity_name,
    f.value AS item_content,
    task.content AS task_extensions,
    COALESCE(parent.id, task.id) AS project_id,
    COALESCE(parent.content, task.content) AS project_name,
    task.company_id AS company_id,
    al.subject_id AS actor_user_id
  FROM "{{catalog}}"."neonpanel_iceberg"."activity_log" al
  INNER JOIN "{{catalog}}"."neonpanel_iceberg"."app_fields" f
    ON f.id = al.causer_id
  INNER JOIN "{{catalog}}"."neonpanel_iceberg"."app_tasks" task
    ON task.id = f.task_id
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."app_tasks" parent
    ON parent.id = task.task_id
  WHERE al.log_name = 'edit-history'
    AND al.subject_id IS NOT NULL
    AND al.causer_type = 'App\\Models\\App\\Field'
),
project_urls AS (
  SELECT
    task.id AS task_id,
    CONCAT('/app/processes/', process.uuid, '/tasks/', task.uuid, '?status[]=2') AS project_url_path
  FROM "{{catalog}}"."neonpanel_iceberg"."app_tasks" task
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."app_columns" column_ref
    ON column_ref.id = task.column_id
  LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."app_processes" process
    ON process.id = column_ref.process_id
)
SELECT
  e.event_time,
  e.event_type,
  e.entity_type,
  e.entity_id,
  e.entity_name,
  e.item_content,
  e.task_extensions,
  e.project_id,
  e.project_name,
  e.company_id,
  company.name AS company_name,
  e.actor_user_id,
  user_ref.name AS actor_user_name,
  project_urls.project_url_path
FROM activity_events e
LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."app_companies" company
  ON company.id = e.company_id
LEFT JOIN "{{catalog}}"."neonpanel_iceberg"."app_users" user_ref
  ON user_ref.id = e.actor_user_id
LEFT JOIN project_urls
  ON project_urls.task_id = e.project_id
WHERE {{company_filter_sql}}
  AND {{event_type_filter_sql}}
  AND e.event_time >= current_timestamp - INTERVAL '{{days_back}}' DAY
ORDER BY e.event_time DESC
LIMIT {{limit_top_n}}