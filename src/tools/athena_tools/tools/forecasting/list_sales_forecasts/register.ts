import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runClickHouseQuery } from '../../../../../clients/clickhouse';
import { neonPanelRequest } from '../../../../../clients/neonpanel-api';
import type { ToolExecutionContext, ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CompaniesWithPermissionResponse = {
  companies?: Array<{
    company_id?: number;
    companyId?: number;
    id?: number;
  }>;
};

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------

function sqlEscapeString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function sqlStringLiteral(value: string): string {
  return `'${sqlEscapeString(value)}'`;
}

function sqlStringArrayExpr(values: string[]): string {
  if (values.length === 0) return 'CAST([], \'Array(String)\')';
  return `[${values.map(sqlStringLiteral).join(',')}]`;
}

function sqlCompanyIdArrayExpr(values: number[]): string {
  if (values.length === 0) return 'CAST([], \'Array(UInt64)\')';
  return `[${values.map((n) => String(Math.trunc(n))).join(',')}]`;
}

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const inputSchema = z
  .object({
    query: z
      .object({
        filters: z
          .object({
            company: z.string().optional(),
            company_id: z.coerce.number().int().min(1).optional(),
            scenario: z.array(z.string()).optional(),
            marketplace: z.array(z.string()).optional(),
            sales_channel: z.array(z.string()).optional(),
            country_code: z.array(z.string()).optional(),
            calc_period: z.array(z.string()).optional(),
          })
          .catchall(z.unknown()),
        limit: z.coerce.number().int().min(1).max(500).default(50).optional(),
      })
      .strict(),
  })
  .strict();

const fallbackOutputSchema = { type: 'object', additionalProperties: true } as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeCompanyId(filters: any): { companyId?: number; error?: string } {
  const companyId = filters.company_id ? Number(filters.company_id) : undefined;
  if (companyId && Number.isFinite(companyId) && companyId > 0) {
    return { companyId: Math.trunc(companyId) };
  }

  if (typeof filters.company === 'string' && filters.company.trim().length > 0) {
    const raw = filters.company.trim();
    if (!/^\d+$/.test(raw)) {
      return {
        error:
          'query.filters.company must be a numeric string (company_id). Do not pass a company name. Call account_list_companies and use query.filters.company_id.',
      };
    }
    return { companyId: Math.trunc(Number(raw)) };
  }

  return {};
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerForecastingListSalesForecastsTool(registry: ToolRegistry) {
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
    name: 'forecasting_list_sales_forecasts',
    description:
      'List all available forecast runs for a company. Returns one row per distinct forecast run with summary stats. Use limit=1 to get the latest run.',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? fallbackOutputSchema,
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const filters = parsed.query.filters as any;
      const warnings: string[] = [];

      // ---- Company ID ----
      const { companyId, error } = normalizeCompanyId(filters);
      if (error) {
        return { items: [], meta: { warnings: [error] } };
      }
      if (!companyId) {
        return { items: [], meta: { warnings: ['query.filters.company_id is required.'] } };
      }

      // ---- Authorization ----
      const permission = 'view:quicksight_group.sales_and_marketing_new';
      const permissionResponse = await neonPanelRequest<CompaniesWithPermissionResponse>({
        token: context.userToken,
        path: `/api/v1/permissions/${encodeURIComponent(permission)}/companies`,
      });

      const permittedCompanyIds = (permissionResponse.companies ?? [])
        .map((c) => c.company_id ?? c.companyId ?? c.id)
        .filter((id): id is number => typeof id === 'number' && Number.isFinite(id) && id > 0);

      if (!permittedCompanyIds.includes(companyId)) {
        return {
          items: [],
          meta: { warnings: ['Requested company_id is not permitted for this token.'] },
        };
      }

      const allowedCompanyIds = [companyId];

      // ---- Filter extraction ----
      const datasets = ((filters.scenario ?? []) as unknown[])
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        .map((v) => v.trim());

      const marketplaces = ((filters.marketplace ?? []) as unknown[])
        .map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : ''))
        .filter((v) => v.length > 0);

      const salesChannels = ((filters.sales_channel ?? []) as unknown[])
        .map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : ''))
        .filter((v) => v.length > 0);

      const countryCodes = ((filters.country_code ?? []) as unknown[])
        .map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : ''))
        .filter((v) => v.length > 0);

      const calcPeriods = ((filters.calc_period ?? []) as unknown[])
        .filter((v): v is string => typeof v === 'string' && /^\d{4}-\d{2}$/.test(v.trim()))
        .map((v) => v.trim());

      const limit = Math.min(500, parsed.query.limit ?? 50);

      // ---- SQL ----
      const template = await loadTextFile(sqlPath);
      const query = renderSqlTemplate(template, {
        company_ids_array: sqlCompanyIdArrayExpr(allowedCompanyIds),
        datasets_array: sqlStringArrayExpr(datasets),
        marketplaces_array: sqlStringArrayExpr(marketplaces),
        sales_channels_array: sqlStringArrayExpr(salesChannels),
        country_codes_array: sqlStringArrayExpr(countryCodes),
        calc_periods_array: sqlStringArrayExpr(calcPeriods),
        limit_top_n: Number(limit),
      });

      // ---- Execute ----
      const clickHouseResult = await runClickHouseQuery({ query });
      const rows = clickHouseResult.rows;

      const items = rows.map((r) => {
        return {
          company_id: r.company_id != null ? Number(r.company_id) : undefined,
          calc_period: r.calc_period as string | undefined,
          updated_at: r.updated_at as string | undefined,
          dataset: r.dataset as string | undefined,
          scenario_uuid: r.scenario_uuid as string | undefined,
          item_count: r.item_count != null ? Number(r.item_count) : undefined,
          period_count: r.period_count != null ? Number(r.period_count) : undefined,
          period_start: r.period_start as string | undefined,
          period_end: r.period_end as string | undefined,
          total_rows: r.total_rows != null ? Number(r.total_rows) : undefined,
          total_units: r.total_units != null ? Number(r.total_units) : undefined,
          total_sales_amount: r.total_sales_amount != null ? Number(r.total_sales_amount) : undefined,
          marketplace_ids: Array.isArray(r.marketplace_ids) ? r.marketplace_ids.map(String) : [],
          currencies: Array.isArray(r.currencies) ? r.currencies.map(String) : [],
          sales_channels: Array.isArray(r.sales_channels) ? r.sales_channels.map(String) : [],
          country_codes: Array.isArray(r.country_codes) ? r.country_codes.map(String) : [],
          sku_count: r.sku_count != null ? Number(r.sku_count) : undefined,
        };
      });

      return {
        items,
        meta: {
          total_runs: items.length,
          warnings: warnings.length > 0 ? warnings : undefined,
        },
      };
    },
  });
}
