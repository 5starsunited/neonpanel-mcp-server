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

function sqlDateExpr(value?: string): string {
  const trimmed = value?.trim();
  if (!trimmed) return 'CAST(NULL AS DATE)';
  return `DATE ${sqlStringLiteral(trimmed)}`;
}

// ── Schema ─────────────────────────────────────────────────────────────────────

const querySchema = z
  .object({
    filters: z
      .object({
        company_id: z.coerce.number().int().min(1),
        year: z.coerce.number().int().min(2020).max(2030).optional(),
        statuses: z.array(z.enum(['Match', 'Discrepancy', 'Unknown'])).optional(),
        include_details: z.boolean().default(false).optional(),
      })
      .strict(),
    time: z
      .object({
        start_date: z.string().optional(),
        end_date: z.string().optional(),
      })
      .optional(),
    sort_direction: z.enum(['asc', 'desc']).default('desc').optional(),
    limit: z.coerce.number().int().min(1).max(500).default(50).optional(),
  })
  .strict();

type QueryInput = z.infer<typeof querySchema>;

const inputSchema = z
  .object({
    query: querySchema,
  })
  .strict();

// ── Registration ───────────────────────────────────────────────────────────────

export function registerFinancialsListAmazonStatementReconciliationResultsTool(
  registry: ToolRegistry,
) {
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
    name: 'financials_list_amazon_statement_reconciliation_results',
    description:
      'Lists previously saved Amazon statement reconciliation results. Returns summaries and optionally per-category detail rows.',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const query = parsed.query as QueryInput;

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

      const companyId = query.filters.company_id;
      if (!allPermittedCompanyIds.has(companyId)) {
        return { items: [] };
      }

      // ── Extract values ────────────────────────────────────────────────
      const faCatalog = config.athena.catalog;
      const faDatabase = config.athena.tables.financialAccountingDatabase;
      const faTableSummaries = config.athena.tables.paymentsSummaries;
      const faTableDetails = config.athena.tables.paymentsTransactionDetails;

      const limitTopN = query.limit ?? 50;
      const sortDirection = query.sort_direction ?? 'desc';
      const includeDetails = query.filters.include_details ?? false;

      // Default year: current year (LA timezone)
      const todayLA = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
      const year = query.filters.year ?? Number(todayLA.split('-')[0]);

      const statuses = (query.filters.statuses ?? []).map((s) => s.trim()).filter(Boolean);

      const startDate = query.time?.start_date;
      const endDate = query.time?.end_date;

      // ── Render & execute SQL ──────────────────────────────────────────
      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        fa_catalog: faCatalog,
        fa_database: faDatabase,
        fa_table_summaries: faTableSummaries,
        fa_table_details: faTableDetails,
        company_id: companyId,
        year,
        statuses_array: sqlVarcharArrayExpr(statuses),
        start_date_sql: sqlDateExpr(startDate),
        end_date_sql: sqlDateExpr(endDate),
        include_details: includeDetails ? 'TRUE' : 'FALSE',
        limit_top_n: limitTopN,
        sort_direction: sortDirection.toUpperCase(),
      });

      const athenaResult = await runAthenaQuery({
        query: rendered,
        database: faDatabase,
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows: limitTopN,
      });

      const rows = athenaResult.rows ?? [];
      const summaries = rows.filter((r: Record<string, unknown>) => r.row_type === 'summary');
      const details = rows.filter((r: Record<string, unknown>) => r.row_type === 'detail');

      return {
        items: summaries,
        details: includeDetails ? details : undefined,
        total_count: summaries.length,
        detail_count: includeDetails ? details.length : undefined,
      };
    },
  });
}
