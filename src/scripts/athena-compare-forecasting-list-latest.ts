import fs from 'node:fs';
import path from 'node:path';
import { runAthenaQuery } from '../clients/athena';
import { config } from '../config';
import { renderSqlTemplate } from '../tools/athena_tools/runtime/render-sql';

function parseCsvEnv(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function sqlVarcharArrayExpr(values: string[]): string {
  if (values.length === 0) return 'CAST(ARRAY[] AS ARRAY(VARCHAR))';
  const escaped = values.map((v) => `'${String(v).replace(/'/g, "''")}'`);
  return `CAST(ARRAY[${escaped.join(',')}] AS ARRAY(VARCHAR))`;
}

function sqlCompanyIdArrayExpr(values: number[]): string {
  if (values.length === 0) return 'CAST(ARRAY[] AS ARRAY(BIGINT))';
  return `CAST(ARRAY[${values.map((n) => String(Math.trunc(n))).join(',')}] AS ARRAY(BIGINT))`;
}

function asNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s.length === 0) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function approxEqual(a: unknown, b: unknown, eps = 1e-9): boolean {
  const na = asNumberOrNull(a);
  const nb = asNumberOrNull(b);
  if (na === null || nb === null) return String(a ?? '') === String(b ?? '');
  return Math.abs(na - nb) <= eps * Math.max(1, Math.abs(na), Math.abs(nb));
}

function normalizeString(v: unknown): string {
  if (v === null || v === undefined) return '';
  // Trim because some snapshot strings include trailing newlines
  return String(v).trim();
}

type Row = Record<string, string | null>;

function indexByInventoryId(rows: Row[]): Map<string, Row> {
  const map = new Map<string, Row>();
  for (const r of rows) {
    const id = r.inventory_id ?? '';
    if (id) map.set(String(id), r);
  }
  return map;
}

async function runQuery(sqlPath: string, renderedParams: Record<string, string | number>) {
  const template = fs.readFileSync(sqlPath, 'utf8');
  const rendered = renderSqlTemplate(template, renderedParams);
  return runAthenaQuery({
    query: rendered,
    database: config.athena.database,
    workGroup: config.athena.workgroup,
    outputLocation: config.athena.outputLocation,
    maxWaitMs: 180_000,
    pollIntervalMs: 1_000,
    maxRows: Number(renderedParams.limit_top_n ?? 50),
  });
}

