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

const GROUP_BY_OPTIONS = [
  'search_term',
  'campaign_name',
  'match_type',
  'product_family',
  'brand',
  'pareto_abc_class',
] as const;

const SORTABLE_FIELDS = [
  'impressions',
  'clicks',
  'cost_usd',
  'sales_usd',
  'purchases',
  'units_sold',
  'cpc_usd',
  'ctr_pct',
  'cvr_pct',
  'acos_pct',
  'roas',
  'sales_same_sku_usd',
  'days_active',
  'asin_count',
] as const;

const querySchema = z
  .object({
    filters: z
      .object({
        company_id: z.coerce.number().int().min(1),
        search_terms: z.array(z.string()).optional(),
        match_type: z.enum(['exact', 'contains', 'starts_with']).default('contains').optional(),
        marketplace: z.array(z.string()).min(1).max(1).optional(),
        campaign_names: z.array(z.string()).optional(),
        ad_match_types: z.array(z.enum(['BROAD', 'PHRASE', 'EXACT'])).optional(),
        asins: z.array(z.string()).optional(),
        product_families: z.array(z.string()).optional(),
        brands: z.array(z.string()).optional(),
        pareto_abc_classes: z.array(z.enum(['A', 'B', 'C'])).optional(),
        revenue_abcd_classes: z.array(z.enum(['A', 'B', 'C', 'D'])).optional(),
      })
      .strict(),
    aggregation: z
      .object({
        time: z
          .object({
            start_date: z.string().optional(),
            end_date: z.string().optional(),
            periods_back: z.coerce.number().int().min(1).max(52).default(4).optional(),
          })
          .optional(),
        group_by: z.array(z.enum(GROUP_BY_OPTIONS)).default(['search_term']).optional(),
      })
      .optional(),
    sort: z
      .object({
        field: z.enum(SORTABLE_FIELDS).default('cost_usd').optional(),
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

export function registerAdvertisingAnalyzeSearchTermsTool(registry: ToolRegistry) {
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
    name: 'advertising_analyze_search_terms',
    description:
      'Analyzes Amazon Sponsored Products Search Term Report data enriched with ASIN attributes (product_family, brand, pareto_abc_class) via campaign→ASIN mapping.',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const query = parsed.query as QueryInput;

      // ── Permission check – user needs at least ONE of these permissions ──
      const permissions = [
        'view:quicksight_group.sales_and_marketing_new',
        'view:quicksight_group.marketing',
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
      const allowedCompanyIds = requestedCompanyIds.filter((id) => permittedCompanyIds.includes(id));

      if (permittedCompanyIds.length === 0 || allowedCompanyIds.length === 0) {
        return { items: [] };
      }

      // ── Extract filter values ─────────────────────────────────────────────
      const catalog = config.athena.catalog;
      const database = 'amazon_ads_reports_iceberg';

      const searchTerms = (query.filters.search_terms ?? []).map((s) => s.trim()).filter(Boolean);
      const matchType = query.filters.match_type ?? 'contains';
      const marketplaces = (query.filters.marketplace ?? []).map((m) => m.trim()).filter(Boolean);
      const campaignNames = (query.filters.campaign_names ?? []).map((c) => c.trim()).filter(Boolean);
      const adMatchTypes = (query.filters.ad_match_types ?? []).map((m) => m.trim()).filter(Boolean);
      const asins = (query.filters.asins ?? []).map((a) => a.trim()).filter(Boolean);
      const productFamilies = (query.filters.product_families ?? []).map((p) => p.trim()).filter(Boolean);
      const brands = (query.filters.brands ?? []).map((b) => b.trim()).filter(Boolean);
      const paretoClasses = (query.filters.pareto_abc_classes ?? []).map((p) => p.trim()).filter(Boolean);
      const revenueClasses = (query.filters.revenue_abcd_classes ?? []).map((r) => r.trim()).filter(Boolean);

      const groupBy = query.aggregation?.group_by ?? ['search_term'];
      const sortField = query.sort?.field ?? 'cost_usd';
      const sortDirection = query.sort?.direction ?? 'desc';
      const time = query.aggregation?.time;
      const periodsBack = time?.periods_back ?? 4;
      const limitTopN = query.limit ?? 100;

      // ── Render & execute SQL ──────────────────────────────────────────────
      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        catalog,
        limit_top_n: Number(limitTopN),
        start_date_sql: sqlDateExpr(time?.start_date),
        end_date_sql: sqlDateExpr(time?.end_date),
        periods_back: Number(periodsBack),
        company_ids_array: sqlBigintArrayExpr(allowedCompanyIds),

        // Filter arrays
        search_terms_array: sqlVarcharArrayExpr(searchTerms),
        match_type_sql: sqlStringLiteral(matchType),
        marketplaces_array: sqlVarcharArrayExpr(marketplaces),
        campaign_names_array: sqlVarcharArrayExpr(campaignNames),
        match_types_array: sqlVarcharArrayExpr(adMatchTypes),
        asins_array: sqlVarcharArrayExpr(asins),
        product_families_array: sqlVarcharArrayExpr(productFamilies),
        brands_array: sqlVarcharArrayExpr(brands),
        pareto_classes_array: sqlVarcharArrayExpr(paretoClasses),
        revenue_classes_array: sqlVarcharArrayExpr(revenueClasses),

        // Sort (whitelisted column name, safe for interpolation)
        sort_column: sortField,
        sort_direction: sortDirection.toUpperCase(),

        // Group-by flags
        group_by_search_term: groupBy.includes('search_term') ? 1 : 0,
        group_by_campaign_name: groupBy.includes('campaign_name') ? 1 : 0,
        group_by_match_type: groupBy.includes('match_type') ? 1 : 0,
        group_by_product_family: groupBy.includes('product_family') ? 1 : 0,
        group_by_brand: groupBy.includes('brand') ? 1 : 0,
        group_by_pareto_class: groupBy.includes('pareto_abc_class') ? 1 : 0,
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
