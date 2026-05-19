-- Delete the existing audit row (by surrogate id) so we can re-insert an updated version.
DELETE FROM "{{catalog}}"."brand_analytics_iceberg"."intent_cluster_audit"
WHERE id = {{run_id}}
  AND company_id = {{company_id}}
