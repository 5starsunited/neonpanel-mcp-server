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

// ── Schemas ────────────────────────────────────────────────────────────────────

const CLASSIFY_MODES = ['default', 'reference'] as const;

const COA_GROUP_BY_OPTIONS = ['account_classification', 'account_type', 'account_name', 'service_name', 'marketplace', 'settlement'] as const;
const REF_GROUP_BY_OPTIONS = ['class', 'subclass', 'service_name', 'marketplace', 'settlement'] as const;
const ALL_GROUP_BY_OPTIONS = [
  'account_classification', 'account_type', 'account_name',
  'class', 'subclass', 'service_name', 'marketplace', 'settlement',
] as const;

const ALL_SORTABLE_FIELDS = [
  'class_code',
  'subclass_code',
  'account_classification',
  'account_type',
  'account_name',
  'total_amount',
  'total_debit',
  'total_credit',
  'line_count',
] as const;

const querySchema = z
  .object({
    mode: z.enum(CLASSIFY_MODES).default('default').optional(),
    filters: z
      .object({
        company_id: z.coerce.number().int().min(1),
        settlement_ids: z.array(z.coerce.string()).optional(),
        marketplace_codes: z.array(z.string()).optional(),
        // Reference mode filters
        class_codes: z.array(z.string()).optional(),
        subclass_codes: z.array(z.string()).optional(),
        // CoA (default) mode filters
        account_classifications: z.array(z.string()).optional(),
        account_types: z.array(z.string()).optional(),
        account_names: z.array(z.string()).optional(),
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
        group_by: z
          .array(z.enum(ALL_GROUP_BY_OPTIONS))
          .optional(),
      })
      .optional(),
    sort: z
      .object({
        field: z.enum(ALL_SORTABLE_FIELDS).default('total_amount').optional(),
        direction: z.enum(['asc', 'desc']).default('asc').optional(),
      })
      .optional(),
    limit: z.coerce.number().int().min(1).max(500).default(200).optional(),
  })
  .strict();

type QueryInput = z.infer<typeof querySchema>;

const inputSchema = z
  .object({
    query: querySchema,
  })
  .strict();

// ── Registration ───────────────────────────────────────────────────────────────

