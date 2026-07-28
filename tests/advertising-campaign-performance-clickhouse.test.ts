import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { renderSqlTemplate } from '../src/tools/athena_tools/runtime/render-sql';

const toolRoot = path.join(
  process.cwd(),
  'src/tools/athena_tools/tools/amazon_advertising/analyze_campaign_performance',
);
const sql = fs.readFileSync(path.join(toolRoot, 'query.sql'), 'utf8');
const register = fs.readFileSync(path.join(toolRoot, 'register.ts'), 'utf8');
const spec = JSON.parse(fs.readFileSync(path.join(toolRoot, 'tool.json'), 'utf8')) as {
  inputSchema: { properties: { query: { properties: { filters: { properties: Record<string, unknown> } } } } };
};

const periodExpressions = [
  'toString(w.report_date)',
  "formatDateTime(w.report_date, '%Y-%m')",
  'toString(toYear(w.report_date))',
  'CAST(NULL AS Nullable(String))',
];

function templateVariables(periodExpr: string): Record<string, string | number> {
  return {
    company_ids_array: 'CAST([81] AS Array(UInt64))',
    campaign_types_array: 'CAST([] AS Array(String))',
    marketplaces_array: 'CAST([] AS Array(String))',
    campaign_names_array: 'CAST([] AS Array(String))',
    ad_group_names_array: 'CAST([] AS Array(String))',
    target_keywords_array: 'CAST([] AS Array(String))',
    keyword_match_type_sql: "'contains'",
    placements_array: 'CAST([] AS Array(String))',
    match_types_array: 'CAST([] AS Array(String))',
    asins_array: 'CAST([] AS Array(String))',
    product_families_array: 'CAST([] AS Array(String))',
    brands_array: 'CAST([] AS Array(String))',
    start_date_sql: 'CAST(NULL AS Nullable(Date))',
    end_date_sql: 'CAST(NULL AS Nullable(Date))',
    periods_back: 4,
    period_expr: periodExpr,
    sort_column: 'cost_usd',
    sort_direction: 'DESC',
    limit_top_n: 100,
    group_by_campaign_name: 1,
    group_by_ad_group_name: 0,
    group_by_placement: 0,
    group_by_match_type: 0,
    group_by_dataset: 0,
    group_by_target_keyword: 0,
    group_by_advertised_asin: 0,
    group_by_product_family: 0,
    group_by_brand: 0,
    group_by_company: 0,
    group_by_marketplace: 0,
  };
}

test('campaign performance executes through ClickHouse with supported dimensions only', () => {
  assert.match(register, /runClickHouseQuery/);
  assert.doesNotMatch(register, /runAthenaQuery|pareto_abc_classes|revenue_abcd_classes/);
  assert.doesNotMatch(sql, /brand_analytics\.asin_attributes|pareto_abc_class|revenue_abcd_class|revenue_share/);
  assert.ok(spec.inputSchema.properties.query.properties.filters.properties.product_families);
  assert.ok(spec.inputSchema.properties.query.properties.filters.properties.brands);
  assert.equal(spec.inputSchema.properties.query.properties.filters.properties.pareto_abc_classes, undefined);
  assert.equal(spec.inputSchema.properties.query.properties.filters.properties.revenue_abcd_classes, undefined);
});

test('campaign performance SQL renders for every supported periodicity', () => {
  for (const periodExpr of periodExpressions) {
    const rendered = renderSqlTemplate(sql, templateVariables(periodExpr));
    assert.doesNotMatch(rendered, /\{\{.*?\}\}/, `unresolved token for ${periodExpr}`);
    assert.match(rendered, /analytics\.amazon_ads_unified/);
    assert.match(rendered, /SETTINGS join_use_nulls = 1/);
  }
});