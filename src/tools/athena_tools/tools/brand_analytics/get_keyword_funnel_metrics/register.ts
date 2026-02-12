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

// ── Schemas ────────────────────────────────────────────────────────────────────

const querySchema = z
  .object({
    filters: z
      .object({
        company_id: z.coerce.number().int().min(1),
        keywords: z.array(z.string()).max(50).optional(),
        asin: z.array(z.string()).optional(),
        brand: z.array(z.string()).optional(),
        marketplace: z.array(z.string()).min(1).max(1).optional(),
        product_family: z.array(z.string()).optional(),
        revenue_abcd_class: z.array(z.enum(['A', 'B', 'C', 'D'])).optional(),
        pareto_abc_class: z.array(z.enum(['A', 'B', 'C'])).optional(),
      })
      .strict(),
    aggregation: z
      .object({
        time: z
          .object({
            periodicity: z.enum(['week', 'month', 'quarter']).default('week').optional(),
            start_date: z.string().optional(),
            end_date: z.string().optional(),
            periods_back: z.coerce.number().int().min(1).max(52).default(4).optional(),
          })
          .optional(),
      })
      .optional(),
    sort: z
      .object({
        field: z.string().optional(),
        direction: z.enum(['asc', 'desc']).optional(),
      })
      .optional(),
    select_fields: z.array(z.string()).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100).optional(),
  })
  .strict();

type QueryInput = z.infer<typeof querySchema>;

const toolSpecificSchema = z
  .object({
    match_type: z.enum(['exact', 'contains', 'starts_with']).default('contains').optional(),
    include_trending: z.boolean().default(true).optional(),
    min_search_frequency_rank: z.coerce.number().int().min(1).optional(),
    min_impressions: z.coerce.number().int().min(0).optional(),
    funnel_analysis: z
      .object({
        enabled: z.boolean().default(true).optional(),
        benchmark_against: z
          .enum(['market_average', 'top_competitor', 'historical_self'])
          .default('market_average')
          .optional(),
      })
      .strict()
      .optional(),
    competitor_context: z.boolean().default(false).optional(),
  })
  .strict();

type ToolSpecific = z.infer<typeof toolSpecificSchema>;

const inputSchema = z
  .object({
    query: querySchema,
    tool_specific: toolSpecificSchema.optional(),
  })
  .strict();

// ── Registration ───────────────────────────────────────────────────────────────

export function registerBrandAnalyticsGetKeywordFunnelMetricsTool(registry: ToolRegistry) {
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
    name: 'brand_analytics_get_keyword_funnel_metrics',
    description:
      'Returns search funnel data (Impressions → Clicks → Cart Adds → Purchases) with brand share vs total market for specific keywords from the SQP report.',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const query = parsed.query as QueryInput;
      const toolSpecific = parsed.tool_specific as ToolSpecific | undefined;

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
      const allowedCompanyIds = requestedCompanyIds.filter((id) => permittedCompanyIds.includes(id));

      if (permittedCompanyIds.length === 0 || allowedCompanyIds.length === 0) {
        return { items: [] };
      }

      // ── Extract filter values ─────────────────────────────────────────────
      const catalog = config.athena.catalog;
      const database = 'sp_api_iceberg';

      const keywords = (query.filters.keywords ?? []).map((k) => k.trim()).filter(Boolean);
      const marketplaces = (query.filters.marketplace ?? []).map((m) => m.trim()).filter(Boolean);
      const asins = (query.filters.asin ?? []).map((a) => a.trim()).filter(Boolean);
      const brands = (query.filters.brand ?? []).map((b) => b.trim()).filter(Boolean);
      const productFamilies = (query.filters.product_family ?? []).map((f) => f.trim()).filter(Boolean);
      const revenueClass = (query.filters.revenue_abcd_class ?? []).map((c) => c.trim()).filter(Boolean);
      const paretoClass = (query.filters.pareto_abc_class ?? []).map((c) => c.trim()).filter(Boolean);

      const matchType = toolSpecific?.match_type ?? 'contains';
      const minSfr = toolSpecific?.min_search_frequency_rank ?? 0;
      const minImpressions = toolSpecific?.min_impressions ?? 0;

      const SORTABLE_FIELDS = new Set([
        'search_frequency_rank', 'total_impressions', 'brand_impression_share',
        'total_clicks', 'brand_click_share', 'total_cart_adds', 'brand_cart_add_share',
        'total_purchases', 'brand_purchase_share',
        'market_impression_to_click_rate', 'market_click_to_cart_rate',
        'market_cart_to_purchase_rate', 'market_impression_to_purchase_rate',
        'brand_impression_to_click_rate', 'brand_click_to_cart_rate',
        'brand_cart_to_purchase_rate', 'brand_impression_to_purchase_rate',
      ]);

      const time = query.aggregation?.time;
      const periodsBack = time?.periods_back ?? 4;
      const limitTopN = query.limit ?? 100;
      const sortField = SORTABLE_FIELDS.has(query.sort?.field ?? '') ? query.sort!.field! : 'search_frequency_rank';
      const sortDirection = query.sort?.direction ?? (sortField === 'search_frequency_rank' ? 'asc' : 'desc');

      // ── Render & execute SQL ──────────────────────────────────────────────
      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        catalog,
        limit_top_n: Number(limitTopN),
        start_date_sql: sqlDateExpr(time?.start_date),
        end_date_sql: sqlDateExpr(time?.end_date),
        periods_back: Number(periodsBack),
        company_ids_array: sqlBigintArrayExpr(allowedCompanyIds),
        keywords_array: sqlVarcharArrayExpr(keywords),
        match_type_sql: sqlStringLiteral(matchType),
        marketplaces_array: sqlVarcharArrayExpr(marketplaces),
        asins_array: sqlVarcharArrayExpr(asins),
        brands_array: sqlVarcharArrayExpr(brands),
        product_families_array: sqlVarcharArrayExpr(productFamilies),
        revenue_abcd_class_array: sqlVarcharArrayExpr(revenueClass),
        pareto_abc_class_array: sqlVarcharArrayExpr(paretoClass),
        min_search_frequency_rank: Number(minSfr),
        min_impressions: Number(minImpressions),

        // Sort (whitelisted column name, safe for interpolation)
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
