import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { renderSqlTemplate } from '../src/tools/athena_tools/runtime/render-sql';
import {
  TOOL_NAME as WAREHOUSES_TOOL_NAME,
  buildFulfillmentWarehousesSqlVariables,
  inputSchema as warehousesInputSchema,
  mapFulfillmentWarehouseRow,
} from '../src/tools/athena_tools/tools/supply_chain/list_fulfillment_warehouses/register';
import {
  TOOL_NAME as RESTOCK_TOOL_NAME,
  buildWarehouseRestockSqlVariables,
  inputSchema as restockInputSchema,
  mapWarehouseRestockRow,
  parseVelocityByChannel,
} from '../src/tools/athena_tools/tools/supply_chain/list_warehouse_restock_candidates/register';

const CONNECTOR_TOOL_PREFIX = 'mcp_neonpanel_';
const MAX_CONNECTOR_TOOL_NAME_LENGTH = 64;

const supplyChainRoot = path.join(process.cwd(), 'src/tools/athena_tools/tools/supply_chain');

const athenaRuntimeOrSql = new RegExp([
  'runAthenaQuery',
  'config\\.athena',
  '\\{\\{catalog\\}\\}',
  '\\{\\{database\\}\\}',
  '\\{\\{table\\}\\}',
  '\\bcontains\\s*\\(',
  '\\bcardinality\\s*\\(',
  '\\bUNNEST\\b',
  '\\bVARCHAR\\b',
  '\\bBIGINT\\b',
  '\\belement_at\\s*\\(',
  '\\bdate_add\\s*\\(',
  '\\bdate_format\\s*\\(',
].join('|'), 'i');

const tools = [
  { dir: 'list_fulfillment_warehouses', name: WAREHOUSES_TOOL_NAME, source: /etl\.fulfillment_warehouses/ },
  { dir: 'list_warehouse_restock_candidates', name: RESTOCK_TOOL_NAME, source: /etl\.inventory_planning_warehouse/ },
];

for (const tool of tools) {
  test(`${tool.name} fits the connector name limit`, () => {
    assert.ok(`${CONNECTOR_TOOL_PREFIX}${tool.name}`.length <= MAX_CONNECTOR_TOOL_NAME_LENGTH);
  });

  test(`${tool.name} executes through ClickHouse against its serving view`, () => {
    const register = fs.readFileSync(path.join(supplyChainRoot, tool.dir, 'register.ts'), 'utf8');
    const sql = fs.readFileSync(path.join(supplyChainRoot, tool.dir, 'query.sql'), 'utf8');
    const spec = JSON.parse(fs.readFileSync(path.join(supplyChainRoot, tool.dir, 'tool.json'), 'utf8'));

    assert.match(register, /runClickHouseQuery/);
    assert.match(register, /canReadSupplyChainCompany/);
    assert.doesNotMatch(register, athenaRuntimeOrSql);
    assert.match(sql, tool.source);
    assert.doesNotMatch(sql, athenaRuntimeOrSql);
    assert.equal(spec.name, tool.name);
    assert.deepEqual(spec.inputSchema.required, ['company_id']);
    assert.equal(spec.inputSchema.additionalProperties, false);
  });
}

test('tool.json input properties match the zod schemas', () => {
  for (const [dir, schema] of [
    ['list_fulfillment_warehouses', warehousesInputSchema],
    ['list_warehouse_restock_candidates', restockInputSchema],
  ] as const) {
    const spec = JSON.parse(fs.readFileSync(path.join(supplyChainRoot, dir, 'tool.json'), 'utf8'));
    assert.deepEqual(Object.keys(spec.inputSchema.properties).sort(), Object.keys(schema.shape).sort());
  }
});

test('fulfillment warehouses SQL renders with every placeholder substituted', () => {
  const template = fs.readFileSync(path.join(supplyChainRoot, 'list_fulfillment_warehouses/query.sql'), 'utf8');
  const input = warehousesInputSchema.parse({ company_id: 106 });
  const sql = renderSqlTemplate(template, buildFulfillmentWarehousesSqlVariables(input));

  assert.doesNotMatch(sql, /\{\{|\}\}/);
  assert.match(sql, /toUInt64\(106\)/);
  assert.match(sql, /\(FALSE OR fw\.is_fulfillment = 1\)/);
  assert.match(sql, /ORDER BY units_sold_90d DESC/);
  assert.match(sql, /LIMIT 50\b/);

  const all = renderSqlTemplate(
    template,
    buildFulfillmentWarehousesSqlVariables(warehousesInputSchema.parse({ company_id: 106, include_non_eligible: true, limit: 5 })),
  );
  assert.match(all, /\(TRUE OR fw\.is_fulfillment = 1\)/);
  assert.match(all, /LIMIT 5\b/);
});

