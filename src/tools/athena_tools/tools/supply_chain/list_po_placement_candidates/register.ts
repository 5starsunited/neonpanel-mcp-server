import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runAthenaQuery } from '../../../../../clients/athena';
import { neonPanelRequest } from '../../../../../clients/neonpanel-api';
import { config } from '../../../../../config';
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

const sharedQuerySchema = z
  .object({
    filters: z
      .object({
        company: z.string().optional(),
        company_id: z.coerce.number().int().min(1).optional(),
        brand: z.array(z.string()).optional(),
        marketplace: z.array(z.string()).optional(),
        currency: z.array(z.string()).optional(),
        product_family: z.array(z.string()).optional(),
        parent_asin: z.array(z.string()).optional(),
        asin: z.array(z.string()).optional(),
        sku: z.array(z.string()).optional(),
        revenue_abcd_class: z.array(z.enum(['A', 'B', 'C', 'D'])).optional(),
        pareto_abc_class: z.array(z.enum(['A', 'B', 'C'])).optional(),
        tags: z.array(z.string()).optional(),
      })
      .catchall(z.unknown())
      .optional(),
    aggregation: z
      .object({
        group_by: z.array(z.string()).optional(),
        time: z
          .object({
            periodicity: z.enum(['day', 'week', 'month', 'quarter', 'year']).optional(),
            start_date: z.string().optional(),
            end_date: z.string().optional(),
          })
          .optional(),
      })
      .optional(),
    sort: z
      .object({
        field: z.string().optional(),
        direction: z.enum(['asc', 'desc']).default('desc').optional(),
        nulls: z.enum(['first', 'last']).default('last').optional(),
      })
      .optional(),
    select_fields: z.array(z.string()).optional(),
    limit: z.coerce.number().int().min(1).default(50).optional(),
    cursor: z.string().optional(),
  })
  .strict();

type SharedQuery = z.infer<typeof sharedQuerySchema>;

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

// Validate tool_specific against the legacy input schema, but treat all fields as optional.
const toolSpecificSchema = inventoryPoScheduleInputSchema.partial().strict();

type ToolSpecific = z.infer<typeof toolSpecificSchema>;

const inputSchema = z
  .object({
    query: sharedQuerySchema,
    tool_specific: toolSpecificSchema.optional(),
  })
  .strict();

