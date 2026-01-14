import fs from 'node:fs';
import path from 'node:path';
import { runAthenaQuery } from '../clients/athena';
import { config } from '../config';
import { renderSqlTemplate } from '../tools/athena_tools/runtime/render-sql';

async function main() {
  process.stdout.on('error', (err: any) => {
    if (err && err.code === 'EPIPE') process.exit(0);
  });

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

  // For EXPLAIN, we can use a dummy company_id; query planning/type-checking
  // does not require actual matching rows.
  const companyId = Number(process.env.COMPANY_ID ?? '1');

  const rendered = renderSqlTemplate(template, {
    catalog: config.athena.catalog,
    database: config.athena.database,
    table: config.athena.tables.inventoryPlanningSnapshot,
    forecasting_database: config.athena.tables.forecastingDatabase,
    sales_forecast_table: config.athena.tables.salesForecast,

    limit_top_n: 1,
    horizon_months: 12,
    include_plan_series_sql: 'TRUE',
    include_sales_history_signals_sql: 'FALSE',

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
    marketplaces_array: 'CAST(ARRAY[] AS ARRAY(VARCHAR))',
    revenue_abcd_classes_array: 'CAST(ARRAY[] AS ARRAY(VARCHAR))',
  });

  const explainQuery = `EXPLAIN ${rendered}`;

  const res = await runAthenaQuery({
    query: explainQuery,
    database: config.athena.database,
    workGroup: config.athena.workgroup,
    outputLocation: config.athena.outputLocation,
    maxWaitMs: 60_000,
    pollIntervalMs: 1_000,
    maxRows: 50,
  });

  for (const row of res.rows) {
    const values = Object.values(row);
    // eslint-disable-next-line no-console
    console.log(values.join('\t'));
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
