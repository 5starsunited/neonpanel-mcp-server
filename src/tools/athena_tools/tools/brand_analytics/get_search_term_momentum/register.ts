import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { neonPanelRequest } from '../../../../../clients/neonpanel-api';
import type { ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';
import { applySelectFields } from '../select-fields';
import {
  allowListedSql,
  asinClassCteSql,
  asinClassJoinSql,
  executeBrandAnalyticsQuery,
  intentTermsFilterClauseSql,
  sqlNullableDateExpr,
  sqlStringArrayExpr,
  sqlUInt64ArrayExpr,
  termIntentsCteSql,
} from '../_clickhouse';

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

// ── Schemas ────────────────────────────────────────────────────────────────────

// `category` is intentionally absent: it was the Amazon department of the
// leading competitor ASIN, which the ClickHouse contract does not carry. See
// the header of query.sql.
const groupBySchema = z.enum(['intent', 'search_term', 'marketplace', 'company', 'brand', 'product_family', 'asin']);

const querySchema = z
  .object({
    filters: z
      .object({
        company_ids: z.array(z.coerce.number().int().min(1)).min(1),
        search_terms: z.array(z.string()).optional(),
        intent_ids: z.array(z.string().min(1).max(64)).optional(),
        asins: z.array(z.string()).optional(),
        competitor_asins: z.array(z.string()).optional(),
        marketplaces: z.array(z.string()).optional(),
        brand: z.array(z.string()).optional(),
        revenue_abcd_class: z.array(z.enum(['A', 'B', 'C', 'D'])).optional(),
        pareto_abc_class: z.array(z.enum(['A', 'B', 'C'])).optional(),
        product_family: z.array(z.string()).optional(),
        momentum_signal: z.array(z.string()).optional(),
      })
      .strict(),
    aggregation: z
      .object({
        group_by: z.array(groupBySchema).optional().default([]),
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
type GroupByField = z.infer<typeof groupBySchema>;

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

type DimensionConfig = { expression: string; alias: string };

const dimensionMap: Record<GroupByField, DimensionConfig> = {
  intent: { expression: "ifNull(aw.primary_intent_id, '__UNCLASSIFIED__')", alias: 'intent_id' },
  search_term: { expression: 'aw.search_term', alias: 'search_term' },
  marketplace: { expression: 'aw.marketplace', alias: 'marketplace' },
  company: { expression: 'aw.company_id', alias: 'company_id' },
  brand: { expression: "ifNull(aw.my_brand, '__UNKNOWN__')", alias: 'my_brand' },
  product_family: { expression: "ifNull(aw.product_family, '__UNKNOWN__')", alias: 'product_family' },
  asin: { expression: 'aw.asin', alias: 'asin' },
};

function buildDimensionClauses(groupBy: GroupByField[]) {
  const uniqueGroupBy = [...new Set(groupBy)];
  const dimensions = uniqueGroupBy.map((dimension) => dimensionMap[dimension]);

  return {
    uniqueGroupBy,
    groupBySelectClause: dimensions.map((d) => `${d.expression} AS ${d.alias}`).join(',\n        '),
    finalGroupBySelectClause: dimensions.map((d) => `c.${d.alias} AS ${d.alias}`).join(',\n        '),
    groupByClause: dimensions.map((d) => d.expression).join(', '),
    partitionByClause: dimensions.map((d) => d.alias).join(', '),
  };
}

/**
 * match_type picks between three ClickHouse predicates instead of being
 * interpolated as a value, so the mode itself never reaches the SQL text.
 */
function searchTermMatchSql(matchType: string | undefined, arrayExpr: string): string {
  const column = 'sqp.search_query';
  return allowListedSql<'exact' | 'starts_with' | 'contains'>(
    matchType,
    {
      exact: `arrayExists(term -> lower(term) = lower(${column}), ${arrayExpr})`,
      starts_with: `arrayExists(term -> startsWith(lower(${column}), lower(term)), ${arrayExpr})`,
      contains: `arrayExists(term -> position(lower(${column}), lower(term)) > 0, ${arrayExpr})`,
    },
    'exact',
  );
}

// ── Registration ───────────────────────────────────────────────────────────────

export function registerBrandAnalyticsGetSearchTermMomentumTool(registry: ToolRegistry) {
  const toolJsonPath = path.join(__dirname, 'tool.json');

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
      'Weekly search term momentum: click share trends, WoW/4w/12w averages, top-3 competitors, weak leader detection.',
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

      const requestedCompanyIds = query.filters.company_ids ?? [];
      const allowedCompanyIds = requestedCompanyIds.filter((id) => permittedCompanyIds.includes(id));

      if (permittedCompanyIds.length === 0 || allowedCompanyIds.length === 0) {
        return { items: [] };
      }

      // ── Extract filter values ─────────────────────────────────────────────
      const searchTerms = (query.filters.search_terms ?? []).map((t) => t.trim()).filter(Boolean);
      const intentIds = (query.filters.intent_ids ?? []).map((t) => t.trim()).filter(Boolean);
      const asins = (query.filters.asins ?? []).map((a) => a.trim()).filter(Boolean);
      const competitorAsins = (query.filters.competitor_asins ?? []).map((a) => a.trim()).filter(Boolean);
      const marketplaces = (query.filters.marketplaces ?? []).map((m) => m.trim()).filter(Boolean);
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

      const groupBy = query.aggregation?.group_by ?? [];
      const groupClauses = buildDimensionClauses(groupBy);
      const isGrouped = groupClauses.uniqueGroupBy.length > 0;

      const DETAIL_SORTABLE_FIELDS = new Set([
        'search_volume', 'my_click_share', 'wow_delta', 'avg_share_l4w',
        'avg_share_l12w', 'displacement_opportunity_score', 'revenue_share',
        'click_share_to_leader', 'leader_conversion_share',
      ]);

      const GROUPED_SORTABLE_FIELDS = new Set([
        'search_volume', 'portfolio_click_share', 'my_click_share', 'wow_delta', 'avg_share_l4w',
        'avg_share_l12w', 'asin_count', 'avg_asin_click_share', 'max_asin_click_share',
        'total_revenue_share', 'displacement_opportunity_score', 'leader_conversion_share',
        'click_share_to_leader',
      ]);

      const time = query.aggregation?.time;
      const periodsBack = time?.periods_back ?? 4;
      const limitTopN = query.limit ?? 100;
      const selectFields = query.select_fields;
      const sortableFields = isGrouped ? GROUPED_SORTABLE_FIELDS : DETAIL_SORTABLE_FIELDS;
      const sortField = sortableFields.has(query.sort?.field ?? '') ? query.sort!.field! : 'search_volume';
      const sortDirection = query.sort?.direction ?? 'desc';

      // ── Render & execute SQL ──────────────────────────────────────────────
      const searchTermsArray = sqlStringArrayExpr(searchTerms);
      const sqlPath = path.join(__dirname, isGrouped ? 'query_grouped.sql' : 'query.sql');
      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        asin_class_cte_sql: asinClassCteSql(allowedCompanyIds),
        asin_class_join_sql: asinClassJoinSql('sqp'),
        term_intents_cte_sql: termIntentsCteSql(allowedCompanyIds),
        limit_top_n: Number(limitTopN),
        // Cap on the number of terms carried into the window functions.
        top_terms_limit: Math.max(limitTopN * 10, 2000),
        start_date_sql: sqlNullableDateExpr(time?.start_date),
        end_date_sql: sqlNullableDateExpr(time?.end_date),
        periods_back: Number(periodsBack),
        company_ids_array: sqlUInt64ArrayExpr(allowedCompanyIds),
        search_terms_array: searchTermsArray,
        search_term_match_sql: searchTermMatchSql(matchType, searchTermsArray),
        intent_terms_filter_sql: intentTermsFilterClauseSql(
          allowedCompanyIds,
          intentIds,
          'sqp.search_query',
        ),
        asins_array: sqlStringArrayExpr(asins),
        competitor_asins_array: sqlStringArrayExpr(competitorAsins),
        marketplaces_array: sqlStringArrayExpr(marketplaces),
        brands_array: sqlStringArrayExpr(brands),
        revenue_abcd_class_array: sqlStringArrayExpr(revenueClass),
        pareto_abc_class_array: sqlStringArrayExpr(paretoClass),
        product_families_array: sqlStringArrayExpr(productFamilies),
        momentum_signals_array: sqlStringArrayExpr(momentumSignals),
        weak_leader_max_conversion_share: Number(weakLeaderMax),
        weak_leader_min_search_volume: Number(weakLeaderMinVolume),
        min_click_share: Number(minClickShare),
        min_search_volume: Number(minSearchVolume),
        group_by_select_clause: groupClauses.groupBySelectClause,
        final_group_by_select_clause: groupClauses.finalGroupBySelectClause,
        group_by_clause: groupClauses.groupByClause,
        partition_by_clause: groupClauses.partitionByClause,

        // Sort (whitelisted column name, safe for interpolation)
        sort_column: sortField,
        sort_direction: sortDirection.toUpperCase(),
      });

      const result = await executeBrandAnalyticsQuery(rendered);
      const rows = result.rows ?? [];
      return applySelectFields(rows, selectFields);
    },
  });
}
