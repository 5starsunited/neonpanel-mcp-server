-- Insert company-specific threshold overrides.
INSERT INTO "{{catalog}}"."brand_analytics_iceberg"."ryg_thresholds" (
  company_id, user_id, tool, signal_group, metric, color,
  threshold_value, signal_code, signal_description, updated_at
)
VALUES
  {{writes_values_sql}}
