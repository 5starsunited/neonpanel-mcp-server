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

const UNMAPPED_MODES = ['coa', 'reference'] as const;

const SORTABLE_FIELDS = ['total_amount', 'line_count'] as const;

const querySchema = z
  .object({
    mode: z.enum(UNMAPPED_MODES).default('coa').optional(),
    filters: z
      .object({
        company_id: z.coerce.number().int().min(1),
        settlement_ids: z.array(z.coerce.string()).optional(),
        marketplace_codes: z.array(z.string()).optional(),
      })
      .strict(),
    time: z
      .object({
        start_date: z.string().optional(),
        end_date: z.string().optional(),
      })
      .optional(),
    sort: z
      .object({
        field: z.enum(SORTABLE_FIELDS).default('line_count').optional(),
        direction: z.enum(['asc', 'desc']).default('desc').optional(),
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

export function registerFinancialsListUnmappedStatementTransactionsTool(
  registry: ToolRegistry,
) {
  const toolJsonPath = path.join(__dirname, 'tool.json');
  const sqlPathRef = path.join(__dirname, 'query_ref.sql');
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
    name: 'financials_list_unmapped_statement_transactions',
    description:
      'Lists Amazon settlement transaction combos that lack classification mapping. Two modes: reference (missing settlement_flat_mapping rules) and coa (missing service → account links).',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const query = parsed.query as QueryInput;

      const mode = query.mode ?? 'coa';

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
      const sortDirection = query.sort?.direction ?? 'desc';
      const sortField = query.sort?.field ?? 'line_count';

      const settlementIds = (query.filters.settlement_ids ?? []).map((s) => s.trim()).filter(Boolean);
      const marketplaceCodes = (query.filters.marketplace_codes ?? []).map((s) => s.trim()).filter(Boolean);

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
      const sqlPath = mode === 'reference' ? sqlPathRef : sqlPathCoa;
      const template = await loadTextFile(sqlPath);

      const rendered = renderSqlTemplate(template, {
        catalog,
        limit_top_n: Number(limitTopN),
        start_date_sql: sqlDateExpr(startDate),
        end_date_sql: sqlDateExpr(endDate),
        company_ids_array: sqlBigintArrayExpr(allowedCompanyIds),
        settlement_ids_array: sqlVarcharArrayExpr(settlementIds),
        marketplace_codes_array: sqlVarcharArrayExpr(marketplaceCodes),
        partition_year_start: Number(partYearStart),
        partition_month_start: sqlStringLiteral(partMonthStart),
        partition_year_end: Number(partYearEnd),
        partition_month_end: sqlStringLiteral(partMonthEnd),
        sort_column: sortField,
        sort_direction: sortDirection.toUpperCase(),
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
