-- List RYG thresholds: returns system defaults + company overrides.
-- is_override = true when a company-specific row exists for that metric slot.
SELECT
    company_id,
    CASE WHEN company_id IS NOT NULL THEN true ELSE false END AS is_override,
    tool,
    signal_group,
    metric,
    color,
    threshold_value,
    signal_code,
    signal_description,
    updated_at
FROM "{{catalog}}"."brand_analytics_iceberg"."ryg_thresholds"
WHERE (company_id = {{company_id_sql}} OR ({{include_defaults}} AND company_id IS NULL))
  AND ({{tool_filter_sql}})
ORDER BY
    tool,
    signal_group,
    metric,
    color,
    company_id NULLS LAST
