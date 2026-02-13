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

function sqlNullableInt(value?: number | null): string {
  if (value === undefined || value === null) return 'CAST(NULL AS INTEGER)';
  return String(Math.trunc(value));
}

// ── Schemas ────────────────────────────────────────────────────────────────────

const GROUP_BY_OPTIONS = [
  'account',
  'account_type',
  'classification',
  'statement',
  'report_chart',
  'company',
] as const;

const SORTABLE_FIELDS = [
  'total_debit',
  'total_credit',
  'net',
  'line_count',
  'journal_entry_count',
  'account_count',
] as const;

const PERIODICITY_OPTIONS = ['day', 'month', 'quarter', 'year', 'total'] as const;

const querySchema = z
  .object({
    filters: z
      .object({
        company_id: z.coerce.number().int().min(1),
        account_types: z.array(z.string()).optional(),
        classifications: z
          .array(z.enum(['Asset', 'Liability', 'Equity', 'Revenue', 'Expense']))
          .optional(),
        statements: z.array(z.enum(['PL', 'BS'])).optional(),
        account_names: z.array(z.string()).optional(),
        account_name_match_type: z
          .enum(['exact', 'contains', 'starts_with'])
          .default('contains')
          .optional(),
        account_numbers: z.array(z.string()).optional(),
        document_types: z.array(z.string()).optional(),
        sde: z.coerce.number().int().min(0).max(1).optional(),
        ebitda: z.coerce.number().int().min(0).max(1).optional(),
        pnl: z.coerce.number().int().min(0).max(1).optional(),
        active: z.coerce.number().int().min(0).max(1).optional(),
      })
      .strict(),
    aggregation: z
      .object({
        time: z
          .object({
            start_date: z.string().optional(),
            end_date: z.string().optional(),
            periods_back: z.coerce.number().int().min(1).max(260).default(4).optional(),
          })
          .optional(),
        periodicity: z.enum(PERIODICITY_OPTIONS).default('total').optional(),
        group_by: z
          .array(z.enum(GROUP_BY_OPTIONS))
          .default(['account'])
          .optional(),
      })
      .optional(),
    sort: z
      .object({
        field: z.enum(SORTABLE_FIELDS).default('net').optional(),
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

export function registerFinancialsAnalyzeGeneralLedgerTool(registry: ToolRegistry) {
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
    name: 'financials_analyze_general_ledger',
    description:
      'Analyzes the General Ledger (journal entries and accounts). Aggregates debit, credit, and net amounts by account, account type, classification, statement (P&L / Balance Sheet), and time period. All amounts are in the company\'s main currency.',
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

      // ── Extract filter values ─────────────────────────────────────────────
      const catalog = config.athena.catalog;
      const database = 'neonpanel_iceberg';

      const accountTypes = (query.filters.account_types ?? []).map((s) => s.trim()).filter(Boolean);
      const classifications = (query.filters.classifications ?? []).map((s) => s.trim()).filter(Boolean);
      const statements = (query.filters.statements ?? []).map((s) => s.trim()).filter(Boolean);
      const accountNames = (query.filters.account_names ?? []).map((s) => s.trim()).filter(Boolean);
      const accountNameMatchType = query.filters.account_name_match_type ?? 'contains';
      const accountNumbers = (query.filters.account_numbers ?? []).map((s) => s.trim()).filter(Boolean);
      const documentTypes = (query.filters.document_types ?? []).map((s) => s.trim()).filter(Boolean);

      const sdeFilter = query.filters.sde ?? null;
      const ebitdaFilter = query.filters.ebitda ?? null;
      const pnlFilter = query.filters.pnl ?? null;
      const activeFilter = query.filters.active ?? null;

      const groupBy = query.aggregation?.group_by ?? ['account'];
      const periodicity = query.aggregation?.periodicity ?? 'total';
      const sortField = query.sort?.field ?? 'net';
      const sortDirection = query.sort?.direction ?? 'desc';
      const time = query.aggregation?.time;
      const limitTopN = query.limit ?? 100;

      // Default to last calendar month when no time params are provided
      let startDate = time?.start_date;
      let endDate = time?.end_date;
      const periodsBack = time?.periods_back ?? 4;

      if (!startDate && !endDate && !time?.periods_back) {
        const now = new Date();
        const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0); // day 0 = last day of prev month
        startDate = lastMonthStart.toISOString().slice(0, 10);
        endDate = lastMonthEnd.toISOString().slice(0, 10);
      }

      // ── Render & execute SQL ──────────────────────────────────────────────
      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        catalog,
        limit_top_n: Number(limitTopN),
        start_date_sql: sqlDateExpr(startDate),
        end_date_sql: sqlDateExpr(endDate),
        periods_back: Number(periodsBack),
        company_ids_array: sqlBigintArrayExpr(allowedCompanyIds),

        // Filter arrays
        account_types_array: sqlVarcharArrayExpr(accountTypes),
        classifications_array: sqlVarcharArrayExpr(classifications),
        statements_array: sqlVarcharArrayExpr(statements),
        account_names_array: sqlVarcharArrayExpr(accountNames),
        account_name_match_type_sql: sqlStringLiteral(accountNameMatchType),
        account_numbers_array: sqlVarcharArrayExpr(accountNumbers),
        document_types_array: sqlVarcharArrayExpr(documentTypes),

        // Boolean flag filters (nullable int)
        sde_filter: sqlNullableInt(sdeFilter),
        ebitda_filter: sqlNullableInt(ebitdaFilter),
        pnl_filter: sqlNullableInt(pnlFilter),
        active_filter: sqlNullableInt(activeFilter),

        // Periodicity
        periodicity_sql: sqlStringLiteral(periodicity),

        // Sort (whitelisted column name, safe for interpolation)
        sort_column: sortField,
        sort_direction: sortDirection.toUpperCase(),

        // Group-by flags
        group_by_account: groupBy.includes('account') ? 1 : 0,
        group_by_account_type: groupBy.includes('account_type') ? 1 : 0,
        group_by_classification: groupBy.includes('classification') ? 1 : 0,
        group_by_statement: groupBy.includes('statement') ? 1 : 0,
        group_by_report_chart: groupBy.includes('report_chart') ? 1 : 0,
        group_by_company: groupBy.includes('company') ? 1 : 0,
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
