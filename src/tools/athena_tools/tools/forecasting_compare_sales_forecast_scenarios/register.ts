import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runAthenaQuery } from '../../../../clients/athena';
import { neonPanelRequest } from '../../../../clients/neonpanel-api';
import { config } from '../../../../config';
import type { ToolExecutionContext, ToolRegistry, ToolSpecJson } from '../../../types';
import { loadTextFile } from '../../runtime/load-assets';
import { renderSqlTemplate } from '../../runtime/render-sql';

type CompaniesWithPermissionResponse = {
  companies?: Array<{
    company_id?: number;
    companyId?: number;
    id?: number;
  }>;
};

function sqlEscapeString(value: string): string {
  return value.replace(/'/g, "''");
}

function sqlStringLiteral(value: string): string {
  return `'${sqlEscapeString(value)}'`;
}

function sqlNullableStringExpr(value: string | null | undefined): string {
  if (value === null || value === undefined) return 'CAST(NULL AS VARCHAR)';
  const trimmed = String(value).trim();
  if (trimmed.length === 0) return 'CAST(NULL AS VARCHAR)';
  return sqlStringLiteral(trimmed);
}

function sqlNullableTimestampExpr(iso: string | null | undefined): string {
  if (!iso) return 'CAST(NULL AS TIMESTAMP)';
  const trimmed = iso.trim();
  if (trimmed.length === 0) return 'CAST(NULL AS TIMESTAMP)';
  // Athena: from_iso8601_timestamp accepts RFC3339/ISO8601.
  return `from_iso8601_timestamp(${sqlStringLiteral(trimmed)})`;
}

function sqlVarcharArrayExpr(values: string[]): string {
  if (values.length === 0) return 'CAST(ARRAY[] AS ARRAY(VARCHAR))';
  return `CAST(ARRAY[${values.map(sqlStringLiteral).join(',')}] AS ARRAY(VARCHAR))`;
}

function sqlCompanyIdArrayExpr(values: number[]): string {
  if (values.length === 0) return 'CAST(ARRAY[] AS ARRAY(BIGINT))';
  return `CAST(ARRAY[${values.map((n) => String(Math.trunc(n))).join(',')}] AS ARRAY(BIGINT))`;
}

function sqlBooleanLiteral(value: boolean): string {
  return value ? 'TRUE' : 'FALSE';
}

const querySchema = z
  .object({
    filters: z
      .object({
        company: z.string().optional(),
        company_id: z.coerce.number().int().min(1).optional(),

        inventory_id: z.coerce.number().int().min(1).optional(),
        sku: z.array(z.string()).min(1).max(1).optional(),
        marketplace: z.array(z.string()).min(1).max(1).optional(),
        country_code: z.array(z.string()).min(1).max(1).optional(),

        asin: z.array(z.string()).max(1).optional(),
        parent_asin: z.array(z.string()).max(1).optional(),
      })
      .catchall(z.unknown()),
    limit: z.coerce.number().int().min(1).max(500).default(200).optional(),
  })
  .strict();

const toolSpecificSchema = z
  .object({
    compare: z
      .object({
        mode: z.enum(['scenarios', 'runs', 'scenarios_and_runs']).default('scenarios').optional(),

        scenario_ids: z.array(z.coerce.number().int().min(1)).optional(),
        scenario_uuids: z.array(z.string()).optional(),
        scenario_names: z.array(z.string()).optional(),

        run_selector: z
          .object({
            type: z.enum(['latest_n', 'date_range']).default('latest_n').optional(),
            n: z.coerce.number().int().min(1).max(10).default(3).optional(),
            updated_at_from: z.string().optional(),
            updated_at_to: z.string().optional(),
          })
          .default({ type: 'latest_n', n: 3 })
          .optional(),

        include_actuals: z.boolean().default(true).optional(),

        period: z
          .object({
            start: z.string().optional(),
            end: z.string().optional(),
          })
          .optional(),
      })
      .default({ mode: 'scenarios', include_actuals: true, run_selector: { type: 'latest_n', n: 3 } })
      .optional(),
  })
  .strict();

const inputSchema = z
  .object({
    query: querySchema,
    tool_specific: toolSpecificSchema.optional(),
  })
  .strict();

function normalizeCompanyId(filters: any): { companyId?: number; error?: string } {
  const companyId = filters.company_id ? Number(filters.company_id) : undefined;
  if (companyId && Number.isFinite(companyId) && companyId > 0) {
    return { companyId: Math.trunc(companyId) };
  }

  if (typeof filters.company === 'string' && filters.company.trim().length > 0) {
    const raw = filters.company.trim();
    if (!/^\d+$/.test(raw)) {
      return {
        error:
          'query.filters.company must be a numeric string (company_id). Do not pass a company name. Call neonpanel_listCompanies and use query.filters.company_id.',
      };
    }
    return { companyId: Math.trunc(Number(raw)) };
  }

  return {};
}

async function getAllowedCompanyIds(requestedCompanyId: number, context: ToolExecutionContext) {
  const permission = 'view:quicksight_group.business_planning_new';
  const permissionResponse = await neonPanelRequest<CompaniesWithPermissionResponse>({
    token: context.userToken,
    path: `/api/v1/permissions/${encodeURIComponent(permission)}/companies`,
  });

  const permittedCompanyIds = (permissionResponse.companies ?? [])
    .map((c) => c.company_id ?? c.companyId ?? c.id)
    .filter((id): id is number => typeof id === 'number' && Number.isFinite(id) && id > 0);

  const allowedCompanyIds = permittedCompanyIds.includes(requestedCompanyId) ? [requestedCompanyId] : [];
  return { permittedCompanyIds, allowedCompanyIds };
}

export function registerForecastingCompareSalesForecastScenariosTool(registry: ToolRegistry) {
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
    name: 'forecasting_compare_sales_forecast_scenarios',
    description:
      'Deep-dive comparison for a single item across forecast scenarios and/or run history; overlays actuals by default. Use country_code (e.g., US/UK/AU) for SKU-based lookups.',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const filters = (parsed.query.filters ?? {}) as any;
      const toolSpecific = parsed.tool_specific ?? {};
      const compare = toolSpecific.compare ?? {};

      const warnings: string[] = [];

      const { companyId, error } = normalizeCompanyId(filters);
      if (error) {
        return { rows: [], meta: { warnings, error } };
      }
      if (!companyId) {
        return {
          rows: [],
          meta: {
            warnings,
            error: 'query.filters.company_id is required for authorization (or query.filters.company as numeric string).',
          },
        };
      }

      const inventoryId = filters.inventory_id ? Number(filters.inventory_id) : undefined;
      const sku = Array.isArray(filters.sku) ? String(filters.sku[0] ?? '').trim() : '';
      const countryCodeRaw = Array.isArray(filters.country_code)
        ? String(filters.country_code[0] ?? '').trim()
        : Array.isArray(filters.marketplace)
          ? String(filters.marketplace[0] ?? '').trim()
          : '';

      const hasInventoryId = Boolean(inventoryId && Number.isFinite(inventoryId) && inventoryId > 0);
      const hasSkuSelector = sku.length > 0 && countryCodeRaw.length > 0;
      if (!hasInventoryId && !hasSkuSelector) {
        return {
          rows: [],
          meta: {
            warnings,
            error:
              'Item selector required: provide query.filters.inventory_id OR (query.filters.sku[0] and query.filters.country_code[0]). (query.filters.marketplace is a deprecated alias for country_code.)',
          },
        };
      }

      if (Array.isArray(compare.scenario_ids) && compare.scenario_ids.length > 0) {
        warnings.push('compare.scenario_ids is not supported yet; use compare.scenario_names.');
      }
      if (Array.isArray(compare.scenario_uuids) && compare.scenario_uuids.length > 0) {
        warnings.push('compare.scenario_uuids is not supported yet; use compare.scenario_names.');
      }

      const { permittedCompanyIds, allowedCompanyIds } = await getAllowedCompanyIds(companyId, context);
      if (permittedCompanyIds.length === 0 || allowedCompanyIds.length === 0) {
        return { rows: [], meta: { warnings, error: 'Not authorized for requested company_id.' } };
      }

      const limit = Math.min(500, parsed.query.limit ?? 200);

      const template = await loadTextFile(sqlPath);
      const query = renderSqlTemplate(template, {
        catalog: config.athena.catalog,
        database: config.athena.database,
        table: config.athena.tables.inventoryPlanningSnapshot,

        forecast_catalog: config.athena.catalog,
        forecast_database: config.athena.tables.forecastingDatabase,
        forecast_table_sales_forecast: config.athena.tables.salesForecast,
        forecast_table_sales_history: config.athena.tables.salesHistory,

        company_ids_array: sqlCompanyIdArrayExpr(allowedCompanyIds),

        inventory_id_sql: hasInventoryId ? String(Math.trunc(inventoryId!)) : 'CAST(NULL AS BIGINT)',
        sku_sql: hasSkuSelector ? sqlStringLiteral(sku) : 'CAST(NULL AS VARCHAR)',
        marketplace_sql: hasSkuSelector ? sqlStringLiteral(countryCodeRaw) : 'CAST(NULL AS VARCHAR)',

        apply_inventory_id_filter_sql: sqlBooleanLiteral(hasInventoryId),
        apply_sku_filter_sql: sqlBooleanLiteral(hasSkuSelector),
        apply_marketplace_filter_sql: sqlBooleanLiteral(hasSkuSelector),

        scenario_names_array: sqlVarcharArrayExpr(
          (Array.isArray(compare.scenario_names) ? compare.scenario_names : [])
            .map((s: any) => String(s).trim())
            .filter((s: string) => s.length > 0),
        ),

        compare_mode_sql: sqlStringLiteral(String(compare.mode ?? 'scenarios')),

        run_selector_type_sql: sqlStringLiteral(String(compare.run_selector?.type ?? 'latest_n')),
        run_latest_n: Number(compare.run_selector?.n ?? 3),
        updated_at_from_sql: sqlNullableTimestampExpr(compare.run_selector?.updated_at_from ?? null),
        updated_at_to_sql: sqlNullableTimestampExpr(compare.run_selector?.updated_at_to ?? null),

        include_actuals_sql: sqlBooleanLiteral(Boolean(compare.include_actuals ?? true)),

        period_start_sql: sqlNullableStringExpr(compare.period?.start ?? null),
        period_end_sql: sqlNullableStringExpr(compare.period?.end ?? null),

        limit_top_n: Number(limit),
      });

      const athenaResult = await runAthenaQuery({
        query,
        database: config.athena.database,
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows: limit,
      });

      const rowsRaw = (athenaResult.rows ?? []) as Array<Record<string, unknown>>;
      if (rowsRaw.length === 0) {
        return {
          rows: [],
          meta: {
            warnings,
            applied_compare: compare,
          },
        };
      }

      const first = rowsRaw[0] ?? {};
      const item_ref = {
        company_id: first.company_id,
        inventory_id: first.inventory_id,
        sku: first.sku,
        marketplace: first.marketplace,
        child_asin: first.child_asin,
        parent_asin: first.parent_asin,
        asin: first.asin,
        product_name: first.product_name,
        unit_price: first.unit_price,
      };

      const rows = rowsRaw.map((r) => ({
        period: r.period,
        units_sold: r.units_sold,
        sales_amount: r.sales_amount,
        currency: r.currency,
        seasonality_index: r.seasonality_index,
      }));

      return {
        item_ref,
        rows,
        meta: {
          warnings,
          applied_compare: compare,
        },
      };
    },
  });
}
