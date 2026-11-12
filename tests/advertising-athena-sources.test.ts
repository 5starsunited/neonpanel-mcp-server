import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { renderSqlTemplate } from '../src/tools/athena_tools/runtime/render-sql';

const root = path.join(process.cwd(), 'src/tools/athena_tools/tools/amazon_advertising');
const empty = 'CAST(ARRAY[] AS ARRAY(VARCHAR))';
const flags = (names: string[]) => Object.fromEntries(names.map((n) => [`group_by_${n}`, 0]));

const campaignVars = {
  catalog: 'awsdatacatalog', limit_top_n: 10, start_date_sql: 'CAST(NULL AS DATE)', end_date_sql: 'CAST(NULL AS DATE)',
  periods_back: 4, company_ids_array: 'CAST(ARRAY[107] AS ARRAY(BIGINT))', campaign_types_array: empty,
  marketplaces_array: empty, campaign_names_array: empty, ad_group_names_array: empty, target_keywords_array: empty,
  keyword_match_type_sql: "'contains'", placements_array: empty, match_types_array: empty, asins_array: empty,
  product_families_array: empty, brands_array: empty, period_expr: 'CAST(NULL AS VARCHAR)',
  sort_column: 'cost_usd', sort_direction: 'DESC',
  ...flags(['campaign_name', 'ad_group_name', 'placement', 'match_type', 'dataset', 'target_keyword', 'advertised_asin', 'product_family', 'brand', 'company', 'marketplace']),
};
const searchVars = {
  catalog: 'awsdatacatalog', limit_top_n: 10, start_date_sql: 'CAST(NULL AS DATE)', end_date_sql: 'CAST(NULL AS DATE)',
  periods_back: 4, company_ids_array: 'CAST(ARRAY[107] AS ARRAY(BIGINT))', search_terms_array: empty,
  match_type_sql: "'contains'", marketplaces_array: empty, campaign_names_array: empty, match_types_array: empty,
  asins_array: empty, product_families_array: empty, brands_array: empty, pareto_classes_array: empty,
  revenue_classes_array: empty, sort_column: 'cost_usd', sort_direction: 'DESC',
  ...flags(['search_term', 'campaign_name', 'match_type', 'product_family', 'brand', 'pareto_class']),
};

const DEAD = /brand_analytics_iceberg|amazon_ads_unified|analytics\.amazon_ads/;

test('campaign performance reads the Athena Ads serving table, scoped by company, without organic rows', () => {
  const dir = path.join(root, 'analyze_campaign_performance');
  const rendered = renderSqlTemplate(fs.readFileSync(path.join(dir, 'query.sql'), 'utf8'), campaignVars);
  assert.doesNotMatch(rendered, /\{\{.*?\}\}/);
  assert.doesNotMatch(rendered, DEAD);
  assert.match(rendered, /"awsdatacatalog"\."amazon_ads"\."ads_dataset"/);
  assert.match(rendered, /contains\(p\.company_ids, a\.company_id\)/);
  assert.match(rendered, /a\.dataset IN \('sponsored_products'[^)]*'sb_ads'\)/);
  assert.doesNotMatch(rendered, /SETTINGS join_use_nulls/);
  const register = fs.readFileSync(path.join(dir, 'register.ts'), 'utf8');
  assert.match(register, /runAthenaQuery/);
  assert.doesNotMatch(register, /runClickHouseQuery/);
});

test('search terms no longer joins the retired brand_analytics_iceberg tables', () => {
  const dir = path.join(root, 'analyze_search_terms');
  const rendered = renderSqlTemplate(fs.readFileSync(path.join(dir, 'query.sql'), 'utf8'), searchVars);
  assert.doesNotMatch(rendered, /\{\{.*?\}\}/);
  assert.doesNotMatch(rendered, DEAD);
  assert.match(rendered, /"amazon_ads"\."ads_dataset"/);
  assert.match(rendered, /WHERE rn = 1/);
  assert.match(rendered, /contains\(p\.company_ids, d\.company_id\)/);
  const register = fs.readFileSync(path.join(dir, 'register.ts'), 'utf8');
  assert.match(register, /unsupported_filter/);
});
