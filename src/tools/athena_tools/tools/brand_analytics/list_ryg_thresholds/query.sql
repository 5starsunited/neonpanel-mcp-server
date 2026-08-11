-- List RYG thresholds (ClickHouse): system defaults + company overrides.
--
-- Source: etl.ba_ryg_thresholds_current — SharedReplacingMergeTree(version) FINAL
-- filtered to is_active = 1, so the latest version per
-- (company_id, tool, signal_group, metric, color) is already collapsed and no
-- ROW_NUMBER dedup is needed here.
--
-- is_override = true when the row carries a company_id (company_id IS NULL marks
-- a system default seeded by migration 0047).
SELECT
    company_id,
    company_id IS NOT NULL AS is_override,
    tool,
    signal_group,
    metric,
    color,
    threshold_value,
    signal_code,
    signal_description,
    updated_at
FROM etl.ba_ryg_thresholds_current
WHERE (company_id = {{company_id_sql}} OR ({{include_defaults}} AND company_id IS NULL))
  AND ({{tool_filter_sql}})
ORDER BY
    tool,
    signal_group,
    metric,
    color,
    company_id NULLS LAST
LIMIT {{limit}}
