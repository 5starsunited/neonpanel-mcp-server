import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runClickHouseQuery } from '../../../../../clients/clickhouse';
import { neonPanelRequest } from '../../../../../clients/neonpanel-api';
import type { ToolExecutionContext, ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';
import { buildItemPresentation } from '../../../runtime/presentation';

function toInt(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function getRowValue(row: Record<string, unknown>, key: string): unknown {
  return row[key];
}

function hasOwn(obj: unknown, key: string): boolean {
  if (!obj || typeof obj !== 'object') return false;
  return Object.prototype.hasOwnProperty.call(obj, key);
}

type Marketplace = 'US' | 'UK' | 'ALL';

function isMarketplace(value: string): value is Marketplace {
  return value === 'US' || value === 'UK' || value === 'ALL';
}



type CompaniesWithPermissionResponse = {
  companies?: Array<{
    company_id?: number;
    companyId?: number;
    id?: number;
    uuid?: string;
    name?: string;
    short_name?: string;
  }>;
};

const timeWindowSchema = z
  .object({
    lookahead_days: z.coerce.number().int().min(1).default(14).optional(),
    as_of_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'as_of_date must be YYYY-MM-DD').optional(),
  })
  .optional();

const inventoryPoScheduleInputSchema = z
  .object({
    // Selector (top-level)
    planning_base: z.enum(['all', 'targeted_only', 'actively_sold_only', 'planned_only']),
    target_skus: z.array(z.string()).optional(),
    target_inventory_ids: z.array(z.coerce.number().int().min(1)).optional(),
    target_asins: z.array(z.string()).optional(),
    parent_asins: z.array(z.string()).optional(),
    brand: z.array(z.string()).optional(),
    product_family: z.array(z.string()).optional(),
    category: z.array(z.string()).optional(),
    marketplaces: z.array(z.enum(['US', 'UK', 'ALL'])).default(['ALL']).optional(),
    countries: z.array(z.string()).optional(),
    company_id: z.coerce.number().int().min(1).optional(),

    // Optional classification filters (computed from snapshot sales_last_30_days)
    revenue_abcd_class: z.array(z.enum(['A', 'B', 'C', 'D'])).optional(),

    // Planning window + knobs
    time_window: timeWindowSchema,
    sales_velocity: z.enum(['current', 'target', 'planned']).default('planned').optional(),
    use_seasonality: z.boolean().default(true).optional(),
    override_default: z.boolean().default(false).optional(),
    lead_time_days_override: z.coerce.number().int().min(0).default(30).optional(),
    safety_stock_days_override: z.coerce.number().int().min(0).default(60).optional(),
    days_between_pos: z.coerce.number().int().min(0).default(30).optional(),
    include_work_in_progress: z.boolean().default(true).optional(),
    limit: z.coerce.number().int().min(1).default(50).optional(),
    stockout_threshold_days: z.coerce.number().int().min(0).default(7).optional(),
    active_sold_min_units_per_day: z.number().min(0).default(1).optional(),
  })
  .strict();

// Flat input schema — all parameters at the top level, no query/tool_specific wrappers.
// planning_base is optional here and auto-defaulted in execute based on selector fields and sales_velocity.
const inputSchema = inventoryPoScheduleInputSchema.partial().extend({
  company_id: z.coerce.number().int().min(1),
}).strict();

const outputSchema = {
  type: 'object',
  properties: {
    items: { type: 'array', items: { type: 'object', additionalProperties: true } },
    meta: {
      type: 'object',
      properties: {
        applied_sort: { type: ['object', 'null'], additionalProperties: true },
        selected_fields: { type: ['array', 'null'], items: { type: 'string' } },
        included_fields: { type: ['array', 'null'], items: { type: 'string' } },
        warnings: { type: ['array', 'null'], items: { type: 'string' } },
      },
      additionalProperties: true,
    },
  },
  required: ['items'],
};

function sqlEscapeString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function sqlStringLiteral(value: string): string {
  return `'${sqlEscapeString(value)}'`;
}

function sqlVarcharArrayExpr(values: string[]): string {
  if (values.length === 0) return "CAST([], 'Array(String)')";
  return `[${values.map(sqlStringLiteral).join(',')}]`;
}

function sqlBigintArrayExpr(values: number[]): string {
  if (values.length === 0) return "CAST([], 'Array(UInt64)')";
  return `[${values.map((n) => String(Math.trunc(n))).join(',')}]`;
}

function sqlCompanyIdArrayExpr(values: number[]): string {
  if (values.length === 0) return "CAST([], 'Array(UInt64)')";
  return `[${values.map((n) => String(Math.trunc(n))).join(',')}]`;
}

function planningBaseSql(value: 'all' | 'targeted_only' | 'actively_sold_only' | 'planned_only'): string {
  switch (value) {
    case 'targeted_only':
      return sqlStringLiteral('targeted only');
    case 'actively_sold_only':
      return sqlStringLiteral('actively sold only');
    case 'planned_only':
      return sqlStringLiteral('planned only');
    case 'all':
    default:
      return sqlStringLiteral('all');
  }
}

function normalizeCountryTokens(value: string): string[] {
  const normalized = value.trim();
  if (!normalized) return [];

  const upper = normalized.toUpperCase().replace(/\s+/g, ' ');

  // Snapshot includes both pil.country (label) and pil.country_code (2-letter code).
  // Emit *both* tokens so the SQL can match either column.
  if (upper === 'US' || upper === 'USA' || upper === 'UNITED STATES' || upper === 'UNITEDSTATES') {
    return ['United States', 'US'];
  }
  if (
    upper === 'UK' ||
    upper === 'GB' ||
    upper === 'GREAT BRITAIN' ||
    upper === 'GREATBRITAIN' ||
    upper === 'UNITED KINGDOM' ||
    upper === 'UNITEDKINGDOM'
  ) {
    return ['United Kingdom', 'UK'];
  }

  // If the user passes a 2-letter code (e.g., AE), include both original and uppercased.
  if (/^[A-Z]{2}$/.test(upper)) return [upper, normalized];

  return [normalized];
}

function normalizeCountries(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    for (const token of normalizeCountryTokens(v)) {
      if (!token) continue;
      if (!out.includes(token)) out.push(token);
    }
  }
  return out;
}

