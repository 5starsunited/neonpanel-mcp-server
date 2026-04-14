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

function sqlEscapeString(value: string): string {
  return value.replace(/'/g, "''");
}

function sqlStringLiteral(value: string): string {
  return `'${sqlEscapeString(value)}'`;
}

function sqlBigintArrayExpr(values: number[]): string {
  if (values.length === 0) return 'CAST(ARRAY[] AS ARRAY(BIGINT))';
  return `CAST(ARRAY[${values.map((n) => String(Math.trunc(n))).join(',')}] AS ARRAY(BIGINT))`;
}

function sqlVarcharArrayExpr(values: string[]): string {
  if (values.length === 0) return 'CAST(ARRAY[] AS ARRAY(VARCHAR))';
  return `CAST(ARRAY[${values.map(sqlStringLiteral).join(',')}] AS ARRAY(VARCHAR))`;
}

function sqlDateExpr(value?: string): string {
  const trimmed = value?.trim();
  if (!trimmed) return 'CAST(NULL AS DATE)';
  return `DATE ${sqlStringLiteral(trimmed)}`;
}

// ── Schemas ────────────────────────────────────────────────────────────────────

const PERIODICITY_OPTIONS = ['month', 'quarter', 'year', 'total'] as const;

const querySchema = z
  .object({
    filters: z
      .object({
        company_id: z.coerce.number().int().min(1),
        customer_names: z.array(z.string()).optional(),
        customer_name_match_type: z
          .enum(['exact', 'contains', 'starts_with'])
          .default('contains')
          .optional(),
        customer_ids: z.array(z.coerce.number().int().min(1)).optional(),
      })
      .strict(),
    time: z
      .object({
        start_date: z.string().optional(),
        end_date: z.string().optional(),
      })
      .optional(),
    periodicity: z.enum(PERIODICITY_OPTIONS).default('month').optional(),
    group_by_company: z.coerce.number().int().min(0).max(1).default(0).optional(),
  })
  .passthrough();

type QueryInput = z.infer<typeof querySchema>;

const inputSchema = z
  .object({
    query: querySchema,
  })
  .strict();

// ── Registration ───────────────────────────────────────────────────────────────

export function registerFinancialsAnalyzeProfitAndLossTool(registry: ToolRegistry) {
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
    name: 'financials_analyze_profit_and_loss',
    description:
      'Analyzes the Profit & Loss statement (P&L waterfall). Computes Gross Revenue, Sales, VAT, Reimbursements, Promo Discounts, Refunds, Liquidations, Revenue, Cost of Inventory Sold, CM1, Amazon Fees, CM2, Amazon Promotion, CM3, Expenses, EBITDA, and Margin from journal entry data. Supports monthly, quarterly, yearly, or total periodicity.',
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

      // ── Extract parameters ────────────────────────────────────────────────
      const catalog = config.athena.catalog;
      const database = 'neonpanel_iceberg';

      const periodicity = query.periodicity ?? 'month';
      const groupByCompany = query.group_by_company ?? 0;

      const customerNames = (query.filters.customer_names ?? []).map((s) => s.trim()).filter(Boolean);
      const customerNameMatchType = query.filters.customer_name_match_type ?? 'contains';
      const customerIds = (query.filters.customer_ids ?? [])
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && n > 0);

      // Default to last calendar month when no time params are provided (LA timezone)
      let startDate = query.time?.start_date;
      let endDate = query.time?.end_date;

      if (!startDate && !endDate) {
        const todayLA = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
        const [y, m] = todayLA.split('-').map(Number);
        const lastMonthStart = new Date(y, m - 2, 1);
        const lastMonthEnd = new Date(y, m - 1, 0);
        startDate = `${lastMonthStart.getFullYear()}-${String(lastMonthStart.getMonth() + 1).padStart(2, '0')}-01`;
        endDate = `${lastMonthEnd.getFullYear()}-${String(lastMonthEnd.getMonth() + 1).padStart(2, '0')}-${String(lastMonthEnd.getDate()).padStart(2, '0')}`;
      }

      // ── Render & execute SQL ──────────────────────────────────────────────
      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        catalog,
        start_date_sql: sqlDateExpr(startDate),
        end_date_sql: sqlDateExpr(endDate),
        company_ids_array: sqlBigintArrayExpr(allowedCompanyIds),
        periodicity_sql: sqlStringLiteral(periodicity),
        group_by_company: groupByCompany,

        // Customer filters
        customer_names_array: sqlVarcharArrayExpr(customerNames),
        customer_name_match_type_sql: sqlStringLiteral(customerNameMatchType),
        customer_ids_array: sqlBigintArrayExpr(customerIds),
      });

      const athenaResult = await runAthenaQuery({
        query: rendered,
        database,
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows: 500,
      });

      return { items: athenaResult.rows ?? [] };
    },
  });
}
