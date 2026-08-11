# Brand Analytics ClickHouse Migration Plan

**Status:** Proposed
**Scope:** The 23 currently registered `brand_analytics_*` MCP tools
**Decision:** Make a clean source cutover from Athena/Iceberg to ClickHouse. Do not retain Athena fallbacks, dual reads, dual writes, or compatibility SQL.

## Goal

Move every live Brand Analytics (BA) tool from the Athena runtime and Iceberg tables to ClickHouse while preserving authorization and the intended MCP behavior. The ClickHouse source becomes the only operational source after release.

The server already has the required runtime pieces:

- `src/clients/clickhouse.ts` provides JSON query execution and JSONEachRow inserts.
- `src/config/index.ts` exposes `CLICKHOUSE_URL`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, and `CLICKHOUSE_DATABASE`.
- Forecasting, supply-chain, financial, and advertising tools provide established ClickHouse migration examples and test patterns.

## Current State

All 23 live BA registrations in `src/tools/athena_tools/index.ts` execute through `runAthenaQuery`. Their handlers render Athena SQL from per-tool `*.sql` assets and depend on Athena catalog/database/workgroup/output configuration.

The source data falls into two classes:

| Class | Current Iceberg source | Live tools |
| --- | --- | --- |
| SQP and search snapshots | `search_query_performance_snapshot`, `search_catalog_performance_snapshot`, `search_term_smart_snapshot` | search-query/catalog analysis, funnel, momentum, conversion leak, growth diagnosis |
| Amazon BA reports | `brand_analytics_search_terms_report`, `brand_analytics_repeat_purchase_report`, `brand_analytics_market_basket_report` | competitive landscape, repeat purchases, cross-sell |
| Shared enrichment | inventory planning snapshot, marketplaces, brands, ASIN attributes, Amazon Ads search terms | search/catalog analysis and growth diagnosis |
| BA-managed state | RYG thresholds, competitors, tracked terms, watchlist, SQP upload audit, user intents, term-to-intent mappings, cluster audit | list/write tools, intent clustering, watchlist, growth diagnosis |

The BA directory also has six non-live/reference directories (`analytics_watchlist`, `competitor_asins`, `get_customer_retention_stats`, `ryg_thresholds`, `sqp_query_details_uploads`, and `tracked_search_terms`). They are not registered MCP tools and must not expand the runtime migration scope. Retain or remove their documentation only after checking whether another deployment or ETL process consumes it.

## Non-Goals and Cutover Rules

- No feature flag chooses Athena versus ClickHouse.
- No handler retries or falls back to Athena when ClickHouse fails.
- No dual-write period for BA-managed state.
- No Athena SQL asset remains in a migrated live tool directory.
- No migrated BA handler reads `config.athena`, calls `runAthenaQuery`, or passes Athena database/workgroup/output parameters.
- Tool names, permission checks, consequential flags, and response shapes remain unchanged unless a ClickHouse data contract makes an intentional product change necessary. Record any such change in the tool's `tool.json` before implementation.

## Phase 0: Establish the ClickHouse Contract

This phase is a blocking prerequisite. There is no BA ClickHouse schema in the repository today, so do not translate SQL until the warehouse owner supplies or approves the target DDL and ingestion path.

1. Inventory the Iceberg schemas from the BA DDL files and each live query's projected columns.
2. Publish a source-to-target mapping document for every table listed above. For each mapping, define the ClickHouse database/table or view, column types, nullable behavior, timezone, grain, freshness SLA, and tenant key (`company_id`).
3. Create the ClickHouse tables/views and ingestion jobs for the Amazon report and snapshot sources. Use immutable source rows plus a version/ingested timestamp where reports can be revised.
4. Create BA-managed tables for configuration and audit data. Use `ReplacingMergeTree(version)` (or a versioned current-state view) for logical upserts and active/inactive state; do not implement delete-then-insert behavior in MCP handlers.
5. Define the physical ordering and partitioning with the warehouse owner. Minimum expected access order is `company_id`, report/snapshot date, marketplace, and search term or ASIN as appropriate. Prefer current-state views for tools that need latest records and apply `FINAL` only where correctness requires it.
6. Grant the deployed `bi_service` user read access to all analytical and enrichment tables and insert access only to BA-managed write targets. Verify the server's existing ClickHouse secret injection is active in production.
7. Backfill BA-managed state and analytical history into ClickHouse before application cutover. Reconcile row counts, distinct company IDs, date ranges, and agreed aggregate KPIs against Athena for a fixed sample. This is migration verification, not an application fallback.