export function registerFinancialsClassifyAmazonStatementTransactionsTool(
  registry: ToolRegistry,
) {
  const toolJsonPath = path.join(__dirname, 'tool.json');
  const sqlPathReference = path.join(__dirname, 'query.sql');
  const sqlPathCoa = path.join(__dirname, 'query_coa.sql');

  let specJson: ToolSpecJson | undefined;
  try {
    if (fs.existsSync(toolJsonPath)) {
      specJson = JSON.parse(fs.readFileSync(toolJsonPath, 'utf8')) as ToolSpecJson;
    }
  } catch {
    specJson = undefined;
  }

  registry.register({
    name: 'financials_classify_amazon_statement_transactions',
    description:
      'Aggregates Amazon settlement transactions by classification. Supports two modes: default (CoA-based — maps service_name → accounts → account_types) and reference (NeonPanel class/subclass hierarchy).',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const query = parsed.query as QueryInput;

      const mode = query.mode ?? 'default';

      // ── Permission check ──────────────────────────────────────────────
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
      const database = config.athena.tables.financialAccountingDatabase;
      const limitTopN = query.limit ?? 200;
      const sortDirection = query.sort?.direction ?? 'asc';
      const sortField = query.sort?.field ?? 'total_amount';

      const settlementIds = (query.filters.settlement_ids ?? []).map((s) => s.trim()).filter(Boolean);
      const marketplaceCodes = (query.filters.marketplace_codes ?? []).map((s) => s.trim()).filter(Boolean);

      // Mode-specific defaults for group_by
      const defaultGroupBy = mode === 'reference'
        ? ['class', 'subclass'] as const
        : ['account_classification', 'account_type', 'account_name'] as const;
      const groupBy = query.aggregation?.group_by ?? [...defaultGroupBy];

      // Default time range: last 3 months.
      let startDate = query.time?.start_date;
      let endDate = query.time?.end_date;
      if (!startDate && !endDate) {
        const todayLA = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
        const [y, m] = todayLA.split('-').map(Number);
        const threeMonthsAgo = new Date(y, m - 1 - 3, 1);
        startDate = `${threeMonthsAgo.getFullYear()}-${String(threeMonthsAgo.getMonth() + 1).padStart(2, '0')}-01`;
        endDate = todayLA;
      }

      // Partition bounds for pruning.
      const startD = startDate ? new Date(startDate) : new Date();
      const endD = endDate ? new Date(endDate) : new Date();
      const bufStart = new Date(startD.getFullYear(), startD.getMonth() - 1, 1);
      const bufEnd = new Date(endD.getFullYear(), endD.getMonth() + 1, 1);
      const partYearStart = String(bufStart.getFullYear());
      const partMonthStart = `${bufStart.getFullYear()}-${String(bufStart.getMonth() + 1).padStart(2, '0')}`;
      const partYearEnd = String(bufEnd.getFullYear());
      const partMonthEnd = `${bufEnd.getFullYear()}-${String(bufEnd.getMonth() + 1).padStart(2, '0')}`;

      // ── Build & execute mode-specific SQL ─────────────────────────────
      const sqlPath = mode === 'reference' ? sqlPathReference : sqlPathCoa;
      const template = await loadTextFile(sqlPath);

      // Common template variables shared by both modes
      const commonVars: Record<string, string | number> = {
        catalog,
        limit_top_n: Number(limitTopN),
        start_date_sql: sqlDateExpr(startDate),
        end_date_sql: sqlDateExpr(endDate),
        company_ids_array: sqlBigintArrayExpr(allowedCompanyIds),

        // Filters
        settlement_ids_array: sqlVarcharArrayExpr(settlementIds),
        marketplace_codes_array: sqlVarcharArrayExpr(marketplaceCodes),

        // Partition pruning
        partition_year_start: Number(partYearStart),
        partition_month_start: sqlStringLiteral(partMonthStart),
        partition_year_end: Number(partYearEnd),
        partition_month_end: sqlStringLiteral(partMonthEnd),

        // Sort
        sort_column: sortField,
        sort_direction: sortDirection.toUpperCase(),

        // Group-by flags (common)
        group_by_service_name: groupBy.includes('service_name') ? 1 : 0,
        group_by_marketplace: groupBy.includes('marketplace') ? 1 : 0,
        group_by_settlement: groupBy.includes('settlement') ? 1 : 0,
      };

      let rendered: string;

      if (mode === 'reference') {
        // Reference mode: use class/subclass filters and group-by
        const classCodes = (query.filters.class_codes ?? []).map((s) => s.trim()).filter(Boolean);
        const subclassCodes = (query.filters.subclass_codes ?? []).map((s) => s.trim()).filter(Boolean);

        rendered = renderSqlTemplate(template, {
          ...commonVars,
          class_codes_array: sqlVarcharArrayExpr(classCodes),
          subclass_codes_array: sqlVarcharArrayExpr(subclassCodes),
          group_by_class: groupBy.includes('class') ? 1 : 0,
          group_by_subclass: groupBy.includes('subclass') ? 1 : 0,
        });
      } else {
        // CoA (default) mode: use account filters and group-by
        const accountClassifications = (query.filters.account_classifications ?? []).map((s) => s.trim()).filter(Boolean);
        const accountTypes = (query.filters.account_types ?? []).map((s) => s.trim()).filter(Boolean);
        const accountNames = (query.filters.account_names ?? []).map((s) => s.trim()).filter(Boolean);

        rendered = renderSqlTemplate(template, {
          ...commonVars,
          account_classifications_array: sqlVarcharArrayExpr(accountClassifications),
          account_types_array: sqlVarcharArrayExpr(accountTypes),
          account_names_array: sqlVarcharArrayExpr(accountNames),
          group_by_account_classification: groupBy.includes('account_classification') ? 1 : 0,
          group_by_account_type: groupBy.includes('account_type') ? 1 : 0,
          group_by_account_name: groupBy.includes('account_name') ? 1 : 0,
        });
      }

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