test('warehouse restock SQL renders defaults with every placeholder substituted', () => {
  const template = fs.readFileSync(path.join(supplyChainRoot, 'list_warehouse_restock_candidates/query.sql'), 'utf8');
  const sql = renderSqlTemplate(template, buildWarehouseRestockSqlVariables(restockInputSchema.parse({ company_id: 106 })));

  assert.doesNotMatch(sql, /\{\{|\}\}/);
  assert.match(sql, /'current' AS sales_velocity/);
  assert.match(sql, /toFloat64\(0\.5\) AS weight_30d/);
  assert.match(sql, /toFloat64\(0\.3\) AS weight_7d/);
  assert.match(sql, /toFloat64\(0\.2\) AS weight_3d/);
  assert.match(sql, /FALSE AS lead_time_override_enabled/);
  assert.match(sql, /FALSE AS safety_stock_override_enabled/);
  assert.match(sql, /toFloat64\(14\) AS days_between_shipments/);
  assert.match(sql, /toInt64\(7\) AS stockout_threshold_days/);
  assert.match(sql, /'needs_replenishment' AS planning_base/);
  assert.match(sql, /TRUE AS include_components/);
  assert.match(sql, /CAST\(\[\], 'Array\(UInt64\)'\) AS warehouse_ids/);
  assert.match(sql, /CAST\(\[\], 'Array\(String\)'\) AS sales_channels/);
  assert.match(sql, /LIMIT 50\b/);
});

