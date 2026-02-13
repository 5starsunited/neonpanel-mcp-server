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

function sqlNullableDecimal(value?: number | null): string {
  if (value === undefined || value === null) return 'CAST(NULL AS DECIMAL(15,3))';
  return `CAST(${value} AS DECIMAL(15,3))`;
}

// ── Schemas ────────────────────────────────────────────────────────────────────

const querySchema = z
  .object({
    filters: z
      .object({
        company_id: z.coerce.number().int().min(1),
        je_names: z.array(z.string()).optional(),
        je_name_match_type: z
          .enum(['exact', 'contains', 'starts_with'])
          .default('contains')
          .optional(),
        doc_numbers: z.array(z.string()).optional(),
        source_doc_types: z.array(z.string()).optional(),
        target_doc_types: z.array(z.string()).optional(),
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
    sort_direction: z.enum(['asc', 'desc']).default('desc').optional(),
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

export function registerFinancialsListJournalEntriesTool(registry: ToolRegistry) {
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
    name: 'financials_list_journal_entries',
    description:
      'Lists journal entry headers with summary stats (line count, total debit/credit/net, attachment count). Searchable by name, doc number, document type, amount range, and date range.',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const query = parsed.query as QueryInput;

      // ── Permission check ──────────────────────────────────────────────────
      const permission = 'view:quicksight_group.business_planning_new';
      const permissionResponse = await neonPanelRequest<CompaniesWithPermissionResponse>({
        token: context.userToken,
        path: `/api/v1/permissions/${encodeURIComponent(permission)}/companies`,
      });

      const permittedCompanies = (permissionResponse.companies ?? []).filter(
        (c): c is { company_id?: number; companyId?: number; id?: number } =>
          c !== null && typeof c === 'object',
      );

      const permittedCompanyIds = permittedCompanies
        .map((c) => c.company_id ?? c.companyId ?? c.id)
        .filter((id): id is number => typeof id === 'number' && Number.isFinite(id) && id > 0);

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

      const jeNames = (query.filters.je_names ?? []).map((s) => s.trim()).filter(Boolean);
      const jeNameMatchType = query.filters.je_name_match_type ?? 'contains';
      const docNumbers = (query.filters.doc_numbers ?? []).map((s) => s.trim()).filter(Boolean);
      const sourceDocTypes = (query.filters.source_doc_types ?? []).map((s) => s.trim()).filter(Boolean);
      const targetDocTypes = (query.filters.target_doc_types ?? []).map((s) => s.trim()).filter(Boolean);

      const minAmount = query.filters.min_amount ?? null;
      const maxAmount = query.filters.max_amount ?? null;

      const sortDirection = query.sort_direction ?? 'desc';
      const limitTopN = query.limit ?? 100;

      // Default to last calendar month when no time params are provided
      let startDate = query.time?.start_date;
      let endDate = query.time?.end_date;

      if (!startDate && !endDate) {
        const now = new Date();
        const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
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
        company_ids_array: sqlBigintArrayExpr(allowedCompanyIds),

        // JE filters
        je_names_array: sqlVarcharArrayExpr(jeNames),
        je_name_match_type_sql: sqlStringLiteral(jeNameMatchType),
        doc_numbers_array: sqlVarcharArrayExpr(docNumbers),
        source_doc_types_array: sqlVarcharArrayExpr(sourceDocTypes),
        target_doc_types_array: sqlVarcharArrayExpr(targetDocTypes),

        // Amount filters
        min_amount_sql: sqlNullableDecimal(minAmount),
        max_amount_sql: sqlNullableDecimal(maxAmount),

        // Sort
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
