# Brand Analytics ClickHouse Contract

This document records the warehouse contracts verified in the `clickhouse_etl` workspace for the Brand Analytics MCP migration.

## Analytical Sources

| Athena/Iceberg source | ClickHouse serving contract | Status |
| --- | --- | --- |
| `search_query_performance_snapshot` | `etl.ba_search_query_performance` | Available |
| `search_catalog_performance_snapshot` | `etl.ba_search_catalog_performance` | Available |
| `search_term_smart_snapshot` | `etl.ba_search_term_smart` | Available |
| `brand_analytics_search_terms_report` | `etl.ba_search_terms_current` | Available |
| `brand_analytics_repeat_purchase_report` | `etl.ba_repeat_purchase_current` | Available |
| `brand_analytics_market_basket_report` | `etl.ba_market_basket_current` | Available |

The five Amazon report feeds are defined in `clickhouse/migrations/0036_brand_analytics.sql`; the enrichment views are defined in `clickhouse/migrations/0037_brand_analytics_semantic_models.sql`. The Glue producer delivers source reports to the five `staging.ba_*` tables and the `etl.ba_*_current` views select the latest completed generation for each report scope.

## MCP-managed State

`clickhouse/migrations/0044_brand_analytics_mcp_state.sql` creates append-only, versioned targets and current-state views for RYG thresholds, competitor ASINs, tracked terms, analytics watchlists, SQP uploads, user intents, and term-to-intent mappings. MCP writes must insert new versions and reads must use `etl.ba_*_current`; no handler may issue ClickHouse `DELETE` statements.

## Contract Differences Requiring Reconciliation

The ClickHouse Amazon report contracts intentionally expose canonical report fields only. They do not contain every historical Iceberg enrichment or derived metric. In particular:

- `etl.ba_repeat_purchase_current` exposes `asin`, `repeat_purchase_count`, and `repeat_purchase_rate`; it does not supply unique customers, repeat revenue, or their historical trend inputs.
- `etl.ba_market_basket_current` exposes `asin`, `purchased_with_asin`, `purchased_with_rank`, and `combination_pct`.
- The SQP and SCP contracts use canonical names such as `search_query`, `search_query_volume`, `asin_click_share`, and `conversion_rate`, not the legacy nested report field names.

Before each handler is switched, its output schema and SQL must be reconciled against these fields. Do not substitute fabricated zeroes or renamed fields for missing metrics; either derive the metric from an approved source or intentionally update the product contract and its `tool.json`.