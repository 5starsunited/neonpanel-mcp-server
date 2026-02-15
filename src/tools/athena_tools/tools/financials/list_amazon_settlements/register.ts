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

// ── Schema ─────────────────────────────────────────────────────────────────────

const querySchema = z
  .object({
    filters: z
      .object({
        company_id: z.coerce.number().int().min(1),
        settlement_ids: z.array(z.coerce.number().int()).optional(),
        marketplace_names: z.array(z.string()).optional(),
        currencies: z.array(z.string()).optional(),
        seller_ids: z.array(z.string()).optional(),
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

export function registerFinancialsListAmazonSettlementsTool(registry: ToolRegistry) {
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
    name: 'financials_list_amazon_settlements',
    description:
      'Lists Amazon settlement reports – one row per settlement showing settlement ID, date range, deposit date, total payout amount, currency, seller ID, and company name. Use this to browse, search, or filter settlements before drilling into transaction details with financials_analyze_amazon_statement.',
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

      const permittedCompanyIds = Array.from(allPermittedCompanyIds);
      const requestedCompanyIds = [query.filters.company_id];
      const allowedCompanyIds = requestedCompanyIds.filter((id) =>
        permittedCompanyIds.includes(id),
      );

      if (permittedCompanyIds.length === 0 || allowedCompanyIds.length === 0) {
        return { items: [] };
      }

      // ── Extract values ────────────────────────────────────────────────
      const catalog = config.athena.catalog;
      const database = 'sp_api_iceberg';
      const limitTopN = query.limit ?? 50;
      const sortDirection = query.sort_direction ?? 'desc';

      const settlementIds = query.filters.settlement_ids ?? [];
      const marketplaceNames = (query.filters.marketplace_names ?? []).map((s) => s.trim()).filter(Boolean);
      const currencies = (query.filters.currencies ?? []).map((s) => s.trim()).filter(Boolean);
      const sellerIds = (query.filters.seller_ids ?? []).map((s) => s.trim()).filter(Boolean);
      const minAmount = query.filters.min_amount ?? null;
      const maxAmount = query.filters.max_amount ?? null;

      // Default time range: last 3 months
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
        settlement_ids_array: sqlBigintArrayExpr(settlementIds),
        marketplace_names_array: sqlVarcharArrayExpr(marketplaceNames),
        currencies_array: sqlVarcharArrayExpr(currencies),
        seller_ids_array: sqlVarcharArrayExpr(sellerIds),
        min_amount_sql: sqlNullableDecimal(minAmount),
        max_amount_sql: sqlNullableDecimal(maxAmount),
        sort_direction: sortDirection.toUpperCase(),
        partition_year_start: sqlStringLiteral(partYearStart),
        partition_month_start: sqlStringLiteral(partMonthStart),
        partition_year_end: sqlStringLiteral(partYearEnd),
        partition_month_end: sqlStringLiteral(partMonthEnd),
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
