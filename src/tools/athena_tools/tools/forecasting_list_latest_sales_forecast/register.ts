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

function sqlVarcharArrayExpr(values: string[]): string {
  if (values.length === 0) return 'CAST(ARRAY[] AS ARRAY(VARCHAR))';
  return `CAST(ARRAY[${values.map(sqlStringLiteral).join(',')}] AS ARRAY(VARCHAR))`;
}

function sqlCompanyIdArrayExpr(values: number[]): string {
  if (values.length === 0) return 'CAST(ARRAY[] AS ARRAY(BIGINT))';
  return `CAST(ARRAY[${values.map((n) => String(Math.trunc(n))).join(',')}] AS ARRAY(BIGINT))`;
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

const toolSpecificSchema = z
  .object({
    horizon_months: z.coerce.number().int().min(1).max(24).default(12).optional(),
    include_plan_series: z.boolean().default(true).optional(),
    include_sales_history_signals: z.boolean().default(true).optional(),
    aggregate: z.boolean().default(false).optional(),
    aggregate_by: z.enum(['parent_asin', 'product_family']).default('parent_asin').optional(),
    include_item_sales_share: z.boolean().default(false).optional(),
    sales_share_basis: z.enum(['sales_last_30_days', 'units_sold_last_30_days']).default('sales_last_30_days').optional(),
  })
  .strict();

const inputSchema = z
  .object({
    query: sharedQuerySchema,
    tool_specific: z.unknown().optional(),
  })
  .strict();

const fallbackOutputSchema = { type: 'object', additionalProperties: true } as const;

function normalizeCompanyIdFilters(filters: any): { companyId?: number; error?: string } {
  if (!filters) return {};

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

async function getAllowedCompanyIds(requestedCompanyId: number | undefined, context: ToolExecutionContext) {
  const permission = 'view:quicksight_group.business_planning_new';
  const permissionResponse = await neonPanelRequest<CompaniesWithPermissionResponse>({
    token: context.userToken,
    path: `/api/v1/permissions/${encodeURIComponent(permission)}/companies`,
  });

  const permittedCompanies = (permissionResponse.companies ?? []).filter(
    (c): c is { company_id?: number; companyId?: number; id?: number } => c !== null && typeof c === 'object',
  );

  const permittedCompanyIds = permittedCompanies
    .map((c) => c.company_id ?? c.companyId ?? c.id)
    .filter((id): id is number => typeof id === 'number' && Number.isFinite(id) && id > 0);

  const requestedCompanyIds = requestedCompanyId ? [requestedCompanyId] : permittedCompanyIds;
  const allowedCompanyIds = requestedCompanyIds.filter((id) => permittedCompanyIds.includes(id));

  return { permittedCompanyIds, allowedCompanyIds };
}

export function registerForecastingListLatestSalesForecastTool(registry: ToolRegistry) {
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
    name: 'forecasting_list_latest_sales_forecast',
    description: 'List items with latest/current forecast plan and inventory attributes (query envelope).',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? fallbackOutputSchema,
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const query = parsed.query;
      const filters = (query.filters ?? {}) as any;
      const toolSpecific = toolSpecificSchema.parse((parsed.tool_specific ?? {}) as unknown);

      const warnings: string[] = [];

      const { companyId, error } = normalizeCompanyIdFilters(filters);
      if (error) {
        return {
          items: [],
          meta: {
            warnings,
            error,
            applied_sort: query.sort ?? null,
            selected_fields: query.select_fields ?? null,
          },
        };
      }

      if (filters.tags && Array.isArray(filters.tags) && filters.tags.length > 0) {
        warnings.push('Unsupported filter ignored: query.filters.tags (no tags column in snapshot).');
      }
      if (filters.pareto_abc_class && Array.isArray(filters.pareto_abc_class) && filters.pareto_abc_class.length > 0) {
        warnings.push('Unsupported filter ignored: query.filters.pareto_abc_class (not supported by this tool yet).');
      }
      if (query.aggregation?.group_by && query.aggregation.group_by.some((g: string) => g && g !== 'none')) {
        warnings.push('query.aggregation.group_by is not implemented; use tool_specific.aggregate + tool_specific.aggregate_by.');
      }
      if (query.aggregation?.time) {
        warnings.push('query.aggregation.time is not supported for latest-forecast view; ignoring.');
      }
      if (query.cursor) {
        warnings.push('Pagination cursor is not supported yet; ignoring query.cursor.');
      }
      if (query.sort?.field) {
        warnings.push('Server-side sorting is not implemented yet; using default sort (recent sales desc).');
      }

      const { permittedCompanyIds, allowedCompanyIds } = await getAllowedCompanyIds(companyId, context);
      if (permittedCompanyIds.length === 0 || allowedCompanyIds.length === 0) {
        return {
          items: [],
          meta: {
            warnings,
            error: 'No permitted companies for this token (or requested company_id is not permitted).',
          },
        };
      }

      const catalog = config.athena.catalog;
      const database = config.athena.database;
      const table = config.athena.tables.inventoryPlanningSnapshot;
      const forecastingDatabase = config.athena.tables.forecastingDatabase;
      const salesForecastTable = config.athena.tables.salesForecast;

      const limit = Math.min(2000, query.limit ?? 50);

      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        catalog,
        database,
        table,
        forecasting_database: forecastingDatabase,
        sales_forecast_table: salesForecastTable,

        limit_top_n: Number(limit),
        horizon_months: Number(toolSpecific.horizon_months ?? 12),
        include_plan_series_sql: toolSpecific.include_plan_series ? 'TRUE' : 'FALSE',
        include_sales_history_signals_sql: toolSpecific.include_sales_history_signals ? 'TRUE' : 'FALSE',

        aggregate_sql: toolSpecific.aggregate ? 'TRUE' : 'FALSE',
        aggregate_by_sql: `'${toolSpecific.aggregate_by}'`,
        include_item_sales_share_sql: toolSpecific.include_item_sales_share ? 'TRUE' : 'FALSE',
        sales_share_basis_sql: `'${toolSpecific.sales_share_basis}'`,

        company_ids_array: sqlCompanyIdArrayExpr(allowedCompanyIds),
        skus_array: sqlVarcharArrayExpr((filters.sku ?? []).map(String)),
        asins_array: sqlVarcharArrayExpr((filters.asin ?? []).map(String)),
        parent_asins_array: sqlVarcharArrayExpr((filters.parent_asin ?? []).map(String)),
        brands_array: sqlVarcharArrayExpr((filters.brand ?? []).map(String)),
        product_families_array: sqlVarcharArrayExpr((filters.product_family ?? []).map(String)),
        marketplaces_array: sqlVarcharArrayExpr((filters.marketplace ?? []).map(String)),
        revenue_abcd_classes_array: sqlVarcharArrayExpr((filters.revenue_abcd_class ?? []).map(String)),
      });

      const athenaResult = await runAthenaQuery({
        query: rendered,
        database,
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows: limit,
      });

      const items = (athenaResult.rows ?? []).map((row) => row as Record<string, unknown>);

      // Defensive: if caller requests a specific company_id, enforce it client-side as well.
      if (companyId) {
        return {
          items: items.filter((it) => (it as any).company_id === companyId),
          meta: {
            warnings,
            applied_sort: query.sort ?? null,
            selected_fields: query.select_fields ?? null,
          },
        };
      }

      return {
        items,
        meta: {
          warnings,
          applied_sort: query.sort ?? null,
          selected_fields: query.select_fields ?? null,
        },
      };
    },
  });
}
