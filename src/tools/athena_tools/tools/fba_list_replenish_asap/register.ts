import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runAthenaQuery } from '../../../../clients/athena';
import { neonPanelRequest } from '../../../../clients/neonpanel-api';
import { config } from '../../../../config';
import type { ToolRegistry, ToolSpecJson } from '../../../types';
import { loadTextFile } from '../../runtime/load-assets';
import { renderSqlTemplate } from '../../runtime/render-sql';
import { buildItemPresentation } from '../../runtime/presentation';

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

const skuSelectorSchema = z.object({
  planning_base: z.enum(['all', 'targeted_only', 'actively_sold_only', 'planned_only']).default('actively_sold_only'),
  target_skus: z.array(z.string()).optional(),
  target_inventory_ids: z.array(z.number().int().min(1)).optional(),
  target_asins: z.array(z.string()).optional(),
  brand: z.array(z.string()).optional(),
  category: z.array(z.string()).optional(),
  marketplaces: z.array(z.enum(['US', 'UK', 'ALL'])).default(['ALL']).optional(),
  countries: z.array(z.string()).optional(),
  company_id: z.number().int().min(1).optional(),
});

const timeWindowSchema = z
  .object({
    lookahead_days: z.number().int().min(1).default(14).optional(),
    as_of_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'as_of_date must be YYYY-MM-DD').optional(),
  })
  .optional();

const inputSchema = z.object({
  sku_selector: skuSelectorSchema,
  time_window: timeWindowSchema,
  sales_velocity: z.enum(['current', 'target', 'planned']).default('current').optional(),
  use_seasonality: z.boolean().default(true).optional(),
  override_default: z.boolean().default(false).optional(),
  fba_lead_time_days_override: z.number().int().min(0).default(12).optional(),
  fba_safety_stock_days_override: z.number().int().min(0).default(60).optional(),
  limit: z.number().int().min(1).default(200).optional(),
  stockout_threshold_days: z.number().int().min(0).default(7).optional(),
  active_sold_min_units_per_day: z.number().min(0).default(1).optional(),
});

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
  // company_id is a STRING partition column in Athena, so we filter using ARRAY(VARCHAR).
  if (values.length === 0) return 'CAST(ARRAY[] AS ARRAY(VARCHAR))';
  return `CAST(ARRAY[${values.map((n) => sqlStringLiteral(String(Math.trunc(n)))).join(',')}] AS ARRAY(VARCHAR))`;
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
  if (upper === 'UK' || upper === 'GB' || upper === 'GREAT BRITAIN' || upper === 'GREATBRITAIN' || upper === 'UNITED KINGDOM' || upper === 'UNITEDKINGDOM') {
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

export function registerFbaListReplenishAsapTool(registry: ToolRegistry) {
  const toolJsonPath = path.join(__dirname, 'tool.json');
  const sqlPath = path.join(__dirname, 'query.sql');

  let specJson: ToolSpecJson | undefined;
  try {
    if (fs.existsSync(toolJsonPath)) {
      specJson = JSON.parse(fs.readFileSync(toolJsonPath, 'utf8')) as ToolSpecJson;
    }
  } catch {
    specJson = undefined;
  }

  registry.register({
    name: 'amazon_supply_chain.fba_list_replenish_asap',
    description:
      'List items that need to be replenished to FBA ASAP based on projected stockout risk and inbound coverage.',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);

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

      const requestedCompanyIds = parsed.sku_selector.company_id ? [parsed.sku_selector.company_id] : permittedCompanyIds;
      const allowedCompanyIds = requestedCompanyIds.filter((id) => permittedCompanyIds.includes(id));

      if (permittedCompanyIds.length === 0 || allowedCompanyIds.length === 0) {
        return { items: [] };
      }

      const catalog = config.athena.catalog;
      const database = config.athena.database;
      const table = config.athena.tables.inventoryPlanningSnapshot;

      const limit = parsed.limit ?? 200;

      const skus = parsed.sku_selector.target_skus ?? [];
      const inventoryIds = parsed.sku_selector.target_inventory_ids ?? [];

      const marketplaces = parsed.sku_selector.marketplaces ?? ['ALL'];
      // Treat ALL as "no filter" only when it's the only selection.
      // If the user provides ALL + specific marketplaces (common UX), ignore ALL.
      const marketplacesNormalized = marketplaces.filter((m) => m !== 'ALL');
      const countriesRaw = parsed.sku_selector.countries ?? marketplacesNormalized;
      const countries = normalizeCountries(countriesRaw);

      const template = await loadTextFile(sqlPath);
      const query = renderSqlTemplate(template, {
        catalog,
        database,
        table,
        // Athena UI SQL parameter equivalents
        sales_velocity_sql: sqlStringLiteral(parsed.sales_velocity ?? 'current'),
        planning_base_sql: planningBaseSql(parsed.sku_selector.planning_base),
        override_default_sql: parsed.override_default ? 'TRUE' : 'FALSE',
        use_seasonality_sql: parsed.use_seasonality ? 'TRUE' : 'FALSE',
        fba_lead_time_days_override: Math.trunc(parsed.fba_lead_time_days_override ?? 12),
        fba_safety_stock_days_override: Math.trunc(parsed.fba_safety_stock_days_override ?? 60),
        limit_top_n: Number(limit),
        stockout_threshold_days: Math.trunc(parsed.stockout_threshold_days ?? 7),
        active_sold_min_units_per_day: Number(parsed.active_sold_min_units_per_day ?? 1),

        company_ids_array: sqlCompanyIdArrayExpr(allowedCompanyIds),
        skus_array: sqlVarcharArrayExpr(skus),
        inventory_ids_array: sqlBigintArrayExpr(inventoryIds),
        countries_array: sqlVarcharArrayExpr(countries),

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
          item_ref,
          presentation: buildItemPresentation({
            sku: item_ref.sku,
            asin: item_ref.asin,
            inventory_id: item_ref.inventory_id,
            marketplace_code: item_ref.marketplace,
            image_url: item_ref.item_icon_url,
            image_source_field: 'item_ref.item_icon_url',
          }),
          shipment_due_date: (getRowValue(record, 'shipment_due_date') ?? undefined) as string | undefined,
          shipment_due_in_days: toNumber(getRowValue(record, 'shipment_due_in_days')) ?? 0,
          shipment_overdue_days: toNumber(getRowValue(record, 'shipment_overdue_days')) ?? 0,
          fba_on_hand: toInt(getRowValue(record, 'fba_on_hand')) ?? 0,
          fba_inbound: toInt(getRowValue(record, 'fba_inbound')) ?? 0,
          recommended_ship_units: toInt(getRowValue(record, 'recommended_ship_units')) ?? 0,
          recommended_by_amazon_replenishment_quantity:
            toInt(getRowValue(record, 'recommended_by_amazon_replenishment_quantity')) ?? 0,
          priority,
          reason: (getRowValue(record, 'reason') ?? '') as string,
        };
      });

      return { items };
    },
  });
}
