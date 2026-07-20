import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const forecastingRoot = path.join(
  process.cwd(),
  'src/tools/athena_tools/tools/forecasting',
);

function readForecastingAsset(tool: string, file: string): string {
  return fs.readFileSync(path.join(forecastingRoot, tool, file), 'utf8');
}

const athenaRuntimeOrSql = new RegExp([
  'runAthenaQuery',
  'config\\.athena',
  '\\{\\{catalog\\}\\}',
  '\\{\\{database\\}\\}',
  '\\{\\{table\\}\\}',
  '\\{\\{forecast_catalog\\}\\}',
  '\\{\\{forecast_database\\}\\}',
  '\\{\\{forecast_table_sales_forecast\\}\\}',
  '\\{\\{forecasting_database\\}\\}',
  '\\{\\{sales_forecast_table\\}\\}',
  '\\bUNNEST\\b',
  '\\bVARCHAR\\b',
  '\\bjson_format\\b',
  '\\bfrom_iso8601_timestamp\\b',
].join('|'), 'i');

test('forecast catalog reads etl.sales_forecast from ClickHouse', () => {
  const sqlPath = path.join(
    process.cwd(),
    'src/tools/athena_tools/tools/forecasting/list_sales_forecasts/query.sql',
  );
  const sql = fs.readFileSync(sqlPath, 'utf8');

  assert.match(sql, /FROM etl\.sales_forecast AS f/);
  assert.match(sql, /has\(p\.company_ids, f\.company_id\)/);
  assert.doesNotMatch(sql, /\{\{catalog\}\}|\{\{forecasting_database\}\}|\{\{sales_forecast_table\}\}/);
});

test('manual forecast writes validate and persist only through ClickHouse', () => {
  const register = readForecastingAsset('write_sales_forecast', 'register.ts');

  assert.match(register, /runClickHouseQuery/);
  assert.match(register, /insertClickHouseJsonEachRow/);
  assert.match(register, /FROM etl\.sku_dimensions/);
  assert.doesNotMatch(register, /runAthenaQuery|config\.athena|Iceberg write/);

  for (const obsoleteAsset of ['query.sql', 'insert.sql', 'delete.sql', 'audit_insert.sql']) {
    assert.equal(
      fs.existsSync(path.join(forecastingRoot, 'write_sales_forecast', obsoleteAsset)),
      false,
    );
  }
});

for (const tool of [
  'get_sales_forecast_details',
  'compare_sales_forecast_scenarios',
]) {
  test(`${tool} executes through ClickHouse`, () => {
    const register = readForecastingAsset(tool, 'register.ts');

    assert.match(register, /runClickHouseQuery/);
    assert.doesNotMatch(register, athenaRuntimeOrSql);
  });

  for (const sqlFile of ['query.sql', 'query_grouped.sql']) {
    test(`${tool}/${sqlFile} uses production ClickHouse tables and dialect`, () => {
      const sql = readForecastingAsset(tool, sqlFile);

      assert.match(sql, /etl\.sales_forecast\s+AS\s+\w+/);
      assert.doesNotMatch(sql, /sales_forecast\s+AS\s+\w+\s+FINAL/);
      assert.match(sql, /etl\.inventory_planning_snapshot/);
      assert.match(sql, /has\(p\.company_ids,/);
      assert.doesNotMatch(sql, athenaRuntimeOrSql);
    });
  }
}

test('forecast detail SQL keeps ClickHouse CTE aliases and grouped horizon local', () => {
  const detailSql = readForecastingAsset('get_sales_forecast_details', 'query.sql');
  const groupedSql = readForecastingAsset('get_sales_forecast_details', 'query_grouped.sql');

  assert.match(detailSql, /FROM forecast_item_periods AS periods/);
  assert.doesNotMatch(detailSql, /max\(fp\.scenario_uuid\)/);
  assert.match(groupedSql, /toUInt32\(\{\{horizon_months\}\}\) AS horizon_months/);
  assert.match(groupedSql, /fp\.period_rank <= fp\.horizon_months/);
  assert.doesNotMatch(groupedSql, /fp\.period_rank <= p\.horizon_months/);
});

test('forecast comparison SQL aliases nested subqueries and deduplicates per company', () => {
  for (const sqlFile of ['query.sql', 'query_grouped.sql']) {
    const sql = readForecastingAsset('compare_sales_forecast_scenarios', sqlFile);

    assert.match(sql, /SELECT filtered_items\.\*, row_number\(\) OVER/);
    assert.match(sql, /\) AS filtered_items\s+WHERE filtered_items\.dedup_rank = 1/);
    assert.match(sql, /\) AS ranked_items\s+CROSS JOIN params AS p/);
    assert.match(sql, /\) AS distinct_runs\s+\) AS ranked_runs/);
    assert.match(sql, /PARTITION BY pil\.company_id, coalesce\(pil\.sku/);
  }
});
