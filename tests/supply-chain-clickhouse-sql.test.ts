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

    assert.match(sql, /analytics\.sales_forecast\s+AS\s+\w+\s+FINAL/);
    assert.match(sql, /etl\.inventory_planning_snapshot/);
    assert.match(sql, /QUALIFY\s+row_number\(\)\s+OVER/i);
    assert.match(sql, /toUInt64\(pil\.company_id\)\s+AS\s+company_id/i);
    assert.match(sql, /toUInt64\(pil\.inventory_id\)\s+AS\s+inventory_id/i);
    assert.doesNotMatch(sql, athenaRuntimeOrSql);
  });
}

const bomTools = [
  {
    name: 'list_bom_planning_items',
    source: 'etl.inventory_planning_bom',
    requiredFields: [
      'planning_source',
      'buildable_from_components_units',
      'binding_component_sku',
      'effective_available_units',
      'days_of_cover_incl_components',
      'cumulative_lead_time_days',
      'assembly_shortfall_units_actual',
    ],
  },
  {
    name: 'list_component_buy_plan',
    source: 'etl.inventory_planning_component_plan',
    requiredFields: [
      'has_inventory_item',
      'dependent_actual_daily_units',
      'net_requirement_units_actual',
      'net_requirement_units_plan',
      // net_requirement_units_plan is derived from the combined forecast, so the
      // tool must return it rather than dependent demand alone.
      'total_plan_units_arr',
    ],
  },
];

for (const tool of bomTools) {
  test(`${tool.name} delegates BOM planning calculations to its serving view`, () => {
    const register = fs.readFileSync(path.join(supplyChainRoot, tool.name, 'register.ts'), 'utf8');
    const sql = fs.readFileSync(path.join(supplyChainRoot, tool.name, 'query.sql'), 'utf8');

    assert.match(register, /runClickHouseQuery/);
    assert.match(sql, new RegExp(tool.source.replaceAll('.', '\\.')));
    for (const field of tool.requiredFields) assert.match(sql, new RegExp(`\\b${field}\\b`));
    assert.doesNotMatch(sql, /lead_time_days\s*\+\s*component/i);
    assert.doesNotMatch(sql, /wip_total_ordered_quantity/i);
    assert.doesNotMatch(sql, /product_type\s*=\s*'Assembly'/i);
  });
}