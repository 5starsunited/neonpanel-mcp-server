-- Search NeonPanel projects by name, ref number, or project key
-- Table: neonpanel_iceberg.project_list
-- Available template variables:
--   {{company_filter}} - Company ID filter (always present)
--   {{search_mode}} - 'OR' for general search across all fields, 'AND' for specific field search
--   {{project_name_filter}} - Project name filter (1=1 if not provided)
--   {{ref_number_filter}} - Reference number filter (1=1 if not provided)
--   {{project_key_filter}} - Project key filter (1=1 if not provided)

SELECT
  company_id,
  project_type,
  stage,
  project_date,
  project_amount,
  project_key,
  project_name,
  project_ref_number,
  project_url_path,
  CONCAT('https://my.neonpanel.com', project_url_path) AS project_url
FROM neonpanel_iceberg.project_list
WHERE ({{company_filter}})
  AND ({{project_name_filter}} {{search_mode}} {{ref_number_filter}} {{search_mode}} {{project_key_filter}})
ORDER BY project_date DESC
LIMIT 100