const outputSchema = {
  type: 'object',
  properties: {
    items: { type: 'array', items: { type: 'object', additionalProperties: true } },
    meta: {
      type: 'object',
      properties: {
        applied_sort: { type: 'object', additionalProperties: true },
        selected_fields: { type: 'array', items: { type: 'string' } },
        included_fields: { type: 'array', items: { type: 'string' } },
        warnings: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: true,
    },
  },
  required: ['items'],
};

function mergeInputs(
  query: SharedQuery,
  toolSpecific: ToolSpecific,
  toolSpecificRaw: unknown,
): { merged: Record<string, unknown>; warnings: string[]; error?: string } {
  const warnings: string[] = [];
  const filters = query.filters ?? {};

  const merged: Record<string, unknown> = { ...toolSpecific };

  // company / company_id
  if (!hasOwn(toolSpecificRaw, 'company_id') && merged.company_id === undefined) {
    if (typeof (filters as any).company_id === 'number') {
      merged.company_id = (filters as any).company_id;
    } else if (typeof (filters as any).company === 'string') {
      const asInt = toInt((filters as any).company);
      if (asInt && asInt > 0) {
        merged.company_id = asInt;
      } else {
        return {
          merged,
          warnings,
          error:
            'Unsupported company filter: query.filters.company must be a numeric company_id. Use neonpanel_listCompanies to find the correct company (e.g., "5 Stars United LLC"), then pass query.filters.company_id (preferred) or tool_specific.company_id.',
        };
      }
    }
  }

  // selector filters
  if (!hasOwn(toolSpecificRaw, 'brand') && merged.brand === undefined && Array.isArray((filters as any).brand)) {
    merged.brand = (filters as any).brand;
  }

  if (!hasOwn(toolSpecificRaw, 'target_skus') && merged.target_skus === undefined && Array.isArray((filters as any).sku)) {
    merged.target_skus = (filters as any).sku;
    if (!hasOwn(toolSpecificRaw, 'planning_base') && merged.planning_base === undefined) merged.planning_base = 'targeted_only';
  }

  if (!hasOwn(toolSpecificRaw, 'target_asins') && merged.target_asins === undefined && Array.isArray((filters as any).asin)) {
    merged.target_asins = (filters as any).asin;
    if (!hasOwn(toolSpecificRaw, 'planning_base') && merged.planning_base === undefined) merged.planning_base = 'targeted_only';
  }

  if (
    !hasOwn(toolSpecificRaw, 'parent_asins') &&
    merged.parent_asins === undefined &&
    Array.isArray((filters as any).parent_asin)
  ) {
    merged.parent_asins = (filters as any).parent_asin;
    if (!hasOwn(toolSpecificRaw, 'planning_base') && merged.planning_base === undefined) merged.planning_base = 'targeted_only';
  }

  if (
    !hasOwn(toolSpecificRaw, 'product_family') &&
    merged.product_family === undefined &&
    Array.isArray((filters as any).product_family)
  ) {
    merged.product_family = (filters as any).product_family;
  }

  if (!hasOwn(toolSpecificRaw, 'marketplaces') && merged.marketplaces === undefined && Array.isArray((filters as any).marketplace)) {
    const raw = (filters as any).marketplace as unknown[];
    const normalized = raw
      .map((v) => (typeof v === 'string' ? v.trim().toUpperCase() : ''))
      .filter((v) => v.length > 0);
    const allowed = normalized.filter(isMarketplace);
    const allowedSet = new Set<string>(allowed);
    const unknown = normalized.filter((v) => v && !allowedSet.has(v));
    if (unknown.length > 0) {
      warnings.push(`query.filters.marketplace contains unsupported values: ${unknown.join(', ')}`);
    }
    if (allowed.length > 0) merged.marketplaces = allowed as any;
  }

  // classification filters
  if (
    !hasOwn(toolSpecificRaw, 'revenue_abcd_class') &&
    merged.revenue_abcd_class === undefined &&
    Array.isArray((filters as any).revenue_abcd_class)
  ) {
    merged.revenue_abcd_class = (filters as any).revenue_abcd_class;
  }

  // shared knobs
  if (!hasOwn(toolSpecificRaw, 'limit') && typeof query.limit === 'number') {
    merged.limit = query.limit;
  }

  if (query.cursor) {
    warnings.push('query.cursor is not supported for this tool (no pagination cursor).');
  }

  if (query.select_fields && query.select_fields.length > 0) {
    warnings.push('query.select_fields is not supported yet; returning default fields.');
  }

  if (query.sort && (query.sort.field || query.sort.direction || query.sort.nulls)) {
    warnings.push('query.sort is not supported yet; returning default ordering.');
  }

  const groupBy = query.aggregation?.group_by;
  if (Array.isArray(groupBy) && groupBy.length > 0 && !(groupBy.length === 1 && groupBy[0] === 'none')) {
    warnings.push('query.aggregation.group_by is not supported for this tool; returning SKU-level rows.');
  }

  if (query.aggregation?.time) {
    warnings.push('query.aggregation.time is not supported for this tool; using latest snapshot only.');
  }

  // Warn on common unsupported filters when present.
  const unsupportedFilterKeys = ['currency', 'pareto_abc_class', 'tags'];
  for (const key of unsupportedFilterKeys) {
    if ((filters as any)[key] !== undefined) {
      warnings.push(`query.filters.${key} is not supported for this tool yet.`);
    }
  }

  return { merged, warnings };
}

function sqlEscapeString(value: string): string {
  return value.replace(/'/g, "''");
}

function sqlStringLiteral(value: string): string {
  return `'${sqlEscapeString(value)}'`;
}

function sqlVarcharArrayExpr(values: string[]): string {
  if (values.length === 0) return 'CAST(ARRAY[] AS ARRAY(VARCHAR))';
  return `CAST(ARRAY[${values.map(sqlStringLiteral).join(',')}] AS ARRAY(VARCHAR))`;
}

function sqlBigintArrayExpr(values: number[]): string {
  if (values.length === 0) return 'CAST(ARRAY[] AS ARRAY(BIGINT))';
  return `CAST(ARRAY[${values.map((n) => String(Math.trunc(n))).join(',')}] AS ARRAY(BIGINT))`;
}

function sqlCompanyIdArrayExpr(values: number[]): string {
  // Iceberg snapshot uses BIGINT company_id, so filter using ARRAY(BIGINT).
  if (values.length === 0) return 'CAST(ARRAY[] AS ARRAY(BIGINT))';
  return `CAST(ARRAY[${values.map((n) => String(Math.trunc(n))).join(',')}] AS ARRAY(BIGINT))`;
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
  // Permission gate: use NeonPanel permission endpoint, then filter Athena by company_id.
  const permission = 'view:quicksight_group.business_planning_new';
  const permissionResponse = await neonPanelRequest<CompaniesWithPermissionResponse>({
    token: context.userToken,
    path: `/api/v1/permissions/${encodeURIComponent(permission)}/companies`,
  });

  const permittedCompanies = (permissionResponse.companies ?? []).filter(
    (c): c is { company_id?: number; companyId?: number; id?: number; name?: string; short_name?: string } =>
      c !== null && typeof c === 'object',
  );

  const permittedCompanyIds = permittedCompanies
    .map((c) => c.company_id ?? c.companyId ?? c.id)
    .filter((id): id is number => typeof id === 'number' && Number.isFinite(id) && id > 0);

  const requestedCompanyIds = parsed.company_id ? [parsed.company_id] : permittedCompanyIds;
  const allowedCompanyIds = requestedCompanyIds.filter((id) => permittedCompanyIds.includes(id));

  if (permittedCompanyIds.length === 0 || allowedCompanyIds.length === 0) {
    return { items: [] };
  }

  const catalog = config.athena.catalog;
  const database = config.athena.database;
  const table = config.athena.tables.inventoryPlanningSnapshot;

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
    catalog,
    database,
    table,
    // Athena UI SQL parameter equivalents
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

    // Back-compat for older draft templates
    companyIdsSql: allowedCompanyIds.map((id) => sqlStringLiteral(String(id))).join(', '),
    limit: Number(limit),
    topN: Number(limit),
  });

  const athenaResult = await runAthenaQuery({
    query,
    database,
    workGroup: config.athena.workgroup,
    outputLocation: config.athena.outputLocation,
    maxRows: Math.min(2000, limit),
  });

  const items = (athenaResult.rows ?? []).map((row) => {
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
      'List items needing PO placement based on lead time + safety stock + PO cadence coverage (query envelope; preferred).',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? outputSchema,
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);

      const rawToolSpecific = (parsed.tool_specific ?? {}) as unknown;
      const toolSpecificParsed = toolSpecificSchema.parse(rawToolSpecific);

      const { merged, warnings, error } = mergeInputs(parsed.query, toolSpecificParsed, rawToolSpecific);

      if (error) {
        return {
          items: [],
          meta: {
            warnings,
            error,
            applied_sort: parsed.query.sort ?? null,
            selected_fields: parsed.query.select_fields ?? null,
          },
        };
      }

      // Set planning_base default based on sales_velocity mode to prevent filtering out items
      // when user explicitly chooses an alternative velocity calculation mode
      if (merged.planning_base === undefined) {
        const velocityMode = merged.sales_velocity ?? 'planned';
        if (velocityMode === 'target') {
          merged.planning_base = 'targeted_only';
        } else if (velocityMode === 'planned') {
          merged.planning_base = 'planned_only';
        } else {
          // 'current' mode uses 'actively_sold_only' (historical behavior)
          merged.planning_base = 'actively_sold_only';
        }
      }

      // Convert merged args to the legacy tool's strict schema (to guarantee runtime safety).
      const legacyParsed = inventoryPoScheduleInputSchema.parse(merged);
      const result = await executeSupplyChainListPoPlacementCandidates(legacyParsed, context);

      return {
        items: (result.items ?? []) as unknown[],
        meta: {
          warnings,
          applied_sort: parsed.query.sort ?? null,
          selected_fields: parsed.query.select_fields ?? null,
        },
      };
    },
  });
}