**Exit criteria:** every source mapping is approved; production ClickHouse has data at the required grain and freshness; representative reconciliations meet agreed tolerances; service credentials can execute least-privilege read and write smoke queries.

## Phase 1: Add BA ClickHouse Runtime Helpers

Create a small BA-local helper module, for example `src/tools/athena_tools/tools/brand_analytics/_clickhouse.ts`, rather than copying dialect helpers into 23 handlers.

It should provide:

- ClickHouse string escaping: escape backslashes before single quotes.
- Typed empty and non-empty arrays: `Array(String)`, `Array(UInt64)`, and other required element types.
- Typed nullable values: `CAST(NULL AS Nullable(...))`, `toDate(...)`, and `parseDateTime64BestEffortOrNull(...)` where applicable.
- A safe, allow-listed sort/dimension mapper so user input never becomes unrestricted SQL identifiers.
- A shared `executeBrandAnalyticsQuery` wrapper around `runClickHouseQuery` that preserves the current `{ items }` response convention and logs ClickHouse stats.
- A shared authorization helper only if it can replace identical existing BA permission loops without changing their permissions or empty-result behavior.

Do not change `src/clients/clickhouse.ts` unless migration work exposes a client-level deficiency. Its existing query and JSONEachRow APIs are the intended execution primitives.

## Phase 2: Build the Read Path in Dependency Order

Convert the reads in waves, merging each wave only after its SQL-render and integration tests pass.

### Wave 1: Core snapshot reads

- `brand_analytics_analyze_search_query_performance`
- `brand_analytics_analyze_search_catalog_performance`
- `brand_analytics_get_keyword_funnel_metrics`
- `brand_analytics_get_search_term_momentum`
- `brand_analytics_get_conversion_leak_analysis`

Rewrite `query.sql` and every live grouped variant for ClickHouse. Replace Athena constructs such as `UNNEST`, `ARRAY[...]`, `contains`, `cardinality`, `date_trunc`, `date_add`, `date_diff`, Presto casts, and catalog-qualified Iceberg identifiers with ClickHouse equivalents such as `arrayJoin`, `[ ... ]`, `has`, `length`, `toStartOfWeek`/`toStartOfMonth`, `addDays`/`addWeeks`, `dateDiff`, typed `CAST`, and `database.table` names.

### Wave 2: Amazon BA report reads

- `brand_analytics_get_competitive_landscape`
- `brand_analytics_analyze_repeat_purchases`
- `brand_analytics_get_cross_sell_opportunities`

Port report-array expansion carefully. Athena `UNNEST` joins need an explicit ClickHouse `ARRAY JOIN` or `arrayJoin` while retaining the parent row and avoiding duplicate aggregation. Revalidate marketplace-ID mapping against the new source representation.

### Wave 3: Configuration and intent reads

- `brand_analytics_list_ryg_thresholds`
- `brand_analytics_list_competitor_asins`
- `brand_analytics_list_tracked_search_terms`
- `brand_analytics_list_analytics_watchlist`
- `brand_analytics_list_sqp_query_details_uploads`
- `brand_analytics_list_user_intent_clusters`

These reads must target the BA-managed current-state tables/views designed in Phase 0. Preserve active-row filtering, audit history, and existing company scoping.

### Wave 4: Composite and derived reads

- `brand_analytics_growth_machine_diagnosis`
- `brand_analytics_run_watchlist`
- `brand_analytics_cluster_search_terms`

Migrate these after their upstream snapshots and BA-managed tables are available. `growth_machine_diagnosis` spans SQP/SCP, Amazon Ads, inventory data, and BA configuration; implement it as a ClickHouse-native query with explicit deduplication rules, then benchmark it separately.

For each converted read handler:

1. Replace `runAthenaQuery` with `runClickHouseQuery`.
2. Remove `config.athena` and Athena query option construction.
3. Replace Athena template variables with typed ClickHouse variables from the shared helper.
4. Keep Zod validation, authorization, field allow lists, pagination/limits, sorting semantics, and output mapping intact unless an approved product contract changes them.
5. Delete obsolete Athena-only SQL variants (`query_quicksight.sql`, legacy DDL references, and unused query templates) from the live path.

