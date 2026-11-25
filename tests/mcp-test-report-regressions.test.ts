// Regression guards for the issues found in the 2026-11-25 read-only MCP test
// (company 103). The SQL cannot run here, so these pin the shape of each fix.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { summarizeClickHouseError } from '../src/clients/clickhouse';

const toolsRoot = path.join(process.cwd(), 'src/tools/athena_tools/tools');
const read = (rel: string) => fs.readFileSync(path.join(toolsRoot, rel), 'utf8');

test('ClickHouse errors keep the exception text, minus the version suffix', () => {
  const body =
    'Code: 241. DB::Exception: Memory limit (total) exceeded: would use 14.00 GiB. (MEMORY_LIMIT_EXCEEDED) (version 24.8.1.1)\n' +
    '0. stack frame\n';
  assert.equal(
    summarizeClickHouseError(body),
    'Code: 241. DB::Exception: Memory limit (total) exceeded: would use 14.00 GiB. (MEMORY_LIMIT_EXCEEDED)',
  );
  assert.equal(summarizeClickHouseError(''), '');
  assert.ok(summarizeClickHouseError('x'.repeat(5000)).length <= 601);
});

test('SQP detail query bounds its scan before the raw_payload extraction', () => {
  const sql = read('brand_analytics/analyze_search_query_performance/query.sql');
  const baseChild = sql.slice(sql.indexOf('FROM etl.ba_search_query_performance AS sqp'), sql.indexOf('date_bounds AS ('));
  assert.match(baseChild, /AND sqp\.week_start >= \(/, 'base_child must have a week_start lower bound');
  assert.match(baseChild, /sqp\.week_start <= \{\{end_date_sql\}\}/, 'base_child must honour end_date');
});

test('keyword funnel output never includes the LAG lookback week', () => {
  const sql = read('brand_analytics/get_keyword_funnel_metrics/query.sql');
  const final = sql.slice(sql.indexOf('final AS ('));
  assert.match(final, /f\.period_start >= \(SELECT start_date FROM date_bounds\)/);
  assert.match(final, /AS _window_end/);
});

test('sales performance no longer emits a currency-less UNKNOWN row for known marketplaces', () => {
  const sql = read('orders/analyze_sales_performance/query.sql');
  assert.match(sql, /coalesce\(f\.currency, marketplace_currency\)\s+AS currency/);
  for (const col of ['zero_value_orders', 'currency_imputed_orders', 'marketplace_currency', 'is_marketplace_currency']) {
    assert.ok(sql.includes(` AS ${col}`) || sql.includes(`  ${col},`), `missing output column ${col}`);
  }
  const spec = JSON.parse(read('orders/analyze_sales_performance/tool.json'));
  const props = spec.outputSchema.properties.items.items.properties;
  for (const col of ['zero_value_orders', 'currency_imputed_orders', 'marketplace_currency', 'is_marketplace_currency']) {
    assert.ok(props[col], `outputSchema missing ${col}`);
  }
});

test('SQP child rows convert Amazon percentages to fractions', () => {
  const sql = read('brand_analytics/analyze_search_query_performance/query.sql');
  for (const col of [
    'asin_impression_share', 'asin_click_share', 'asin_cart_add_share', 'asin_purchase_share',
    'total_click_rate', 'total_cart_add_rate', 'total_purchase_rate',
  ]) {
    assert.ok(
      !sql.includes(`CAST(sqp.${col} AS Nullable(Float64))`),
      `${col} is read without the /100 percentage-to-fraction conversion`,
    );
  }
  assert.match(sql, /CAST\(sqp\.asin_click_share \/ 100 AS Nullable\(Float64\)\) AS kpi_click_share/);
});

test("a placeholder 'undefined' parent ASIN is treated as missing", () => {
  for (const [rel, alias] of [
    ['brand_analytics/analyze_search_query_performance/query.sql', 'sqp'],
    ['brand_analytics/analyze_search_query_performance/query_grouped.sql', 'sqp'],
    ['brand_analytics/analyze_search_catalog_performance/query.sql', 'scp'],
  ] as const) {
    const sql = read(rel);
    assert.ok(!sql.includes(`ifNull(nullIf(${alias}.parent_asin, ''), ${alias}.asin)`), `${rel} still only treats '' as missing`);
    assert.ok(sql.includes("'undefined'"), `${rel} does not handle the 'undefined' placeholder`);
  }
});
