import fs from 'node:fs';
import path from 'node:path';
import { runAthenaQuery } from '../clients/athena';
import { config } from '../config';
import { renderSqlTemplate } from '../tools/athena_tools/runtime/render-sql';

function sqlEscapeString(value: string): string {
  return value.replace(/'/g, "''");
}

function sqlStringLiteral(value: string): string {
  return `'${sqlEscapeString(value)}'`;
}

function sqlNullableStringExpr(value: string | null | undefined): string {
  if (value === null || value === undefined) return 'CAST(NULL AS VARCHAR)';
  const trimmed = String(value).trim();
  if (trimmed.length === 0) return 'CAST(NULL AS VARCHAR)';
  return sqlStringLiteral(trimmed);
}

function sqlNullableTimestampExpr(iso: string | null | undefined): string {
  if (!iso) return 'CAST(NULL AS TIMESTAMP)';
  const trimmed = iso.trim();
  if (trimmed.length === 0) return 'CAST(NULL AS TIMESTAMP)';
  return `from_iso8601_timestamp(${sqlStringLiteral(trimmed)})`;
}

function sqlVarcharArrayExpr(values: string[]): string {
  if (values.length === 0) return 'CAST(ARRAY[] AS ARRAY(VARCHAR))';
  return `CAST(ARRAY[${values.map(sqlStringLiteral).join(',')}] AS ARRAY(VARCHAR))`;
}

async function main() {
  const companyId = Number(process.env.COMPANY_ID ?? '106');
  const inventoryId = process.env.INVENTORY_ID ? Number(process.env.INVENTORY_ID) : undefined;
  const sku = String(process.env.SKU ?? '').trim();
  const marketplace = String(process.env.MARKETPLACE ?? '').trim();

  const hasInventoryId = Boolean(inventoryId && Number.isFinite(inventoryId) && inventoryId > 0);
  const hasSkuSelector = sku.length > 0 && marketplace.length > 0;

  if (!hasInventoryId && !hasSkuSelector) {
    throw new Error('Provide INVENTORY_ID or (SKU and MARKETPLACE) env vars to select an item.');
  }

  const scenarioNames = (process.env.SCENARIOS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const compareMode = String(process.env.COMPARE_MODE ?? 'scenarios');
  const runSelectorType = String(process.env.RUN_SELECTOR_TYPE ?? 'latest_n');
  const runLatestN = Number(process.env.RUN_LATEST_N ?? '3');

  const includeActuals = String(process.env.INCLUDE_ACTUALS ?? 'true').toLowerCase() !== 'false';
  const limitTopN = Number(process.env.LIMIT ?? '200');

  const toolSqlPath = path.join(
    process.cwd(),
    'src',
    'tools',
    'athena_tools',
    'tools',
    'forecasting_compare_sales_forecast_scenarios',
    'query.sql',
  );

  const template = fs.readFileSync(toolSqlPath, 'utf8');
  const rendered = renderSqlTemplate(template, {
    catalog: config.athena.catalog,
    database: config.athena.database,
    table: config.athena.tables.inventoryPlanningSnapshot,

    forecast_catalog: config.athena.catalog,
    forecast_database: config.athena.tables.forecastingDatabase,
    forecast_table_sales_forecast: config.athena.tables.salesForecast,
    forecast_table_sales_history: config.athena.tables.salesHistory,

    company_ids_array: `CAST(ARRAY[${Math.trunc(companyId)}] AS ARRAY(BIGINT))`,

    inventory_id_sql: hasInventoryId ? String(Math.trunc(inventoryId!)) : 'CAST(NULL AS BIGINT)',
    sku_sql: hasSkuSelector ? sqlStringLiteral(sku) : 'CAST(NULL AS VARCHAR)',
    marketplace_sql: hasSkuSelector ? sqlStringLiteral(marketplace) : 'CAST(NULL AS VARCHAR)',

    apply_inventory_id_filter_sql: hasInventoryId ? 'TRUE' : 'FALSE',
    apply_sku_filter_sql: hasSkuSelector ? 'TRUE' : 'FALSE',
    apply_marketplace_filter_sql: hasSkuSelector ? 'TRUE' : 'FALSE',

    scenario_names_array: sqlVarcharArrayExpr(scenarioNames),

    compare_mode_sql: sqlStringLiteral(compareMode),

    run_selector_type_sql: sqlStringLiteral(runSelectorType),
    run_latest_n: runLatestN,
    updated_at_from_sql: sqlNullableTimestampExpr(process.env.UPDATED_AT_FROM),
    updated_at_to_sql: sqlNullableTimestampExpr(process.env.UPDATED_AT_TO),

    include_actuals_sql: includeActuals ? 'TRUE' : 'FALSE',

    period_start_sql: sqlNullableStringExpr(process.env.PERIOD_START),
    period_end_sql: sqlNullableStringExpr(process.env.PERIOD_END),

    limit_top_n: Math.min(500, Math.max(1, Math.trunc(limitTopN))),
  });

  const res = await runAthenaQuery({
    query: rendered,
    database: config.athena.database,
    workGroup: config.athena.workgroup,
    outputLocation: config.athena.outputLocation,
    maxWaitMs: 120_000,
    pollIntervalMs: 1_000,
    maxRows: 5,
  });

  // eslint-disable-next-line no-console
  console.log(`Rows returned: ${res.rows.length}`);
  // eslint-disable-next-line no-console
  console.log(res.rows.slice(0, 3));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
