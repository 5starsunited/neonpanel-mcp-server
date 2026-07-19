import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

test('forecast catalog reads analytics.sales_forecast from ClickHouse', () => {
  const sqlPath = path.join(
    process.cwd(),
    'src/tools/athena_tools/tools/forecasting/list_sales_forecasts/query.sql',
  );
  const sql = fs.readFileSync(sqlPath, 'utf8');

  assert.match(sql, /FROM analytics\.sales_forecast AS f FINAL/);
  assert.match(sql, /has\(p\.company_ids, f\.company_id\)/);
  assert.doesNotMatch(sql, /\{\{catalog\}\}|\{\{forecasting_database\}\}|\{\{sales_forecast_table\}\}/);
});