async function executeSupplyChainListPoPlacementCandidates(
  parsed: z.infer<typeof inventoryPoScheduleInputSchema>,
  context: ToolExecutionContext,
): Promise<{ items: unknown[] }> {
  // Permission gate - user needs at least ONE of these permissions
  const permissions = [
    'view:quicksight_group.inventory_management_new',
    'view:quicksight_group.finance-new',
  ];

  const allPermittedCompanyIds = new Set<number>();
  for (const permission of permissions) {
    try {
      const permissionResponse = await neonPanelRequest<CompaniesWithPermissionResponse>({
        token: context.userToken,
        path: `/api/v1/permissions/${encodeURIComponent(permission)}/companies`,
      });

      const permittedCompanies = (permissionResponse.companies ?? []).filter(
        (c): c is { company_id?: number; companyId?: number; id?: number; name?: string; short_name?: string } =>
          c !== null && typeof c === 'object',
      );

      permittedCompanies.forEach((c) => {
        const id = c.company_id ?? c.companyId ?? c.id;
        if (typeof id === 'number' && Number.isFinite(id) && id > 0) {
          allPermittedCompanyIds.add(id);
        }
      });
    } catch (err) {
      // Continue if one permission check fails
    }
  }

  const permittedCompanyIds = Array.from(allPermittedCompanyIds);
  const requestedCompanyIds = typeof parsed.company_id === 'number' ? [parsed.company_id] : [];
  const allowedCompanyIds = requestedCompanyIds.filter((id) => permittedCompanyIds.includes(id));

  if (permittedCompanyIds.length === 0 || allowedCompanyIds.length === 0) {
    return { items: [] };
  }

  const limit = parsed.limit ?? 200;

  const skus = parsed.target_skus ?? [];
  const inventoryIds = parsed.target_inventory_ids ?? [];
  const asins = (parsed.target_asins ?? [])
    .filter((v) => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim());
  const parentAsins = (parsed.parent_asins ?? [])
    .filter((v) => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim());
  const brands = (parsed.brand ?? [])
    .filter((v) => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim());
  const productFamilies = (parsed.product_family ?? [])
    .filter((v) => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim());

  const marketplaces = parsed.marketplaces ?? ['ALL'];
  // Treat ALL as "no filter" only when it's the only selection.
  // If the user provides ALL + specific marketplaces (common UX), ignore ALL.
  const marketplacesNormalized = marketplaces.filter((m) => m !== 'ALL');

  // Some clients send `countries: []` by default. An empty array should NOT override marketplaces;
  // it should behave like "countries not provided".
  const countriesFromSelector = (parsed.countries ?? [])
    .map((c) => (typeof c === 'string' ? c.trim() : ''))
    .filter((c) => c.length > 0);

  const countriesRaw = countriesFromSelector.length > 0 ? countriesFromSelector : marketplacesNormalized;
  const countries = normalizeCountries(countriesRaw);

  const revenueAbcdClasses = (parsed.revenue_abcd_class ?? [])
    .map((v) => (typeof v === 'string' ? v.trim().toUpperCase() : ''))
    .filter((v): v is 'A' | 'B' | 'C' | 'D' => v === 'A' || v === 'B' || v === 'C' || v === 'D');

  const sqlPath = path.join(__dirname, 'query.sql');
  const template = await loadTextFile(sqlPath);
  const query = renderSqlTemplate(template, {
    sales_velocity_sql: sqlStringLiteral(parsed.sales_velocity ?? 'planned'),
    planning_base_sql: planningBaseSql(parsed.planning_base),
    override_default_sql: parsed.override_default ? 'TRUE' : 'FALSE',
    use_seasonality_sql: parsed.use_seasonality ? 'TRUE' : 'FALSE',
    lead_time_days_override: Math.trunc(parsed.lead_time_days_override ?? 30),
    safety_stock_days_override: Math.trunc(parsed.safety_stock_days_override ?? 60),
    days_between_pos: Math.trunc(parsed.days_between_pos ?? 30),
    include_work_in_progress: parsed.include_work_in_progress ?? true ? 'TRUE' : 'FALSE',
    limit_top_n: Number(limit),
    stockout_threshold_days: Math.trunc(parsed.stockout_threshold_days ?? 7),
    active_sold_min_units_per_day: Number(parsed.active_sold_min_units_per_day ?? 1),

    company_ids_array: sqlCompanyIdArrayExpr(allowedCompanyIds),
    skus_array: sqlVarcharArrayExpr(skus),
    inventory_ids_array: sqlBigintArrayExpr(inventoryIds),
    asins_array: sqlVarcharArrayExpr(asins),
    parent_asins_array: sqlVarcharArrayExpr(parentAsins),
    brands_array: sqlVarcharArrayExpr(brands),
    product_families_array: sqlVarcharArrayExpr(productFamilies),
    countries_array: sqlVarcharArrayExpr(countries),
    revenue_abcd_classes_array: sqlVarcharArrayExpr(revenueAbcdClasses),

  });

  const clickHouseResult = await runClickHouseQuery({ query });

  const items = clickHouseResult.rows.slice(0, Math.min(2000, limit)).map((row) => {
    const record = row;

    const company_id = toInt(getRowValue(record, 'company_id')) ?? undefined;

    const item_ref = {
      inventory_id: toInt(getRowValue(record, 'item_ref_inventory_id')) ?? undefined,
      sku: (getRowValue(record, 'item_ref_sku') ?? undefined) as string | undefined,
      asin: (getRowValue(record, 'item_ref_asin') ?? undefined) as string | undefined,
      marketplace: (getRowValue(record, 'item_ref_marketplace') ?? undefined) as 'US' | 'UK' | undefined,
      item_name: (getRowValue(record, 'item_ref_item_name') ?? undefined) as string | undefined,
      item_icon_url: (getRowValue(record, 'item_ref_item_icon_url') ?? undefined) as string | undefined,
    };

    const priorityRaw = (getRowValue(record, 'priority') ?? undefined) as string | undefined;
    const priority =
      priorityRaw === 'low' || priorityRaw === 'medium' || priorityRaw === 'high' || priorityRaw === 'critical'
        ? priorityRaw
        : 'high';

    return {
      company_id,
      revenue_abcd_class: (getRowValue(record, 'revenue_abcd_class') ?? undefined) as string | undefined,
      revenue_abcd_class_description: (getRowValue(record, 'revenue_abcd_class_description') ?? undefined) as
        | string
        | undefined,
      pareto_abc_class: (getRowValue(record, 'pareto_abc_class') ?? undefined) as string | undefined,
      child_asin: (getRowValue(record, 'child_asin') ?? undefined) as string | undefined,
      parent_asin: (getRowValue(record, 'parent_asin') ?? undefined) as string | undefined,
      brand: (getRowValue(record, 'brand') ?? undefined) as string | undefined,
      product_family: (getRowValue(record, 'product_family') ?? undefined) as string | undefined,
      item_ref,
      presentation: buildItemPresentation({
        sku: item_ref.sku,
        asin: item_ref.asin,
        inventory_id: item_ref.inventory_id,
        marketplace_code: item_ref.marketplace,
        image_url: item_ref.item_icon_url,
        image_source_field: 'item_ref.item_icon_url',
      }),

      sales_velocity: toNumber(getRowValue(record, 'sales_velocity')) ?? undefined,

      // Velocity calculation transparency fields
      velocity_calculation_method: (getRowValue(record, 'velocity_calculation_method') ?? undefined) as string | undefined,
      velocity_units_per_day: toNumber(getRowValue(record, 'velocity_units_per_day')) ?? undefined,
      forecast_month_index: toInt(getRowValue(record, 'forecast_month_index')) ?? undefined,
      forecast_units_extracted: toNumber(getRowValue(record, 'forecast_units_extracted')) ?? undefined,

      po_days_of_supply: toInt(getRowValue(record, 'po_days_of_supply')) ?? undefined,
      available_inventory_units: toInt(getRowValue(record, 'available_inventory_units')) ?? undefined,

      lead_time_days: toInt(getRowValue(record, 'lead_time_days')) ?? undefined,
      safety_stock_days: toInt(getRowValue(record, 'safety_stock_days')) ?? undefined,
      target_coverage_days: toInt(getRowValue(record, 'target_coverage_days')) ?? undefined,

      po_due_in_days: toInt(getRowValue(record, 'po_due_in_days')) ?? undefined,
      po_overdue_days: toInt(getRowValue(record, 'po_overdue_days')) ?? undefined,
      po_due_date: (getRowValue(record, 'po_due_date') ?? undefined) as string | undefined,

      recommended_order_units: toInt(getRowValue(record, 'recommended_order_units')) ?? undefined,
      moq: toInt(getRowValue(record, 'moq')) ?? undefined,
      lead_time_days_source: (getRowValue(record, 'lead_time_days_source') ?? undefined) as string | undefined,
      safety_stock_days_source: (getRowValue(record, 'safety_stock_days_source') ?? undefined) as string | undefined,
      priority,
      reason: (getRowValue(record, 'reason') ?? '') as string,
    };
  });

  return { items };
}

