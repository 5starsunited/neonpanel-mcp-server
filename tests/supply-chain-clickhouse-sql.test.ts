import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const supplyChainRoot = path.join(
  process.cwd(),
  'src/tools/athena_tools/tools/supply_chain',
);

const migratedTools = [
  'analyze_sales_velocity',
  'list_fba_replenishment_candidates',
  'list_po_placement_candidates',
];

const athenaRuntimeOrSql = new RegExp([
  'runAthenaQuery',
  'config\\.athena',
  '\\{\\{catalog\\}\\}',
  '\\{\\{database\\}\\}',
  '\\{\\{table\\}\\}',
  '\\{\\{forecasting_database\\}\\}',
  '\\{\\{sales_forecast_table\\}\\}',
  '\\bcontains\\s*\\(',
  '\\bcardinality\\s*\\(',
  '\\bUNNEST\\b',
  '\\bVARCHAR\\b',
  '\\bBIGINT\\b',
  '\\breduce\\s*\\(',
  '\\belement_at\\s*\\(',
  '\\bdate_add\\s*\\(',
  '\\bdate_format\\s*\\(',
].join('|'), 'i');

for (const tool of migratedTools) {
  test(`${tool} executes through ClickHouse`, () => {
    const register = fs.readFileSync(path.join(supplyChainRoot, tool, 'register.ts'), 'utf8');

    assert.match(register, /runClickHouseQuery/);
    assert.doesNotMatch(register, athenaRuntimeOrSql);
  });

  test(`${tool} SQL uses production ClickHouse tables and dialect`, () => {
    const sql = fs.readFileSync(path.join(supplyChainRoot, tool, 'query.sql'), 'utf8');

    assert.match(sql, /etl\.sales_forecast\s+AS\s+\w+/);
    assert.doesNotMatch(sql, /sales_forecast\s+AS\s+\w+\s+FINAL/);
    assert.match(sql, /etl\.inventory_planning_snapshot/);
    assert.match(sql, /QUALIFY\s+row_number\(\)\s+OVER/i);
    assert.match(sql, /toUInt64\(pil\.company_id\)\s+AS\s+company_id/i);
    assert.match(sql, /toUInt64\(pil\.inventory_id\)\s+AS\s+inventory_id/i);
    assert.doesNotMatch(sql, athenaRuntimeOrSql);
  });
}