test('warehouse restock SQL renders custom parameters and recomputes outputs', () => {
  const template = fs.readFileSync(path.join(supplyChainRoot, 'list_warehouse_restock_candidates/query.sql'), 'utf8');
  const input = restockInputSchema.parse({
    company_id: 106,
    warehouse_ids: [42, 43],
    sales_channels: ['Shopify', ' shopify ', "O'Brien Wholesale"],
    sales_velocity: 'planned',
    velocity_weighting: { weight_30d: 1, weight_7d: 0, weight_3d: 0 },
    lead_time_days_override: 21,
    safety_stock_days_override: 5,
    days_between_shipments: 7,
    stockout_threshold_days: 3,
    planning_base: 'all',
    revenue_abcd_class: ['A', 'B'],
    brand: ['Acme'],
    product_family: ['Widgets'],
    target_skus: ['SKU-1'],
    target_inventory_ids: [9001],
    include_components: false,
    limit: 10,
  });
  const sql = renderSqlTemplate(template, buildWarehouseRestockSqlVariables(input));

  assert.doesNotMatch(sql, /\{\{|\}\}/);
  assert.match(sql, /'planned' AS sales_velocity/);
  assert.match(sql, /TRUE AS lead_time_override_enabled/);
  assert.match(sql, /toFloat64\(21\) AS lead_time_days_override/);
  assert.match(sql, /toFloat64\(5\) AS safety_stock_days_override/);
  assert.match(sql, /\[42,43\] AS warehouse_ids/);
  // Channels are lowercased, trimmed, de-duplicated and escaped.
  assert.match(sql, /\['shopify','o\\'brien wholesale'\] AS sales_channels/);
  assert.match(sql, /\['A','B'\] AS revenue_abcd_classes/);
  assert.match(sql, /FALSE AS include_components/);
  assert.match(sql, /'all' AS planning_base/);
  assert.match(sql, /\[9001\] AS inventory_ids/);
  assert.match(sql, /LIMIT 10\b/);

  // Recomputation from raw view columns, not a pass-through of the view's defaults.
  assert.match(sql, /JSONExtractKeys\(/);
  assert.match(sql, /f\.planned_daily_rate/);
  assert.match(sql, /f\.target_daily_rate/);
  assert.match(sql, /f\.avg_units_30d/);
  assert.match(sql, /dependent_daily_units/);
  assert.match(sql, /'override'/);
  assert.match(sql, /r\.ss_days AS ss_eff/);
  assert.match(sql, /f\.units_30d <= 0, f\.units_90d \/ 90/);
  assert.match(sql, /99999/);
  assert.match(sql, /floor\(d\.eff_available \/ d\.rate - d\.ss_eff - d\.lt_days\)/);
  assert.match(sql, /o\.assembles_at_wh = 1/);
  assert.match(sql, /planning_source != 'COMPONENT'/);
});

test('restock schema rejects unknown and nested wrapper keys', () => {
  assert.throws(() => restockInputSchema.parse({ company_id: 1, query: { limit: 5 } }));
  assert.throws(() => restockInputSchema.parse({ company_id: 1, sales_velocity: 'blended' }));
  assert.throws(() => restockInputSchema.parse({ warehouse_ids: [1] }));
});

test('parseVelocityByChannel tolerates bad input', () => {
  assert.deepEqual(parseVelocityByChannel('{"Shopify":12,"Amazon.com":"3"}'), { Shopify: 12, 'Amazon.com': 3 });
  assert.deepEqual(parseVelocityByChannel('not json'), {});
  assert.deepEqual(parseVelocityByChannel(null), {});
  assert.deepEqual(parseVelocityByChannel('[]'), {});
});

test('restock row mapping builds item_ref, presentation, parsed fields and reason', () => {
  const row = mapWarehouseRestockRow({
    company_id: 106,
    warehouse_id: 42,
    warehouse_name: 'East 3PL',
    inventory_id: 9001,
    sku: 'SKU-1',
    product_name: 'Widget',
    child_asin: 'B000000001',
    image_url: 'https://example.com/w.jpg',
    planning_source: 'SHIP',
    assembles_at_wh: 0,
    is_component_at_wh: 1,
    parent_product_ids: '11,12',
    channel_units_30d_json: '{"Shopify":30}',
    sales_velocity_mode: 'current',
    daily_sales_rate: 2,
    dependent_daily_units: 0.5,
    days_of_supply: 20,
    lead_time_days: 21,
    lead_time_days_source: 'history_item',
    safety_stock_days_eff: 12,
    ship_due_in_days: -13,
    days_overdue: 13,
    recommended_ship_qty: 48,
    recommended_assembly_units: 0,
    typical_origin_warehouse_id: 7,
    typical_origin_warehouse_name: 'Main DC',
    origin_on_hand_units: 500,
    binding_component_product_id: 0,
    priority: 'critical',
  });

  assert.deepEqual(row.item_ref, {
    inventory_id: 9001,
    sku: 'SKU-1',
    asin: 'B000000001',
    warehouse_id: 42,
    warehouse_name: 'East 3PL',
    item_name: 'Widget',
    item_icon_url: 'https://example.com/w.jpg',
  });
  assert.equal(row.presentation.identity.marketplace_code, undefined);
  assert.equal(row.presentation.links.amazon_storefront.url, 'https://www.amazon.com/dp/B000000001');
  assert.deepEqual(row.velocity_by_channel, { Shopify: 30 });
  assert.deepEqual(row.parent_product_ids, [11, 12]);
  assert.equal(row.assembles_at_wh, false);
  assert.equal(row.is_component_at_wh, true);
  assert.equal(row.binding_component_product_id, null);
  assert.match(row.reason, /^critical: /);
  assert.match(row.reason, /overdue by 13/);
  assert.match(row.reason, /ship 48 unit\(s\) \(typically from Main DC, 500 on hand\)/);
});

test('fulfillment warehouse row mapping converts UInt8 flags', () => {
  const row = mapFulfillmentWarehouseRow({
    company_id: 106,
    warehouse_id: 42,
    is_planning_eligible_type: 1,
    is_fulfillment: 0,
    sales_channels_90d: ['Shopify'],
    median_lead_time_days: null,
  });
  assert.equal(row.is_planning_eligible_type, true);
  assert.equal(row.is_fulfillment, false);
  assert.deepEqual(row.sales_channels_90d, ['Shopify']);
  assert.equal(row.median_lead_time_days, null);
  assert.equal(row.default_lead_time_days, 30);
});