export function registerSupplyChainListPoPlacementCandidatesTool(registry: ToolRegistry) {
  const toolJsonPath = path.join(__dirname, 'tool.json');

  let specJson: ToolSpecJson | undefined;
  try {
    if (fs.existsSync(toolJsonPath)) {
      specJson = JSON.parse(fs.readFileSync(toolJsonPath, 'utf8')) as ToolSpecJson;
    }
  } catch {
    specJson = undefined;
  }

  registry.register({
    name: 'supply_chain_list_po_placement_candidates',
    description:
      'List items needing PO placement based on lead time + safety stock + PO cadence coverage.',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? outputSchema,
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);

      // Auto-default planning_base based on selector fields and sales_velocity
      let planning_base = parsed.planning_base;
      if (!planning_base) {
        const hasTargets =
          (parsed.target_skus?.length ?? 0) > 0 ||
          (parsed.target_asins?.length ?? 0) > 0 ||
          (parsed.target_inventory_ids?.length ?? 0) > 0 ||
          (parsed.parent_asins?.length ?? 0) > 0;
        if (hasTargets) {
          planning_base = 'targeted_only';
        } else {
          const velocityMode = parsed.sales_velocity ?? 'planned';
          if (velocityMode === 'target') {
            planning_base = 'targeted_only';
          } else if (velocityMode === 'planned') {
            planning_base = 'planned_only';
          } else {
            planning_base = 'actively_sold_only';
          }
        }
      }

      const legacyParsed = inventoryPoScheduleInputSchema.parse({ ...parsed, planning_base });
      const result = await executeSupplyChainListPoPlacementCandidates(legacyParsed, context);

      return {
        items: (result.items ?? []) as unknown[],
        meta: {
          warnings: [],
          applied_sort: null,
          selected_fields: null,
        },
      };
    },
  });
}
