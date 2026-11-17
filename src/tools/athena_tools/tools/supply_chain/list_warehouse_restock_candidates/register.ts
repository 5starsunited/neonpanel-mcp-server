import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runClickHouseQuery } from '../../../../../clients/clickhouse';
import type { ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';
import { buildItemPresentation } from '../../../runtime/presentation';
import { canReadSupplyChainCompany, sqlStringArray, sqlUInt64Array } from '../bom-planning';

export const TOOL_NAME = 'supply_chain_list_warehouse_restock_candidates';

export const DEFAULTS = {
  sales_velocity: 'current',
  velocity_weighting: { weight_30d: 0.5, weight_7d: 0.3, weight_3d: 0.2 },
  lead_time_days: 'view: median shipment/PO lead time into the warehouse (>= 3 events per item, else per warehouse), else 30',
  safety_stock_days: 'view: 10 days x revenue ABCD safety-stock multiplier',
  days_between_shipments: 14,
  stockout_threshold_days: 7,
  planning_base: 'needs_replenishment',
  include_components: true,
  limit: 50,
} as const;

export const inputSchema = z
  .object({
    company_id: z.coerce.number().int().min(1),
    warehouse_ids: z.array(z.coerce.number().int().min(1)).max(200).optional(),
    sales_channels: z.array(z.string().min(1)).max(50).optional(),
    sales_velocity: z.enum(['current', 'planned', 'target']).default('current').optional(),
    velocity_weighting: z
      .object({
        weight_30d: z.coerce.number().min(0).max(1).default(0.5).optional(),
        weight_7d: z.coerce.number().min(0).max(1).default(0.3).optional(),
        weight_3d: z.coerce.number().min(0).max(1).default(0.2).optional(),
      })
      .strict()
      .optional(),
    lead_time_days_override: z.coerce.number().int().min(0).max(730).optional(),
    safety_stock_days_override: z.coerce.number().int().min(0).max(730).optional(),
    days_between_shipments: z.coerce.number().int().min(0).max(365).default(14).optional(),
    stockout_threshold_days: z.coerce.number().int().min(0).max(365).default(7).optional(),
    planning_base: z
      .enum(['all', 'actively_sold_only', 'needs_replenishment'])
      .default('needs_replenishment')
      .optional(),
    revenue_abcd_class: z.array(z.enum(['A', 'B', 'C', 'D'])).optional(),
    brand: z.array(z.string()).optional(),
    product_family: z.array(z.string()).optional(),
    target_skus: z.array(z.string()).optional(),
    target_inventory_ids: z.array(z.coerce.number().int().min(1)).optional(),
    include_components: z.boolean().default(true).optional(),
    limit: z.coerce.number().int().min(1).max(2000).default(50).optional(),
  })
  .strict();

export type ListWarehouseRestockCandidatesInput = z.infer<typeof inputSchema>;

const fallbackOutputSchema = {
  type: 'object',
  properties: {
    items: { type: 'array', items: { type: 'object', additionalProperties: true } },
    meta: { type: 'object', additionalProperties: true },
  },
  required: ['items'],
};

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toInt(value: unknown): number | null {
  const n = toNumber(value);
  return n === null ? null : Math.trunc(n);
}

function toStr(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function toFlag(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function cleanStrings(values: string[] | undefined): string[] {
  return (values ?? []).map((v) => (typeof v === 'string' ? v.trim() : '')).filter((v) => v.length > 0);
}

export function resolveVelocityWeighting(input: ListWarehouseRestockCandidatesInput) {
  return {
    weight_30d: input.velocity_weighting?.weight_30d ?? DEFAULTS.velocity_weighting.weight_30d,
    weight_7d: input.velocity_weighting?.weight_7d ?? DEFAULTS.velocity_weighting.weight_7d,
    weight_3d: input.velocity_weighting?.weight_3d ?? DEFAULTS.velocity_weighting.weight_3d,
  };
}

export function buildWarehouseRestockSqlVariables(
  input: ListWarehouseRestockCandidatesInput,
): Record<string, string | number> {
  const weights = resolveVelocityWeighting(input);
  const salesChannels = Array.from(new Set(cleanStrings(input.sales_channels).map((c) => c.toLowerCase())));
  const abcd = (input.revenue_abcd_class ?? []).map((v) => v.toUpperCase());

  return {
    sales_velocity_sql: `'${input.sales_velocity ?? DEFAULTS.sales_velocity}'`,
    weight_30d: String(weights.weight_30d),
    weight_7d: String(weights.weight_7d),
    weight_3d: String(weights.weight_3d),
    lead_time_override_enabled_sql: input.lead_time_days_override === undefined ? 'FALSE' : 'TRUE',
    lead_time_days_override: Math.trunc(input.lead_time_days_override ?? 0),
    safety_stock_override_enabled_sql: input.safety_stock_days_override === undefined ? 'FALSE' : 'TRUE',
    safety_stock_days_override: Math.trunc(input.safety_stock_days_override ?? 0),
    days_between_shipments: Math.trunc(input.days_between_shipments ?? DEFAULTS.days_between_shipments),
    stockout_threshold_days: Math.trunc(input.stockout_threshold_days ?? DEFAULTS.stockout_threshold_days),
    planning_base_sql: `'${input.planning_base ?? DEFAULTS.planning_base}'`,
    include_components_sql: (input.include_components ?? DEFAULTS.include_components) ? 'TRUE' : 'FALSE',
    company_id: Math.trunc(input.company_id),
    warehouse_ids_array: sqlUInt64Array(input.warehouse_ids ?? []),
    sales_channels_array: sqlStringArray(salesChannels),
    revenue_abcd_classes_array: sqlStringArray(abcd),
    brands_array: sqlStringArray(cleanStrings(input.brand)),
    product_families_array: sqlStringArray(cleanStrings(input.product_family)),
    skus_array: sqlStringArray(cleanStrings(input.target_skus)),
    inventory_ids_array: sqlUInt64Array(input.target_inventory_ids ?? []),
    limit_top_n: Math.trunc(input.limit ?? DEFAULTS.limit),
  };
}

export function parseVelocityByChannel(json: unknown): Record<string, number> {
  if (typeof json !== 'string' || json.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [channel, units] of Object.entries(parsed as Record<string, unknown>)) {
      const n = toNumber(units);
      if (n !== null) out[channel] = n;
    }
    return out;
  } catch {
    return {};
  }
}

function parseIdList(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(toInt).filter((n): n is number => n !== null && n > 0);
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((s) => toInt(s.trim()))
    .filter((n): n is number => n !== null && n > 0);
}

function round(n: number | null, digits = 1): number | null {
  if (n === null) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function buildReason(row: {
  priority: string;
  sales_velocity: string;
  daily_sales_rate: number | null;
  dependent_daily_units: number | null;
  days_of_supply: number | null;
  lead_time_days: number | null;
  lead_time_days_source: string | null;
  safety_stock_days_eff: number | null;
  ship_due_in_days: number | null;
  recommended_ship_qty: number;
  recommended_assembly_units: number;
  planning_source: string | null;
  typical_origin_warehouse_name: string | null;
  origin_on_hand_units: number | null;
}): string {
  if (row.priority === 'no_demand') {
    return `No demand at this warehouse with sales_velocity='${row.sales_velocity}' (rate 0); no restock needed.`;
  }
  const parts: string[] = [];
  const dependent = row.dependent_daily_units ?? 0;
  parts.push(
    `${round(row.daily_sales_rate, 2)} units/day (${row.sales_velocity}${dependent > 0 ? `, incl. ${round(dependent, 2)}/day component demand` : ''})`,
  );
  parts.push(
    `${round(row.days_of_supply)} days of supply vs lead time ${round(row.lead_time_days)}d (${row.lead_time_days_source ?? 'default'}) + safety stock ${round(row.safety_stock_days_eff)}d`,
  );
  const due = row.ship_due_in_days;
  if (due !== null) {
    parts.push(due <= 0 ? `ship overdue by ${-due} day(s)` : `ship due in ${due} day(s)`);
  }
  if (row.planning_source === 'ASSEMBLE_AT_WAREHOUSE') {
    if (row.recommended_assembly_units > 0) parts.push(`assemble ${row.recommended_assembly_units} unit(s) at this warehouse`);
  } else if (row.recommended_ship_qty > 0) {
    parts.push(
      `ship ${row.recommended_ship_qty} unit(s)${row.typical_origin_warehouse_name ? ` (typically from ${row.typical_origin_warehouse_name}, ${round(row.origin_on_hand_units, 0) ?? 0} on hand)` : ''}`,
    );
  }
  return `${row.priority}: ${parts.join('; ')}.`;
}

export function mapWarehouseRestockRow(row: Record<string, unknown>) {
  const inventory_id = toInt(row.inventory_id) ?? undefined;
  const warehouse_id = toInt(row.warehouse_id);
  const sku = toStr(row.sku) ?? undefined;
  const asin = toStr(row.child_asin) ?? undefined;
  const item_name = toStr(row.product_name) ?? undefined;
  const item_icon_url = toStr(row.image_url) ?? undefined;
  const warehouse_name = toStr(row.warehouse_name);

  const item_ref = { inventory_id, sku, asin, warehouse_id, warehouse_name, item_name, item_icon_url };

  const mapped = {
    company_id: toInt(row.company_id),
    company_name: toStr(row.company_name),
    item_ref,
    presentation: buildItemPresentation({
      sku,
      asin,
      inventory_id,
      image_url: item_icon_url,
      image_source_field: 'item_ref.item_icon_url',
    }),
    product_id: toInt(row.product_id),
    brand: toStr(row.brand),
    product_family: toStr(row.product_family),
    vendor: toStr(row.vendor),
    revenue_abcd_class: toStr(row.revenue_abcd_class),
    ss_multiplier: toNumber(row.ss_multiplier),

    warehouse_id,
    warehouse_uuid: toStr(row.warehouse_uuid),
    warehouse_name,
    warehouse_type: toStr(row.warehouse_type),

    planning_source: toStr(row.planning_source),
    assembles_at_wh: toFlag(row.assembles_at_wh),
    is_component_at_wh: toFlag(row.is_component_at_wh),
    parent_product_ids: parseIdList(row.parent_product_ids),
    buildable_at_wh_units: toNumber(row.buildable_at_wh_units) ?? 0,
    binding_component_product_id: toInt(row.binding_component_product_id) || null,

    on_hand_units: toNumber(row.on_hand_units) ?? 0,
    in_transit_units: toNumber(row.in_transit_units) ?? 0,
    open_po_units: toNumber(row.open_po_units) ?? 0,
    available_units: toNumber(row.available_units) ?? 0,
    effective_available_units: toNumber(row.effective_available_units) ?? 0,

    sales_velocity: toStr(row.sales_velocity_mode) ?? 'current',
    daily_sales_rate: toNumber(row.daily_sales_rate) ?? 0,
    base_daily_rate: toNumber(row.base_daily_rate) ?? 0,
    dependent_daily_units: toNumber(row.dependent_daily_units) ?? 0,
    actual_daily_rate: toNumber(row.actual_daily_rate) ?? 0,
    blended_daily_rate: toNumber(row.blended_daily_rate) ?? 0,
    velocity_basis: row.velocity_basis == null ? null : String(row.velocity_basis),
    planned_daily_rate: toNumber(row.planned_daily_rate) ?? 0,
    planned_units_arrival_month: toNumber(row.planned_units_arrival_month) ?? 0,
    target_daily_rate: toNumber(row.target_daily_rate) ?? 0,
    units_3d: toNumber(row.units_3d) ?? 0,
    units_7d: toNumber(row.units_7d) ?? 0,
    units_30d: toNumber(row.units_30d) ?? 0,
    units_90d: toNumber(row.units_90d) ?? 0,
    avg_units_30d: toNumber(row.avg_units_30d) ?? 0,
    avg_units_7d: toNumber(row.avg_units_7d) ?? 0,
    avg_units_3d: toNumber(row.avg_units_3d) ?? 0,
    velocity_by_channel: parseVelocityByChannel(row.channel_units_30d_json),

    lead_time_days: toNumber(row.lead_time_days),
    lead_time_days_source: toStr(row.lead_time_days_source),
    lead_time_item_events: toInt(row.lead_time_item_events) ?? 0,
    lead_time_warehouse_events: toInt(row.lead_time_warehouse_events) ?? 0,
    lead_time_item_p80_days: toNumber(row.lead_time_item_p80_days),
    safety_stock_days: toNumber(row.safety_stock_days),
    safety_stock_days_source: toStr(row.safety_stock_days_source),
    safety_stock_days_eff: toNumber(row.safety_stock_days_eff),
    days_between_shipments: toNumber(row.replenishment_frequency_days),
    box_quantity: toNumber(row.box_quantity) ?? 0,

    days_of_supply: toNumber(row.days_of_supply),
    ship_due_in_days: toInt(row.ship_due_in_days),
    ship_due_date: toStr(row.ship_due_date),
    days_overdue: toInt(row.days_overdue) ?? 0,
    replenishment_need_units: toNumber(row.replenishment_need_units) ?? 0,
    recommended_ship_qty: toInt(row.recommended_ship_qty) ?? 0,
    recommended_assembly_units: toInt(row.recommended_assembly_units) ?? 0,

    typical_origin_warehouse_id: toInt(row.typical_origin_warehouse_id) || null,
    typical_origin_warehouse_name: toStr(row.typical_origin_warehouse_name),
    origin_on_hand_units: toNumber(row.origin_on_hand_units) ?? 0,

    priority: toStr(row.priority) ?? 'ok',
    reason: '',
  };
  mapped.reason = buildReason(mapped);
  return mapped;
}

async function countFulfillmentWarehouses(companyId: number): Promise<number | null> {
  try {
    const result = await runClickHouseQuery({
      query: `SELECT count() AS n FROM etl.fulfillment_warehouses WHERE toUInt64(company_id) = toUInt64(${Math.trunc(companyId)}) AND is_fulfillment = 1`,
    });
    return toInt(result.rows[0]?.n) ?? 0;
  } catch {
    return null;
  }
}

export function registerSupplyChainListWarehouseRestockCandidatesTool(registry: ToolRegistry): void {
  const toolJsonPath = path.join(__dirname, 'tool.json');
  const specJson = JSON.parse(fs.readFileSync(toolJsonPath, 'utf8')) as ToolSpecJson;

  registry.register({
    name: TOOL_NAME,
    description: specJson.description,
    isConsequential: false,
    inputSchema,
    outputSchema: specJson.outputSchema ?? fallbackOutputSchema,
    specJson,
    execute: async (args, context) => {
      const input = inputSchema.parse(args);
      const weights = resolveVelocityWeighting(input);
      const salesVelocity = input.sales_velocity ?? DEFAULTS.sales_velocity;

      const meta = {
        warnings: [] as string[],
        source: 'etl.inventory_planning_warehouse',
        grain: 'company x fulfillment warehouse x top-level inventory item',
        sales_velocity: salesVelocity,
        velocity_weighting_used: {
          ...weights,
          note: "Applies to sales_velocity='current' only: (w30*avg_30d + w7*avg_7d + w3*avg_3d) / (w30+w7+w3). Component (dependent) demand is always added on top.",
        },
        parameters_used: {
          lead_time_days_override: input.lead_time_days_override ?? null,
          safety_stock_days_override: input.safety_stock_days_override ?? null,
          days_between_shipments: input.days_between_shipments ?? DEFAULTS.days_between_shipments,
          stockout_threshold_days: input.stockout_threshold_days ?? DEFAULTS.stockout_threshold_days,
          planning_base: input.planning_base ?? DEFAULTS.planning_base,
          include_components: input.include_components ?? DEFAULTS.include_components,
        },
        defaults: DEFAULTS,
      };

      if (!(await canReadSupplyChainCompany(context, input.company_id))) {
        meta.warnings.push('No authorized company found for company_id.');
        return { items: [], meta };
      }

      if (salesVelocity === 'current' && weights.weight_30d + weights.weight_7d + weights.weight_3d <= 0) {
        meta.warnings.push('velocity_weighting weights sum to 0, so the current velocity is 0 for every item.');
      }
      if (salesVelocity === 'planned' && input.lead_time_days_override !== undefined) {
        meta.warnings.push(
          "planned_daily_rate comes from the forecast month at today + the view's lead time; lead_time_days_override changes coverage math but not which forecast month is used.",
        );
      }

      const template = await loadTextFile(path.join(__dirname, 'query.sql'));
      const query = renderSqlTemplate(template, buildWarehouseRestockSqlVariables(input));
      const result = await runClickHouseQuery({ query });
      const items = result.rows.map(mapWarehouseRestockRow);

      if (items.length === 0) {
        const warehouses = await countFulfillmentWarehouses(input.company_id);
        if (warehouses === 0) {
          meta.warnings.push(
            'This company has no fulfillment warehouse (no invoice-fulfilled sales in the last 90 days at a non-FBA warehouse). Run supply_chain_list_fulfillment_warehouses with include_non_eligible=true to inspect warehouses; FBA restock is covered by supply_chain_list_fba_replenishment_candidates.',
          );
        } else {
          meta.warnings.push(
            `No rows matched the filters${(input.planning_base ?? DEFAULTS.planning_base) === 'needs_replenishment' ? " (planning_base='needs_replenishment' keeps only items with a recommended ship or assembly quantity; use planning_base='all' to see every item)" : ''}. Check warehouse_ids/sales_channels with supply_chain_list_fulfillment_warehouses.`,
          );
        }
      }

      return { items, meta };
    },
  });
}
