import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runClickHouseQuery } from '../../../../../clients/clickhouse';
import { neonPanelRequest } from '../../../../../clients/neonpanel-api';
import type { ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';
import { logger } from '../../../../../logging/logger';

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

// ClickHouse string-literal escaping (backslash escapes, per CH dialect).
function sqlEscapeString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function sqlStringLiteral(value: string): string {
  return `'${sqlEscapeString(value)}'`;
}

// ClickHouse array literals; empty arrays need an explicit element type.
function chStringArrayExpr(values: string[]): string {
  if (values.length === 0) return 'CAST([] AS Array(String))';
  return `[${values.map(sqlStringLiteral).join(',')}]`;
}

function chUInt64ArrayExpr(values: number[]): string {
  if (values.length === 0) return 'CAST([] AS Array(UInt64))';
  return `CAST([${values.map((n) => String(Math.trunc(n))).join(',')}] AS Array(UInt64))`;
}

// ClickHouse Date literal or a typed NULL when absent.
function chDateOrNull(value?: string): string {
  const trimmed = value?.trim();
  if (trimmed && /^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `toDate(${sqlStringLiteral(trimmed)})`;
  }
  return 'CAST(NULL AS Nullable(Date))';
}

// ── Schemas ────────────────────────────────────────────────────────────────────

const GROUP_BY_OPTIONS = [
  'campaign_name',
  'ad_group_name',
  'placement',
  'match_type',
  'dataset',
  'target_keyword',
  'advertised_asin',
  'product_family',
  'brand',
  'company',
  'marketplace',
] as const;

const SORTABLE_FIELDS = [
  'impressions',
  'clicks',
  'cost_usd',
  'attributed_sales_usd',
  'conversions',
  'attributed_units_ordered',
  'cpc_usd',
  'ctr_pct',
  'cvr_pct',
  'acos_pct',
  'roas',
  'days_active',
  'asin_count',
] as const;

const PERIODICITY_OPTIONS = ['day', 'month', 'year', 'total'] as const;
type Periodicity = (typeof PERIODICITY_OPTIONS)[number];

// ClickHouse period-bucket expression over the business date (report_date).
// 'total' collapses to a single NULL bucket (no time breakdown).
const PERIOD_EXPR: Record<Periodicity, string> = {
  day: 'toString(w.report_date)',
  month: "formatDateTime(w.report_date, '%Y-%m')",
  year: 'toString(toYear(w.report_date))',
  total: 'CAST(NULL AS Nullable(String))',
};

const querySchema = z
  .object({
    filters: z
      .object({
        company_id: z.coerce.number().int().min(1),
        campaign_types: z
          .array(z.enum(['sponsored_products', 'sponsored_brands', 'sponsored_display']))
          .optional(),
        marketplace: z.array(z.string()).min(1).max(1).optional(),
        campaign_names: z.array(z.string()).optional(),
        ad_group_names: z.array(z.string()).optional(),
        target_keywords: z.array(z.string()).optional(),
        keyword_match_type: z
          .enum(['exact', 'contains', 'starts_with'])
          .default('contains')
          .optional(),
        placements: z
          .array(
            z.enum([
              'Top of Search on-Amazon',
              'Detail Page on-Amazon',
              'Other on-Amazon',
              'Off Amazon',
            ]),
          )
          .optional(),
        match_types: z.array(z.string()).optional(),
        asins: z.array(z.string()).optional(),
        product_families: z.array(z.string()).optional(),
        brands: z.array(z.string()).optional(),
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
        periodicity: z.enum(PERIODICITY_OPTIONS).default('total').optional(),
        group_by: z
          .array(z.enum(GROUP_BY_OPTIONS))
          .default(['campaign_name'])
          .optional(),
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

export function registerAdvertisingAnalyzeCampaignPerformanceTool(registry: ToolRegistry) {
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
    name: 'advertising_analyze_campaign_performance',
    description:
      'Analyzes Amazon Advertising campaign performance (SP/SB/SD) enriched with SKU attributes (brand, product family), served from the ClickHouse warehouse (sub-second). Supports campaign, placement, ad-type and time-period analysis.',
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

      const permStart = Date.now();
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

      const permissionMs = Date.now() - permStart;

      const permittedCompanyIds = Array.from(allPermittedCompanyIds);

      const requestedCompanyIds = [Math.trunc(query.filters.company_id)];
      const allowedCompanyIds = requestedCompanyIds.filter((id) =>
        permittedCompanyIds.includes(id),
      );

      if (permittedCompanyIds.length === 0 || allowedCompanyIds.length === 0) {
        return { items: [] };
      }

      // ── Extract filter values ─────────────────────────────────────────────
      const campaignTypes = (query.filters.campaign_types ?? [])
        .map((s) => s.trim())
        .filter(Boolean);
      const marketplaces = (query.filters.marketplace ?? [])
        .map((m) => m.trim())
        .filter(Boolean);
      const campaignNames = (query.filters.campaign_names ?? [])
        .map((c) => c.trim())
        .filter(Boolean);
      const adGroupNames = (query.filters.ad_group_names ?? [])
        .map((a) => a.trim())
        .filter(Boolean);
      const targetKeywords = (query.filters.target_keywords ?? [])
        .map((t) => t.trim())
        .filter(Boolean);
      const keywordMatchType = query.filters.keyword_match_type ?? 'contains';
      const placements = (query.filters.placements ?? [])
        .map((p) => p.trim())
        .filter(Boolean);
      const matchTypes = (query.filters.match_types ?? [])
        .map((m) => m.trim())
        .filter(Boolean);
      const asins = (query.filters.asins ?? []).map((a) => a.trim()).filter(Boolean);
      const productFamilies = (query.filters.product_families ?? [])
        .map((p) => p.trim())
        .filter(Boolean);
      const brands = (query.filters.brands ?? []).map((b) => b.trim()).filter(Boolean);

      const groupBy = query.aggregation?.group_by ?? ['campaign_name'];
      const periodicity: Periodicity = query.aggregation?.periodicity ?? 'total';
      const periodExpr = PERIOD_EXPR[periodicity];
      const sortField = query.sort?.field ?? 'cost_usd';
      const sortDirection = query.sort?.direction ?? 'desc';
      const time = query.aggregation?.time;
      const periodsBack = time?.periods_back ?? 4;
      const limitTopN = query.limit ?? 100;

      // ── Render & execute SQL ──────────────────────────────────────────────
      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        limit_top_n: Number(limitTopN),
        start_date_sql: chDateOrNull(time?.start_date),
        end_date_sql: chDateOrNull(time?.end_date),
        periods_back: Number(periodsBack),
        company_ids_array: chUInt64ArrayExpr(allowedCompanyIds),

        // Filter arrays
        campaign_types_array: chStringArrayExpr(campaignTypes),
        marketplaces_array: chStringArrayExpr(marketplaces),
        campaign_names_array: chStringArrayExpr(campaignNames),
        ad_group_names_array: chStringArrayExpr(adGroupNames),
        target_keywords_array: chStringArrayExpr(targetKeywords),
        keyword_match_type_sql: sqlStringLiteral(keywordMatchType),
        placements_array: chStringArrayExpr(placements),
        match_types_array: chStringArrayExpr(matchTypes),
        asins_array: chStringArrayExpr(asins),
        product_families_array: chStringArrayExpr(productFamilies),
        brands_array: chStringArrayExpr(brands),

        // Periodicity
        period_expr: periodExpr,

        // Sort (whitelisted column name, safe for interpolation)
        sort_column: sortField,
        sort_direction: sortDirection.toUpperCase(),

        // Group-by flags
        group_by_campaign_name: groupBy.includes('campaign_name') ? 1 : 0,
        group_by_ad_group_name: groupBy.includes('ad_group_name') ? 1 : 0,
        group_by_placement: groupBy.includes('placement') ? 1 : 0,
        group_by_match_type: groupBy.includes('match_type') ? 1 : 0,
        group_by_dataset: groupBy.includes('dataset') ? 1 : 0,
        group_by_target_keyword: groupBy.includes('target_keyword') ? 1 : 0,
        group_by_advertised_asin: groupBy.includes('advertised_asin') ? 1 : 0,
        group_by_product_family: groupBy.includes('product_family') ? 1 : 0,
        group_by_brand: groupBy.includes('brand') ? 1 : 0,
        group_by_company: groupBy.includes('company') ? 1 : 0,
        group_by_marketplace: groupBy.includes('marketplace') ? 1 : 0,
      });

      const queryStart = Date.now();
      const result = await runClickHouseQuery({ query: rendered });
      const queryMs = Date.now() - queryStart;

      logger.info(
        {
          tool: 'advertising_analyze_campaign_performance',
          permissionMs,
          queryMs,
          rows: result.rows?.length ?? 0,
        },
        'ch tool phase timing',
      );

      return { items: result.rows ?? [] };
    },
  });
}
