import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runAthenaQuery } from '../../../../../clients/athena';
import { neonPanelRequest } from '../../../../../clients/neonpanel-api';
import { config } from '../../../../../config';
import type { ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';

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

// ── SQL helpers ────────────────────────────────────────────────────────────────

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

function sqlDateExpr(value?: string): string {
  const trimmed = value?.trim();
  if (!trimmed) return 'CAST(NULL AS DATE)';
  return `DATE ${sqlStringLiteral(trimmed)}`;
}

function sqlNullableDecimal(value?: number | null): string {
  if (value === undefined || value === null) return 'CAST(NULL AS DOUBLE)';
  return String(value);
}

// ── Schemas ────────────────────────────────────────────────────────────────────

const PERIODICITY_OPTIONS = ['day', 'week', 'month', 'quarter', 'year', 'total'] as const;

const GROUP_BY_OPTIONS = [
  'company',
  'marketplace',
  'settlement',
  'amount_type',
  'amount_description',
  'transaction_type',
  'sku',
  'order',
  'fulfillment',
] as const;

const SORTABLE_FIELDS = [
  'total_amount',
  'total_amount_main',
  'line_count',
  'order_count',
  'settlement_count',
  'total_quantity',
] as const;

const querySchema = z
  .object({
    filters: z
      .object({
        company_id: z.coerce.number().int().min(1),
        settlement_ids: z.array(z.coerce.number().int()).optional(),
        marketplace_names: z.array(z.string()).optional(),
        transaction_types: z.array(z.string()).optional(),
        amount_types: z.array(z.string()).optional(),
        amount_descriptions: z.array(z.string()).optional(),
        order_ids: z.array(z.string()).optional(),
        skus: z.array(z.string()).optional(),
        fulfillment_ids: z.array(z.string()).optional(),
        min_amount: z.coerce.number().optional(),
        max_amount: z.coerce.number().optional(),
      })
      .strict(),
    time: z
      .object({
        start_date: z.string().optional(),
        end_date: z.string().optional(),
      })
      .optional(),
    aggregation: z
      .object({
        periodicity: z.enum(PERIODICITY_OPTIONS).default('total').optional(),
        group_by: z
          .array(z.enum(GROUP_BY_OPTIONS))
          .default(['transaction_type', 'amount_type'])
          .optional(),
      })
      .optional(),
    sort: z
      .object({
        field: z.enum(SORTABLE_FIELDS).default('total_amount').optional(),
        direction: z.enum(['asc', 'desc']).default('desc').optional(),
      })
      .optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100).optional(),
  })
  .strict();

type QueryInput = z.infer<typeof querySchema>;

const inputSchema = z
  .object({
    query: querySchema,
  })
  .strict();

// ── Registration ───────────────────────────────────────────────────────────────

