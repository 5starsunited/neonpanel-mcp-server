-- ══════════════════════════════════════════════════════════════════
-- Company Threshold Report
-- Shows effective threshold for every company × every default slot.
-- source = 'company_override' means the company has a custom value;
-- source = 'system_default'   means the global default is used.
-- ══════════════════════════════════════════════════════════════════
WITH ryg_deduped AS (
    SELECT
        company_id, tool, signal_group, metric, color,
        threshold_value, signal_code, signal_description, updated_at
    FROM (
        SELECT *,
            ROW_NUMBER() OVER (
                PARTITION BY COALESCE(CAST(company_id AS VARCHAR), '__default__'),
                             tool, signal_group, metric, color
                ORDER BY updated_at DESC
            ) AS rn
        FROM "AwsDataCatalog"."brand_analytics_iceberg"."ryg_thresholds"
    )
    WHERE rn = 1
),

companies AS (
    SELECT DISTINCT CAST(id AS BIGINT) AS company_id, name AS company_name
    FROM "AwsDataCatalog"."neonpanel_iceberg"."app_companies"
),

defaults AS (
    SELECT tool, signal_group, metric, color,
           threshold_value, signal_code, signal_description, updated_at
    FROM ryg_deduped
    WHERE company_id IS NULL
),

overrides AS (
    SELECT company_id, tool, signal_group, metric, color,
           threshold_value, signal_code, signal_description, updated_at
    FROM ryg_deduped
    WHERE company_id IS NOT NULL
)

SELECT
    c.company_id,
    c.company_name,
    d.tool,
    d.signal_group,
    d.metric,
    d.color,
    d.threshold_value                                              AS default_threshold,
    o.threshold_value                                              AS company_override,
    COALESCE(o.threshold_value, d.threshold_value)                AS effective_threshold,
    CASE WHEN o.company_id IS NOT NULL THEN 'company_override'
         ELSE 'system_default' END                                AS source,
    d.signal_code                                                  AS default_signal_code,
    d.signal_description                                           AS default_signal_description,
    COALESCE(o.updated_at, d.updated_at)                          AS effective_updated_at
FROM companies c
CROSS JOIN defaults d
LEFT JOIN overrides o
    ON  o.company_id   = c.company_id
    AND o.tool         = d.tool
    AND o.signal_group = d.signal_group
    AND o.metric       = d.metric
    AND o.color        = d.color
ORDER BY
    c.company_id,
    d.tool,
    d.signal_group,
    d.metric,
    d.color
