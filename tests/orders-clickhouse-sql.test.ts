import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { renderSqlTemplate } from '../src/tools/athena_tools/runtime/render-sql';
import {
  normalizeFulfillmentChannels,
  normalizeOrderStatuses,
  sqlBigintArrayExpr,
  sqlDateExpr,
  sqlStringLiteral,
  sqlVarcharArrayExpr,
} from '../src/tools/athena_tools/tools/orders/_shared';

const ordersRoot = path.join(process.cwd(), 'src/tools/athena_tools/tools/orders');

const common = {
  company_ids_array: sqlBigintArrayExpr([107]),
  marketplaces_array: sqlVarcharArrayExpr([]),
  order_statuses_array: sqlVarcharArrayExpr(normalizeOrderStatuses(['shipped', 'partially shipped'])),
  fulfillment_channels_array: sqlVarcharArrayExpr(normalizeFulfillmentChannels(['AMAZON'])),
  seller_ids_array: sqlVarcharArrayExpr([]),
  start_date_sql: sqlDateExpr('2026-10-13'),
  end_date_sql: sqlDateExpr(undefined),
  periods_back: 3,
  limit_top_n: 20,
  utc_offset_minutes: -480,
  granularity: 'day',
};

const cases: Array<{ tool: string; vars: Record<string, string | number>; table: RegExp }> = [
  { tool: 'analyze_sales_performance', vars: { ...common }, table: /analytics\.order_details_v2026_current/ },
  {
    tool: 'list_orders',
    vars: { ...common, order_ids_array: sqlVarcharArrayExpr(["112-1'; DROP"]) },
    table: /analytics\.order_details_v2026_current/,
  },
  {
    tool: 'list_top_products',
    vars: {
      ...common,
      asins_array: sqlVarcharArrayExpr([]),
      skus_array: sqlVarcharArrayExpr([]),
      sort_column: 'gross_revenue',
      sort_direction: 'DESC',
      min_orders: 0,
    },
    table: /analytics\.order_details_v2026_current/,
  },
  {
    tool: 'compare_sales_velocity',
    vars: {
      ...common,
      skus_array: sqlVarcharArrayExpr([]),
      asins_array: sqlVarcharArrayExpr([]),
      brands_array: sqlVarcharArrayExpr([]),
      product_families_array: sqlVarcharArrayExpr([]),
      offsets_array: sqlBigintArrayExpr([1, 7]),
      prune_months_back: 3,
      group_by: 'sku',
      group_dim_expr: 'e.sku',
      metric_pivot_columns: 'SUM(CASE WHEN offset_days = 0 THEN units END) AS current_units_sold',
      select_columns: 'current_units_sold',
    },
    table: /analytics\.order_details_v2026_current/,
  },
  {
    tool: 'get_order_details',
    vars: { company_id: 107, order_id_str: sqlStringLiteral('113-7083050-5615467') },
    table: /analytics\.order_details_v2026\b/,
  },
];

test('customer_orders queries render against ClickHouse only', () => {
  for (const { tool, vars, table } of cases) {
    const sql = fs.readFileSync(path.join(ordersRoot, tool, 'query.sql'), 'utf8');
    const rendered = renderSqlTemplate(sql, vars);
    assert.doesNotMatch(rendered, /\{\{.*?\}\}/, `${tool} has an unresolved token`);
    assert.doesNotMatch(rendered, /iceberg|orders_v2026"|sp_api|AT TIME ZONE|CROSS JOIN UNNEST|DATE_ADD\(/i, `${tool} still uses Athena syntax`);
    assert.match(rendered, table, `${tool} must read the ClickHouse orders table`);
  }
});

test('no orders tool still talks to Athena', () => {
  for (const f of ['_shared.ts', ...cases.map((c) => `${c.tool}/register.ts`)]) {
    const src = fs.readFileSync(path.join(ordersRoot, f), 'utf8');
    assert.doesNotMatch(src, /runAthenaQuery|config\.athena|sp_api_iceberg/, `${f} still references Athena`);
  }
});

test('status and channel inputs are normalised to the stored contract', () => {
  assert.deepEqual(normalizeOrderStatuses(['shipped', 'Partially Shipped', ' pending-availability ']), [
    'SHIPPED',
    'PARTIALLY_SHIPPED',
    'PENDING_AVAILABILITY',
  ]);
  assert.deepEqual(normalizeFulfillmentChannels(['AMAZON', 'amazon', 'MERCHANT']), ['AFN', 'MFN']);
  assert.equal(sqlStringLiteral("a'b\\c"), "'a\\'b\\\\c'");
});
