import fs from 'node:fs';
import path from 'node:path';
import { runAthenaQuery } from '../clients/athena';
import { config } from '../config';
import { renderSqlTemplate } from '../tools/athena_tools/runtime/render-sql';

function sqlVarcharArrayExpr(values: string[]): string {
  if (values.length === 0) return 'CAST(ARRAY[] AS ARRAY(VARCHAR))';
  const escaped = values.map((v) => `'${String(v).replace(/'/g, "''")}'`);
  return `CAST(ARRAY[${escaped.join(',')}] AS ARRAY(VARCHAR))`;
}

async function main() {
  const companyId = Number(process.env.COMPANY_ID ?? '106');
  const marketplaces = (process.env.MARKETPLACES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const toolSqlPath = path.join(
    process.cwd(),
    'src',
    'tools',
    'athena_tools',
    'tools',
    'forecasting_list_latest_sales_forecast',
    'query_optimised.sql',
  );

  const template = fs.readFileSync(toolSqlPath, 'utf8');
  const rendered = renderSqlTemplate(template, {
    catalog: config.athena.catalog,
    database: config.athena.database,
    table: config.athena.tables.inventoryPlanningSnapshot,
    forecasting_database: config.athena.tables.forecastingDatabase,
    sales_forecast_table: config.athena.tables.salesForecast,

    limit_top_n: 10,
    horizon_months: 12,
    include_plan_series_sql: 'TRUE',
    include_sales_history_signals_sql: 'TRUE',

    aggregate_sql: 'FALSE',
    aggregate_by_sql: `'parent_asin'`,
    include_item_sales_share_sql: 'FALSE',
    sales_share_basis_sql: `'sales_last_30_days'`,

    company_ids_array: `CAST(ARRAY[${Math.trunc(companyId)}] AS ARRAY(BIGINT))`,
    skus_array: 'CAST(ARRAY[] AS ARRAY(VARCHAR))',
    asins_array: 'CAST(ARRAY[] AS ARRAY(VARCHAR))',
    parent_asins_array: 'CAST(ARRAY[] AS ARRAY(VARCHAR))',
    brands_array: 'CAST(ARRAY[] AS ARRAY(VARCHAR))',
    product_families_array: 'CAST(ARRAY[] AS ARRAY(VARCHAR))',
    marketplaces_array: sqlVarcharArrayExpr(marketplaces),
    revenue_abcd_classes_array: 'CAST(ARRAY[] AS ARRAY(VARCHAR))',
  });

  const res = await runAthenaQuery({
    query: rendered,
    database: config.athena.database,
    workGroup: config.athena.workgroup,
    outputLocation: config.athena.outputLocation,
    maxWaitMs: 120_000,
    pollIntervalMs: 1_000,
    maxRows: 20,
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