async function main() {
  const companyId = Number(process.env.COMPANY_ID ?? '0');
  if (!Number.isFinite(companyId) || companyId <= 0) {
    throw new Error('Set COMPANY_ID to a positive integer.');
  }

  const limit = Math.min(1000, Math.max(1, Number(process.env.LIMIT ?? '20')));
  const horizonMonths = Math.min(24, Math.max(1, Number(process.env.HORIZON_MONTHS ?? '12')));

  const marketplaces = parseCsvEnv('MARKETPLACES');
  const parentAsins = parseCsvEnv('PARENT_ASINS');
  const brands = parseCsvEnv('BRANDS');
  const skus = parseCsvEnv('SKUS');
  const asins = parseCsvEnv('ASINS');
  const productFamilies = parseCsvEnv('PRODUCT_FAMILIES');
  const revenueAbcd = parseCsvEnv('REVENUE_ABCD_CLASSES');

  const includePlanSeries = (process.env.INCLUDE_PLAN_SERIES ?? 'true') !== 'false';
  const includeSalesHistory = (process.env.INCLUDE_SALES_HISTORY_SIGNALS ?? 'true') !== 'false';
  const includeItemSalesShare = (process.env.INCLUDE_ITEM_SALES_SHARE ?? 'false') === 'true';
  const salesShareBasis = process.env.SALES_SHARE_BASIS ?? 'sales_last_30_days';
  const aggregateBy = process.env.AGGREGATE_BY ?? 'parent_asin';

  const renderedParams: Record<string, string | number> = {
    catalog: config.athena.catalog,
    database: config.athena.database,
    table: config.athena.tables.inventoryPlanningSnapshot,
    forecasting_database: config.athena.tables.forecastingDatabase,
    sales_forecast_table: config.athena.tables.salesForecast,

    limit_top_n: limit,
    horizon_months: horizonMonths,
    include_plan_series_sql: includePlanSeries ? 'TRUE' : 'FALSE',
    include_sales_history_signals_sql: includeSalesHistory ? 'TRUE' : 'FALSE',

    aggregate_sql: 'FALSE',
    aggregate_by_sql: `'${aggregateBy}'`,
    include_item_sales_share_sql: includeItemSalesShare ? 'TRUE' : 'FALSE',
    sales_share_basis_sql: `'${salesShareBasis}'`,

    company_ids_array: sqlCompanyIdArrayExpr([companyId]),
    skus_array: sqlVarcharArrayExpr(skus),
    asins_array: sqlVarcharArrayExpr(asins),
    parent_asins_array: sqlVarcharArrayExpr(parentAsins),
    brands_array: sqlVarcharArrayExpr(brands),
    product_families_array: sqlVarcharArrayExpr(productFamilies),
    marketplaces_array: sqlVarcharArrayExpr(marketplaces),
    revenue_abcd_classes_array: sqlVarcharArrayExpr(revenueAbcd),
  };

  const baselinePath = path.join(
    process.cwd(),
    'src',
    'tools',
    'athena_tools',
    'tools',
    'forecasting_list_latest_sales_forecast',
    'query.sql',
  );
  const optimisedPath = path.join(
    process.cwd(),
    'src',
    'tools',
    'athena_tools',
    'tools',
    'forecasting_list_latest_sales_forecast',
    'query_optimised.sql',
  );

  const [baseline, optimised] = await Promise.all([
    runQuery(baselinePath, renderedParams),
    runQuery(optimisedPath, renderedParams),
  ]);

  const baseRows = baseline.rows ?? [];
  const optRows = optimised.rows ?? [];

  const baseById = indexByInventoryId(baseRows);
  const optById = indexByInventoryId(optRows);

  const baseIds = new Set(baseById.keys());
  const optIds = new Set(optById.keys());
  const allIds = Array.from(new Set([...baseIds, ...optIds]));

  const onlyInBase: string[] = [];
  const onlyInOpt: string[] = [];
  const mismatches: Array<{ inventory_id: string; field: string; baseline: string; optimised: string }> = [];

  const compareFields = [
    'sku',
    'country_code',
    'child_asin',
    'parent_asin',
    'brand',
    'product_family',
    'sales_last_30_days',
    'units_sold_last_30_days',
    'revenue_30d',
    'units_30d',
    'sales_share_basis_value',
    'group_key',
    'snapshot_year',
    'snapshot_month',
    'snapshot_day',
    'forecast_run_period',
    'forecast_run_updated_at',
    'forecast_plan_months_json',
    'product_name',
    'asin_img_path',
  ];

  for (const id of allIds) {
    const b = baseById.get(id);
    const o = optById.get(id);
    if (!b) {
      onlyInOpt.push(id);
      continue;
    }
    if (!o) {
      onlyInBase.push(id);
      continue;
    }

    for (const field of compareFields) {
      const bv = b[field];
      const ov = o[field];

      const isNumericField =
        field.endsWith('_30_days') ||
        field.endsWith('_30d') ||
        field === 'sales_share_basis_value';

      const equal = isNumericField ? approxEqual(bv, ov, 1e-9) : normalizeString(bv) === normalizeString(ov);
      if (!equal) {
        mismatches.push({
          inventory_id: id,
          field,
          baseline: normalizeString(bv),
          optimised: normalizeString(ov),
        });
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log('Compare params:', {
    companyId,
    limit,
    horizonMonths,
    marketplaces,
    parentAsins,
    brands,
    skus,
    asins,
    productFamilies,
    revenueAbcd,
    includePlanSeries,
    includeSalesHistory,
    includeItemSalesShare,
    salesShareBasis,
    aggregateBy,
  });
  // eslint-disable-next-line no-console
  console.log(`Baseline rows: ${baseRows.length} (indexed: ${baseById.size})`);
  // eslint-disable-next-line no-console
  console.log(`Optimised rows: ${optRows.length} (indexed: ${optById.size})`);

  const baseStats = baseline.stats;
  const optStats = optimised.stats;

  function fmtBytes(bytes?: number) {
    if (!bytes || !Number.isFinite(bytes)) return 'n/a';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = bytes;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i += 1;
    }
    return `${v.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
  }

  function fmtMs(ms?: number) {
    if (ms === undefined || ms === null || !Number.isFinite(ms)) return 'n/a';
    return `${Math.round(ms)} ms`;
  }

  function ratio(a?: number, b?: number) {
    if (!a || !b || !Number.isFinite(a) || !Number.isFinite(b)) return undefined;
    if (b === 0) return undefined;
    return a / b;
  }

  // eslint-disable-next-line no-console
  console.log('Baseline stats:', {
    dataScanned: fmtBytes(baseStats?.dataScannedInBytes),
    engineExec: fmtMs(baseStats?.engineExecutionTimeInMillis),
    totalExec: fmtMs(baseStats?.totalExecutionTimeInMillis),
    planning: fmtMs(baseStats?.queryPlanningTimeInMillis),
    queue: fmtMs(baseStats?.queryQueueTimeInMillis),
    service: fmtMs(baseStats?.serviceProcessingTimeInMillis),
  });
  // eslint-disable-next-line no-console
  console.log('Optimised stats:', {
    dataScanned: fmtBytes(optStats?.dataScannedInBytes),
    engineExec: fmtMs(optStats?.engineExecutionTimeInMillis),
    totalExec: fmtMs(optStats?.totalExecutionTimeInMillis),
    planning: fmtMs(optStats?.queryPlanningTimeInMillis),
    queue: fmtMs(optStats?.queryQueueTimeInMillis),
    service: fmtMs(optStats?.serviceProcessingTimeInMillis),
  });

  const scannedRatio = ratio(baseStats?.dataScannedInBytes, optStats?.dataScannedInBytes);
  const engineRatio = ratio(baseStats?.engineExecutionTimeInMillis, optStats?.engineExecutionTimeInMillis);
  const totalRatio = ratio(baseStats?.totalExecutionTimeInMillis, optStats?.totalExecutionTimeInMillis);
  if (scannedRatio || engineRatio || totalRatio) {
    // eslint-disable-next-line no-console
    console.log('Baseline/Optimised ratios:', {
      dataScanned: scannedRatio ? `${scannedRatio.toFixed(2)}x` : 'n/a',
      engineExec: engineRatio ? `${engineRatio.toFixed(2)}x` : 'n/a',
      totalExec: totalRatio ? `${totalRatio.toFixed(2)}x` : 'n/a',
    });
  }
  // eslint-disable-next-line no-console
  console.log(`Only in baseline: ${onlyInBase.length}`);
  // eslint-disable-next-line no-console
  console.log(`Only in optimised: ${onlyInOpt.length}`);
  // eslint-disable-next-line no-console
  console.log(`Mismatched fields: ${mismatches.length}`);

  if (onlyInBase.length) {
    // eslint-disable-next-line no-console
    console.log('Sample only-in-baseline inventory_id:', onlyInBase.slice(0, 10));
  }
  if (onlyInOpt.length) {
    // eslint-disable-next-line no-console
    console.log('Sample only-in-optimised inventory_id:', onlyInOpt.slice(0, 10));
  }
  if (mismatches.length) {
    // eslint-disable-next-line no-console
    console.log('Sample mismatches:', mismatches.slice(0, 12));
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