## Phase 3: Migrate Stateful Writes Without Dual Writes

Convert the six live state-mutating tools after their target tables are deployed and backfilled:

- `brand_analytics_write_ryg_thresholds`
- `brand_analytics_write_competitor_asins`
- `brand_analytics_write_tracked_search_terms`
- `brand_analytics_write_analytics_watchlist`
- `brand_analytics_upload_sqp_query_details`
- `brand_analytics_create_user_intent_cluster`

Implementation rules:

1. Preserve current Zod validation, authorization, `dry_run` default, and consequential designation.
2. Replace generated `INSERT`, `DELETE`, and `MERGE` SQL assets with `insertClickHouseJsonEachRow` for rows to persist.
3. Represent write/deactivate/reset transitions as versioned records, tombstones, or an active flag defined by the Phase 0 table contract. Reads must select the latest logical record per business key.
4. Keep cluster creation transactional at the application level as far as ClickHouse permits: validate all inputs first, write intent/mappings/audit with one request-scoped version ID, and return a clear partial-write error if a later insert fails. Do not hide a partial state with Athena rollback code.
5. For bulk replacement operations, insert the new versioned state and have the current-state view select it. Avoid per-slot synchronous delete queries.
6. Return the existing `dry_run`, `accepted`, `written`, and deactivation semantics. Exact counts must come from input state or an explicit ClickHouse query, never fabricated from an Athena execution result.

Remove Athena write assets and database/workgroup configuration from each migrated write directory.

## Phase 4: Remove the Athena BA Path

After all live BA tools use ClickHouse:

1. Remove BA-specific Athena SQL files, Iceberg DDL copies, and Athena-only helper code from the live runtime directories.
2. Update BA descriptions and READMEs to identify the ClickHouse source, freshness contract, and current-state behavior.
3. Add a dedicated `tests/brand-analytics-clickhouse-sql.test.ts` suite. It must enumerate all 23 registrations and fail if a BA handler or active SQL asset references `runAthenaQuery`, `config.athena`, `{{catalog}}`, Athena databases, or Athena-only dialect functions.
4. Keep the generic Athena client because non-BA tools still use it. This migration only removes BA's dependency on it.
5. Delete or archive the six non-live/reference directories only after confirming no build, CDK asset copy, documentation generator, or external ETL relies on them.

## Validation Plan

### Automated

- Run `npm run build` after each migration wave.
- Run the new BA ClickHouse SQL test plus the existing `npm test` suite.
- Render every SQL template with empty, single, and multi-value filters; assert no `{{...}}` tokens remain.
- Test each grouped query option and every allow-listed sort field/direction.
- Test permission denial, invalid input, zero-row results, ClickHouse query failure, and write `dry_run` behavior.
- Add direct client tests for string escaping and typed empty arrays, since BA filters are array-heavy.

### Data and production smoke tests

- For a fixed set of authorized companies, compare ClickHouse results with pre-cutover Athena baselines for counts, key dimensions, and core KPI aggregates. Document accepted differences caused by source freshness or corrected data.
- Exercise every read tool through MCP `tools/call` with representative filters.
- Exercise every write tool with `dry_run=true`, then a non-production or disposable-company persistence test, followed by its corresponding list/read verification.
- Confirm production logs report ClickHouse timing/stats and contain no BA Athena query execution IDs after deployment.

## Rollout

1. Deploy ClickHouse tables, views, ingestion, grants, and backfill first.
2. Complete the data reconciliation sign-off.
3. Land application migration waves behind the same production ClickHouse contract; no runtime source-selection flag is introduced.
4. Deploy the final hard cutover through the normal GitHub Actions path by committing and pushing `main`.
5. Run the MCP smoke suite and inspect production logs/metrics immediately after deployment.
6. If a production defect is found, remediate ClickHouse schema/query code and redeploy. Do not re-enable Athena in the BA handlers as a rollback mechanism.

## Completion Criteria

- All 23 registered BA tools call only ClickHouse.
- No live BA SQL or handler imports Athena runtime/configuration.
- BA-owned state is stored and read only from ClickHouse.
- ClickHouse source mappings, data freshness, permissions, and reconciliation results are documented and approved.
- Build, full tests, SQL-render tests, MCP smoke tests, and representative write verification pass.