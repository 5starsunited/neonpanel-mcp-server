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

const querySchema = z
  .object({
    filters: z
      .object({
        company_id: z.coerce.number().int().min(1),
        sync_statuses: z
          .array(z.enum(['Off', 'Ready', 'Going', 'Synced', 'Error']))
          .optional(),
        has_error: z.boolean().optional(),
        source_doc_types: z.array(z.string()).optional(),
        target_doc_types: z.array(z.string()).optional(),
        doc_numbers: z.array(z.string()).optional(),
        qbo_transaction_refs: z.array(z.string()).optional(),
        active: z.coerce.number().int().min(0).max(1).optional(),
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

// Map human-readable sync status to qbo_sync_status_id
const syncStatusMap: Record<string, number> = {
  Off: 0,
  Ready: 1,
  Going: 2,
  Synced: 3,
  Error: 4,
};

// ── Registration ───────────────────────────────────────────────────────────────

export function registerFinancialsGetBookkeepingSyncRegisterTool(registry: ToolRegistry) {
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
    name: 'financials_get_bookkeeping_sync_register',
    description:
      'Shows the bookkeeping sync register – the status of document synchronisation with QuickBooks Online or Xero. Lists sync entries with status, errors, and links to the accounting platform.',
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

      const syncStatuses = (query.filters.sync_statuses ?? [])
        .map((s) => syncStatusMap[s])
        .filter((id): id is number => id !== undefined);
      const hasError = query.filters.has_error ?? null;
      const sourceDocTypes = (query.filters.source_doc_types ?? []).map((s) => s.trim()).filter(Boolean);
      const targetDocTypes = (query.filters.target_doc_types ?? []).map((s) => s.trim()).filter(Boolean);
      const docNumbers = (query.filters.doc_numbers ?? []).map((s) => s.trim()).filter(Boolean);
      const qboTransactionRefs = (query.filters.qbo_transaction_refs ?? []).map((s) => s.trim()).filter(Boolean);
      const activeFilter = query.filters.active ?? null;

      const sortDirection = query.sort_direction ?? 'desc';
      const limitTopN = query.limit ?? 100;

      // Default to last calendar month when no time params
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

        // Sync filters — pass as varchar array, cast in SQL
        sync_statuses_array: sqlVarcharArrayExpr(syncStatuses.map(String)),
        has_error_filter: sqlNullableInt(hasError === null ? null : hasError ? 1 : 0),

        // Document type filters
        source_doc_types_array: sqlVarcharArrayExpr(sourceDocTypes),
        target_doc_types_array: sqlVarcharArrayExpr(targetDocTypes),

        // Ref filters
        doc_numbers_array: sqlVarcharArrayExpr(docNumbers),
        qbo_transaction_refs_array: sqlVarcharArrayExpr(qboTransactionRefs),

        // Active
        active_filter: sqlNullableInt(activeFilter),

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
