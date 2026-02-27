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
        search_terms: z.array(z.string()).max(100).optional(),
        asins: z.array(z.string()).optional(),
        competitor_asins: z.array(z.string()).optional(),
        marketplace: z.array(z.string()).min(1).max(1).optional(),
        category: z.array(z.string()).optional(),
        brand: z.array(z.string()).optional(),
        revenue_abcd_class: z.array(z.enum(['A', 'B', 'C', 'D'])).optional(),
        pareto_abc_class: z.array(z.enum(['A', 'B', 'C'])).optional(),
        product_family: z.array(z.string()).optional(),
        momentum_signal: z.array(z.string()).optional(),
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
      })
      .optional(),
    sort: z
      .object({
        field: z.string().optional(),
        direction: z.enum(['asc', 'desc']).optional(),
      })
      .optional(),
    select_fields: z.array(z.string()).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100).optional(),
  })
  .strict();

type QueryInput = z.infer<typeof querySchema>;

const toolSpecificSchema = z
  .object({
    match_type: z.enum(['exact', 'contains', 'starts_with']).default('exact').optional(),
    weak_leader_detection: z
      .object({
        max_leader_conversion_share: z.coerce.number().min(0).max(1).optional(),
        min_search_volume: z.coerce.number().min(0).optional(),
      })
      .strict()
      .optional(),
    min_click_share: z.coerce.number().min(0).max(1).optional(),
    min_search_volume: z.coerce.number().min(0).optional(),
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

export function registerBrandAnalyticsGetSearchTermMomentumTool(registry: ToolRegistry) {
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
    name: 'brand_analytics_get_search_term_momentum',
    description:
      'Weekly search term momentum from the smart snapshot: click share trends, WoW/4w/12w averages, top-3 competitors, weak leader detection.',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const query = parsed.query as QueryInput;
      const toolSpecific = parsed.tool_specific as ToolSpecific | undefined;

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
      const database = 'brand_analytics_iceberg';

      const searchTerms = (query.filters.search_terms ?? []).map((t) => t.trim()).filter(Boolean);
      const asins = (query.filters.asins ?? []).map((a) => a.trim()).filter(Boolean);
      const competitorAsins = (query.filters.competitor_asins ?? []).map((a) => a.trim()).filter(Boolean);
      const marketplaces = (query.filters.marketplace ?? []).map((m) => m.trim()).filter(Boolean);
      const categories = (query.filters.category ?? []).map((c) => c.trim()).filter(Boolean);
      const brands = (query.filters.brand ?? []).map((b) => b.trim()).filter(Boolean);
      const revenueClass = (query.filters.revenue_abcd_class ?? []).map((c) => c.trim()).filter(Boolean);
      const paretoClass = (query.filters.pareto_abc_class ?? []).map((c) => c.trim()).filter(Boolean);
      const productFamilies = (query.filters.product_family ?? []).map((f) => f.trim()).filter(Boolean);
      const momentumSignals = (query.filters.momentum_signal ?? []).map((m) => m.trim()).filter(Boolean);

      const matchType = toolSpecific?.match_type ?? 'exact';
      const weakLeaderMax = toolSpecific?.weak_leader_detection?.max_leader_conversion_share ?? 0.15;
      const weakLeaderMinVolume = toolSpecific?.weak_leader_detection?.min_search_volume ?? 0;
      const minClickShare = toolSpecific?.min_click_share ?? 0;
      const minSearchVolume = toolSpecific?.min_search_volume ?? 0;

      const SORTABLE_FIELDS = new Set([
        'search_volume', 'my_click_share', 'wow_delta', 'avg_share_l4w',
        'avg_share_l12w', 'displacement_opportunity_score', 'revenue_share',
        'click_share_to_leader', 'leader_conversion_share',
      ]);

      const time = query.aggregation?.time;
      const periodsBack = time?.periods_back ?? 4;
      const limitTopN = query.limit ?? 100;
      const selectFields = query.select_fields;
      const sortField = SORTABLE_FIELDS.has(query.sort?.field ?? '') ? query.sort!.field! : 'search_volume';
      const sortDirection = query.sort?.direction ?? 'desc';

      // ── Render & execute SQL ──────────────────────────────────────────────
      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        catalog,
        limit_top_n: Number(limitTopN),
        start_date_sql: sqlDateExpr(time?.start_date),
        end_date_sql: sqlDateExpr(time?.end_date),
        periods_back: Number(periodsBack),
        company_ids_array: sqlBigintArrayExpr(allowedCompanyIds),
        search_terms_array: sqlVarcharArrayExpr(searchTerms),
        match_type_sql: sqlStringLiteral(matchType),
        asins_array: sqlVarcharArrayExpr(asins),
        competitor_asins_array: sqlVarcharArrayExpr(competitorAsins),
        marketplaces_array: sqlVarcharArrayExpr(marketplaces),
        categories_array: sqlVarcharArrayExpr(categories),
        brands_array: sqlVarcharArrayExpr(brands),
        revenue_abcd_class_array: sqlVarcharArrayExpr(revenueClass),
        pareto_abc_class_array: sqlVarcharArrayExpr(paretoClass),
        product_families_array: sqlVarcharArrayExpr(productFamilies),
        momentum_signals_array: sqlVarcharArrayExpr(momentumSignals),
        weak_leader_max_conversion_share: Number(weakLeaderMax),
        weak_leader_min_search_volume: Number(weakLeaderMinVolume),
        min_click_share: Number(minClickShare),
        min_search_volume: Number(minSearchVolume),

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

      const rows = athenaResult.rows ?? [];
      if (selectFields && selectFields.length > 0) {
        const keep = new Set(selectFields);
        return { items: rows.map((r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).filter(([k]) => keep.has(k)))) };
      }
      return { items: rows };
    },
  });
}
