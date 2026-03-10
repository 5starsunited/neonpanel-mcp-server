import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runAthenaQuery } from '../../../../../clients/athena';
import { neonPanelRequest } from '../../../../../clients/neonpanel-api';
import { config } from '../../../../../config';
import type { ToolExecutionContext, ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function sqlBigintArrayExpr(values: number[]): string {
  if (values.length === 0) return 'CAST(ARRAY[] AS ARRAY(BIGINT))';
  return `CAST(ARRAY[${values.map((n) => String(Math.trunc(n))).join(',')}] AS ARRAY(BIGINT))`;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const sharedQuerySchema = z
  .object({
    filters: z
      .object({
        company: z.string().optional(),
        company_id: z.coerce.number().int().min(1).optional(),
        order_name: z.array(z.string()).optional(),
        sku: z.array(z.string()).optional(),
        seller_name: z.array(z.string()).optional(),
        financial_status: z.array(z.string()).optional(),
        fulfillment_status: z.array(z.string()).optional(),
        event_type: z.array(z.string()).optional(),
        event_status: z.array(z.string()).optional(),
        currency: z.array(z.string()).optional(),
        warehouse_name: z.array(z.string()).optional(),
        inventory_id: z.array(z.coerce.number().int()).optional(),
        date_from: z.string().optional(),
        date_to: z.string().optional(),
      })
      .catchall(z.unknown())
      .optional(),
    aggregation: z
      .object({
        group_by: z
          .array(
            z.enum([
              'company',
              'seller',
              'financial_status',
              'fulfillment_status',
              'currency',
              'event_type',
              'event_status',
              'warehouse',
              'sku',
              'order_month',
            ]),
          )
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

const inputSchema = z
  .object({
    query: sharedQuerySchema,
  })
  .strict();

const fallbackOutputSchema = { type: 'object', additionalProperties: true } as const;

// ---------------------------------------------------------------------------
// Company resolution helpers
// ---------------------------------------------------------------------------

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
          'query.filters.company must be a numeric string (company_id). Do not pass a company name. Call account_list_companies first.',
      };
    }
    return { companyId: Math.trunc(Number(raw)) };
  }

  return {};
}

async function getAllowedCompanyIds(requestedCompanyId: number | undefined, context: ToolExecutionContext) {
  const permission = 'view:quicksight_group.inventory_management_new';
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

// ---------------------------------------------------------------------------
// Group-by dimension helpers
// ---------------------------------------------------------------------------

type DimColumn = { baseExpr: string; alias: string };

function buildGroupByDimensions(groupBy: string[]): DimColumn[] {
  const dims: DimColumn[] = [
    { baseExpr: 't.company_id', alias: 'company_id' },
    { baseExpr: 't.company_name', alias: 'company_name' },
  ];

  for (const key of groupBy) {
    switch (key) {
      case 'company':
        break; // already included
      case 'seller':
        dims.push({ baseExpr: "COALESCE(CAST(t.seller_id AS VARCHAR), '__UNKNOWN__')", alias: 'seller_id' });
        dims.push({ baseExpr: "COALESCE(t.seller_name, '__UNKNOWN__')", alias: 'seller_name' });
        dims.push({ baseExpr: "COALESCE(t.store_status, '__UNKNOWN__')", alias: 'store_status' });
        dims.push({ baseExpr: "COALESCE(t.store_domain, '__UNKNOWN__')", alias: 'store_domain' });
        break;
      case 'financial_status':
        dims.push({ baseExpr: "COALESCE(t.financial_status, '__UNKNOWN__')", alias: 'financial_status' });
        break;
      case 'fulfillment_status':
        dims.push({ baseExpr: "COALESCE(t.fulfillment_status, '__UNKNOWN__')", alias: 'fulfillment_status' });
        break;
      case 'currency':
        dims.push({ baseExpr: "COALESCE(t.order_currency, '__UNKNOWN__')", alias: 'order_currency' });
        break;
      case 'event_type':
        dims.push({ baseExpr: "COALESCE(t.event_type, '__UNKNOWN__')", alias: 'event_type' });
        break;
      case 'event_status':
        dims.push({ baseExpr: "COALESCE(t.event_status, '__UNKNOWN__')", alias: 'event_status' });
        break;
      case 'warehouse':
        dims.push({ baseExpr: "COALESCE(t.warehouse_name, '__UNKNOWN__')", alias: 'warehouse_name' });
        break;
      case 'sku':
        dims.push({ baseExpr: "COALESCE(t.sku, '__UNKNOWN__')", alias: 'sku' });
        dims.push({ baseExpr: "COALESCE(t.item_title, '__UNKNOWN__')", alias: 'item_title' });
        break;
      case 'order_month':
        dims.push({
          baseExpr: "DATE_FORMAT(t.order_created_at, '%Y-%m')",
          alias: 'order_month',
        });
        break;
    }
  }

  return dims;
}

function buildGroupTemplateVars(dims: DimColumn[]): Record<string, string> {
  return {
    group_select_base: dims.map((d) => `${d.baseExpr} AS ${d.alias}`).join(',\n    '),
    group_by_clause_base: dims.map((d) => d.baseExpr).join(', '),
  };
}

// ---------------------------------------------------------------------------
// Helper: build filter arrays from raw filters
// ---------------------------------------------------------------------------

function buildFilterArrays(filters: any) {
  const str = (key: string) =>
    Array.isArray(filters[key])
      ? filters[key].map((s: any) => String(s).trim()).filter((s: string) => s.length > 0)
      : [];

  const nums = (key: string) =>
    Array.isArray(filters[key])
      ? filters[key].map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0)
      : [];

  return {
    orderNameList: str('order_name'),
    skuList: str('sku'),
    sellerNameList: str('seller_name'),
    financialStatusList: str('financial_status'),
    fulfillmentStatusList: str('fulfillment_status'),
    eventTypeList: str('event_type'),
    eventStatusList: str('event_status'),
    currencyList: str('currency'),
    warehouseNameList: str('warehouse_name'),
    inventoryIdList: nums('inventory_id'),
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerShopifyListOrdersTool(registry: ToolRegistry) {
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
    name: 'shopify_list_orders',
    description:
      'List Shopify orders with line items and fulfillment/order events. Supports filtering by status, SKU, seller, warehouse, date range, and aggregation.',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? fallbackOutputSchema,
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const query = parsed.query;
      const filters = (query.filters ?? {}) as any;

      const warnings: string[] = [];

      // ---- Company ID resolution ----
      const { companyId, error } = normalizeCompanyIdFilters(filters);
      if (error) {
        return {
          items: [],
          meta: { warnings, error, applied_sort: query.sort ?? null, selected_fields: query.select_fields ?? null },
        };
      }

      // ---- Unsupported-filter warnings ----
      if (query.cursor) {
        warnings.push('Pagination cursor is not supported yet; ignoring query.cursor.');
      }
      if (query.sort?.field) {
        warnings.push(
          'Server-side sorting is not implemented yet; using default sort (order_created_at DESC).',
        );
      }

      // ---- Determine aggregation mode ----
      const validGroupByKeys = new Set([
        'company',
        'seller',
        'financial_status',
        'fulfillment_status',
        'currency',
        'event_type',
        'event_status',
        'warehouse',
        'sku',
        'order_month',
      ]);
      const groupBy = [...new Set((query.aggregation?.group_by ?? []).filter((g) => validGroupByKeys.has(g)))];
      const isAggregated = groupBy.length > 0;

      // ---- Authorization ----
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

      // ---- Build template variables ----
      const catalog = config.athena.catalog;
      const limit = Math.min(2000, query.limit ?? 50);

      const f = buildFilterArrays(filters);

      const commonTemplateVars: Record<string, string | number> = {
        catalog,
        limit_top_n: Number(limit),

        company_ids_array: sqlBigintArrayExpr(allowedCompanyIds),

        order_names_array: sqlVarcharArrayExpr(f.orderNameList),
        order_names_lower_array: sqlVarcharArrayExpr(f.orderNameList.map((s: string) => s.toLowerCase())),
        skus_array: sqlVarcharArrayExpr(f.skuList),
        skus_lower_array: sqlVarcharArrayExpr(f.skuList.map((s: string) => s.toLowerCase())),
        seller_names_array: sqlVarcharArrayExpr(f.sellerNameList),
        seller_names_lower_array: sqlVarcharArrayExpr(f.sellerNameList.map((s: string) => s.toLowerCase())),
        financial_statuses_array: sqlVarcharArrayExpr(f.financialStatusList),
        financial_statuses_lower_array: sqlVarcharArrayExpr(
          f.financialStatusList.map((s: string) => s.toLowerCase()),
        ),
        fulfillment_statuses_array: sqlVarcharArrayExpr(f.fulfillmentStatusList),
        fulfillment_statuses_lower_array: sqlVarcharArrayExpr(
          f.fulfillmentStatusList.map((s: string) => s.toLowerCase()),
        ),
        event_types_array: sqlVarcharArrayExpr(f.eventTypeList),
        event_types_lower_array: sqlVarcharArrayExpr(f.eventTypeList.map((s: string) => s.toLowerCase())),
        event_statuses_array: sqlVarcharArrayExpr(f.eventStatusList),
        event_statuses_lower_array: sqlVarcharArrayExpr(f.eventStatusList.map((s: string) => s.toLowerCase())),
        currencies_array: sqlVarcharArrayExpr(f.currencyList),
        currencies_lower_array: sqlVarcharArrayExpr(f.currencyList.map((s: string) => s.toLowerCase())),
        warehouse_names_array: sqlVarcharArrayExpr(f.warehouseNameList),
        warehouse_names_lower_array: sqlVarcharArrayExpr(
          f.warehouseNameList.map((s: string) => s.toLowerCase()),
        ),
        inventory_ids_array: sqlBigintArrayExpr(f.inventoryIdList),

        date_from_sql: filters.date_from
          ? `DATE '${sqlEscapeString(String(filters.date_from))}'`
          : 'CAST(NULL AS DATE)',
        date_to_sql: filters.date_to
          ? `DATE '${sqlEscapeString(String(filters.date_to))}'`
          : 'CAST(NULL AS DATE)',
      };

      const maxRows = limit;

      // ================================================================
      // AGGREGATED path
      // ================================================================
      if (isAggregated) {
        const dims = buildGroupByDimensions(groupBy);
        const groupVars = buildGroupTemplateVars(dims);

        const sqlPath = path.join(__dirname, 'query_grouped.sql');
        const template = await loadTextFile(sqlPath);
        const rendered = renderSqlTemplate(template, { ...commonTemplateVars, ...groupVars });

        const athenaResult = await runAthenaQuery({
          query: rendered,
          database: config.athena.database,
          workGroup: config.athena.workgroup,
          outputLocation: config.athena.outputLocation,
          maxRows,
        });

        const items = (athenaResult.rows ?? []).map((row) => row as Record<string, unknown>);

        const filtered = companyId
          ? items.filter((it) => String((it as any).company_id) === String(companyId))
          : items;

        return {
          items: filtered,
          meta: {
            warnings,
            group_by: groupBy,
            applied_sort: query.sort ?? null,
            selected_fields: query.select_fields ?? null,
          },
        };
      }

      // ================================================================
      // DETAIL path
      // ================================================================
      const sqlPath = path.join(__dirname, 'query.sql');
      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, commonTemplateVars);

      const athenaResult = await runAthenaQuery({
        query: rendered,
        database: config.athena.database,
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows,
      });

      const items = (athenaResult.rows ?? []).map((row) => row as Record<string, unknown>);

      if (companyId) {
        return {
          items: items.filter((it) => String((it as any).company_id) === String(companyId)),
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