export function registerFinancialsAnalyzeAmazonStatementTool(registry: ToolRegistry) {
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
    name: 'financials_analyze_amazon_statement',
    description:
      'Analyzes Amazon settlement transaction details – filters and aggregates individual line items (revenue, fees, refunds, taxes) with currency conversion to the company\'s main currency. Supports grouping by company, marketplace, settlement, amount_type, amount_description, transaction_type, SKU, order, fulfillment, and time period.',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const query = parsed.query as QueryInput;

      // ── Permission check – user needs at least ONE of these permissions ──
      const permissions = [
        'view:quicksight_group.bookkeeping',
        'view:quicksight_group.audit_and_comliance_new',
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
            (c): c is { company_id?: number; companyId?: number; id?: number } =>
              c !== null && typeof c === 'object',
          );

          permittedCompanies.forEach((c) => {
            const id = c.company_id ?? c.companyId ?? c.id;
            if (typeof id === 'number' && Number.isFinite(id) && id > 0) {
              allPermittedCompanyIds.add(id);
            }
          });
        } catch {
          // Continue if one permission check fails
        }
      }

      const permittedCompanyIds = Array.from(allPermittedCompanyIds);
      const requestedCompanyIds = [query.filters.company_id];
      const allowedCompanyIds = requestedCompanyIds.filter((id) =>
        permittedCompanyIds.includes(id),
      );

      if (permittedCompanyIds.length === 0 || allowedCompanyIds.length === 0) {
        return { items: [] };
      }

      // ── Extract values ──────────────────────────────────────────────────
      const catalog = config.athena.catalog;
      const database = 'sp_api_iceberg';
      const limitTopN = query.limit ?? 100;
      const sortDirection = query.sort?.direction ?? 'desc';
      const sortField = query.sort?.field ?? 'total_amount';

      const settlementIds = query.filters.settlement_ids ?? [];
      const marketplaceNames = (query.filters.marketplace_names ?? []).map((s) => s.trim()).filter(Boolean);
      const transactionTypes = (query.filters.transaction_types ?? []).map((s) => s.trim()).filter(Boolean);
      const amountTypes = (query.filters.amount_types ?? []).map((s) => s.trim()).filter(Boolean);
      const amountDescriptions = (query.filters.amount_descriptions ?? []).map((s) => s.trim()).filter(Boolean);
      const orderIds = (query.filters.order_ids ?? []).map((s) => s.trim()).filter(Boolean);
      const skus = (query.filters.skus ?? []).map((s) => s.trim()).filter(Boolean);
      const fulfillmentIds = (query.filters.fulfillment_ids ?? []).map((s) => s.trim()).filter(Boolean);
      const minAmount = query.filters.min_amount ?? null;
      const maxAmount = query.filters.max_amount ?? null;

      const groupBy = query.aggregation?.group_by ?? ['transaction_type', 'amount_type'];
      const periodicity = query.aggregation?.periodicity ?? 'total';

      // Default time range: last 3 months when no time params are provided
      let startDate = query.time?.start_date;
      let endDate = query.time?.end_date;
      if (!startDate && !endDate) {
        const now = new Date();
        const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
        startDate = threeMonthsAgo.toISOString().slice(0, 10);
        endDate = now.toISOString().slice(0, 10);
      }

      // Compute partition bounds for pruning (1-month buffer on start for edge cases)
      const startD = startDate ? new Date(startDate) : new Date();
      const endD = endDate ? new Date(endDate) : new Date();
      const bufStart = new Date(startD.getFullYear(), startD.getMonth() - 1, 1);
      const partYearStart = String(bufStart.getFullYear());
      const partMonthStart = String(bufStart.getMonth() + 1).padStart(2, '0');
      const partYearEnd = String(endD.getFullYear());
      const partMonthEnd = String(endD.getMonth() + 1).padStart(2, '0');

      // ── Render & execute SQL ──────────────────────────────────────────
      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        catalog,
        limit_top_n: Number(limitTopN),
        start_date_sql: sqlDateExpr(startDate),
        end_date_sql: sqlDateExpr(endDate),
        company_ids_array: sqlBigintArrayExpr(allowedCompanyIds),

        // Filters
        settlement_ids_array: sqlBigintArrayExpr(settlementIds),
        marketplace_names_array: sqlVarcharArrayExpr(marketplaceNames),
        transaction_types_array: sqlVarcharArrayExpr(transactionTypes),
        amount_types_array: sqlVarcharArrayExpr(amountTypes),
        amount_descriptions_array: sqlVarcharArrayExpr(amountDescriptions),
        order_ids_array: sqlVarcharArrayExpr(orderIds),
        skus_array: sqlVarcharArrayExpr(skus),
        fulfillment_ids_array: sqlVarcharArrayExpr(fulfillmentIds),
        min_amount_sql: sqlNullableDecimal(minAmount),
        max_amount_sql: sqlNullableDecimal(maxAmount),

        // Partition pruning
        partition_year_start: sqlStringLiteral(partYearStart),
        partition_month_start: sqlStringLiteral(partMonthStart),
        partition_year_end: sqlStringLiteral(partYearEnd),
        partition_month_end: sqlStringLiteral(partMonthEnd),

        // Periodicity
        periodicity_sql: sqlStringLiteral(periodicity),

        // Sort (whitelisted column name, safe for interpolation)
        sort_column: sortField,
        sort_direction: sortDirection.toUpperCase(),

        // Group-by flags
        group_by_company: groupBy.includes('company') ? 1 : 0,
        group_by_marketplace: groupBy.includes('marketplace') ? 1 : 0,
        group_by_settlement: groupBy.includes('settlement') ? 1 : 0,
        group_by_amount_type: groupBy.includes('amount_type') ? 1 : 0,
        group_by_amount_description: groupBy.includes('amount_description') ? 1 : 0,
        group_by_transaction_type: groupBy.includes('transaction_type') ? 1 : 0,
        group_by_sku: groupBy.includes('sku') ? 1 : 0,
        group_by_order: groupBy.includes('order') ? 1 : 0,
        group_by_fulfillment: groupBy.includes('fulfillment') ? 1 : 0,
      });

      const athenaResult = await runAthenaQuery({
        query: rendered,
        database,
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows: limitTopN,
      });

      return { items: athenaResult.rows ?? [] };
    },
  });
}
