import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { neonPanelRequest } from '../../../../../clients/neonpanel-api';
import type { ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';
import { applySelectFields } from '../select-fields';
import {
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

const querySchema = z
  .object({
    filters: z
      .object({
        company_ids: z.array(z.coerce.number().int().min(1)).min(1),
        search_terms: z.array(z.string()).optional(),
        intent_ids: z.array(z.string().min(1).max(64)).optional(),
        parent_asins: z.array(z.string()).optional(),
        asins: z.array(z.string()).optional(),
        product_family: z.array(z.string()).optional(),
        marketplaces: z.array(z.string()).optional(),
        row_type: z.array(z.enum(['child', 'parent'])).optional(),
        revenue_abcd_class: z.array(z.enum(['A', 'B', 'C', 'D'])).optional(),
        pareto_abc_class: z.array(z.enum(['A', 'B', 'C'])).optional(),
        strength_colors: z.array(z.enum(['green', 'yellow', 'red'])).optional(),
        weakness_colors: z.array(z.enum(['green', 'yellow', 'red'])).optional(),
        opportunity_colors: z.array(z.enum(['green', 'yellow', 'red'])).optional(),
        threshold_colors: z.array(z.enum(['green', 'yellow', 'red'])).optional(),
        impression_trend_colors: z.array(z.enum(['green', 'yellow', 'red'])).optional(),
        click_trend_colors: z.array(z.enum(['green', 'yellow', 'red'])).optional(),
        cart_add_trend_colors: z.array(z.enum(['green', 'yellow', 'red'])).optional(),
        purchase_trend_colors: z.array(z.enum(['green', 'yellow', 'red'])).optional(),
        ctr_advantage_trend_colors: z.array(z.enum(['green', 'yellow', 'red'])).optional(),
        diagnostic_scenarios: z.array(z.enum(['A_visibility', 'B_creative', 'C_conversion', 'D_protect', 'insufficient_data'])).optional(),
        term_types: z.array(z.enum(['branded', 'generic', 'long_tail'])).optional(),
        priority_tiers: z.array(z.coerce.number().int().min(1).max(4)).optional(),
      })
      .strict(),
    aggregation: z
      .object({
        time: z
          .object({
            start_date: z.string().optional(),
            end_date: z.string().optional(),
            periods_back: z.coerce.number().int().min(1).max(52).optional(),
          })
          .optional(),
        group_by: z
          .array(
            z.enum([
              'intent',
              'company',
              'marketplace',
              'brand',
              'parent_asin',
              'asin',
              'product_family',
              'search_term',
              'week',
              'month',
            ]),
          )
          .max(3)
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
    ryg_company_id: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
  })
  .strict();

type QueryInput = z.infer<typeof querySchema>;

const inputSchema = z
  .object({
    query: querySchema,
  })
  .strict();

export function registerBrandAnalyticsAnalyzeSearchQueryPerformanceTool(registry: ToolRegistry) {
  const toolJsonPath = path.join(__dirname, 'tool.json');
  const sqlPath = path.join(__dirname, 'query.sql');
  const sqlGroupedPath = path.join(__dirname, 'query_grouped.sql');

  let specJson: ToolSpecJson | undefined;
  try {
    if (fs.existsSync(toolJsonPath)) {
      specJson = JSON.parse(fs.readFileSync(toolJsonPath, 'utf8')) as ToolSpecJson;
    }
  } catch {
    specJson = undefined;
  }

  registry.register({
    name: specJson?.name ?? 'brand_analytics_analyze_search_query_performance',
    description:
      specJson?.description ??
      'Analyzes Search Query Performance (SQP) snapshot with KPI metrics, deltas, and RYG signals.',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const query = parsed.query as QueryInput;

      // Permission check – user needs at least ONE of these permissions
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
            (c): c is { company_id?: number; companyId?: number; id?: number } => c !== null && typeof c === 'object',
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
      const allowedCompanyIds = requestedCompanyIds.filter((id: number) => permittedCompanyIds.includes(id));

      if (permittedCompanyIds.length === 0 || allowedCompanyIds.length === 0) {
        return { items: [] };
      }

      const marketplaces = (query.filters.marketplaces ?? []).map((m) => m.trim()).filter(Boolean);
      const searchTerms = (query.filters.search_terms ?? []).map((t) => t.trim()).filter(Boolean);
      const intentIds = (query.filters.intent_ids ?? []).map((t) => t.trim()).filter(Boolean);
      const parentAsins = (query.filters.parent_asins ?? []).map((a) => a.trim()).filter(Boolean);
      const asins = (query.filters.asins ?? []).map((a) => a.trim()).filter(Boolean);
      const productFamilies = (query.filters.product_family ?? []).map((f) => f.trim()).filter(Boolean);
      const rowTypes = (query.filters.row_type ?? []).map((r) => r.trim()).filter(Boolean);
      const revenueClass = (query.filters.revenue_abcd_class ?? []).map((c) => c.trim()).filter(Boolean);
      const paretoClass = (query.filters.pareto_abc_class ?? []).map((c) => c.trim()).filter(Boolean);
      const strengthColors = (query.filters.strength_colors ?? []).map((c) => c.trim()).filter(Boolean);
      const weaknessColors = (query.filters.weakness_colors ?? []).map((c) => c.trim()).filter(Boolean);
      const opportunityColors = (query.filters.opportunity_colors ?? []).map((c) => c.trim()).filter(Boolean);
      const thresholdColors = (query.filters.threshold_colors ?? []).map((c) => c.trim()).filter(Boolean);
      const impressionTrendColors = (query.filters.impression_trend_colors ?? []).map((c) => c.trim()).filter(Boolean);
      const clickTrendColors = (query.filters.click_trend_colors ?? []).map((c) => c.trim()).filter(Boolean);
      const cartAddTrendColors = (query.filters.cart_add_trend_colors ?? []).map((c) => c.trim()).filter(Boolean);
      const purchaseTrendColors = (query.filters.purchase_trend_colors ?? []).map((c) => c.trim()).filter(Boolean);
      const ctrAdvantageTrendColors = (query.filters.ctr_advantage_trend_colors ?? []).map((c) => c.trim()).filter(Boolean);
      const diagnosticScenarios = (query.filters.diagnostic_scenarios ?? []).map((s) => s.trim()).filter(Boolean);
      const termTypes = (query.filters.term_types ?? []).map((t) => t.trim()).filter(Boolean);
      const priorityTiers = (query.filters.priority_tiers ?? []).map((t) => String(t)).filter(Boolean);

      const time = query.aggregation?.time;
      const periodsBack = time?.periods_back ?? 12;
      const limitTopN = query.limit ?? 50;
      const selectFields = query.select_fields;
      const rygCompanyId = query.ryg_company_id ?? allowedCompanyIds[0];

      const groupByDims = query.aggregation?.group_by ?? [];
      const isGrouped = groupByDims.length > 0;

      // ─── Grouped aggregation path ──────────────────────────────────────────
      if (isGrouped) {
        const dimMap: Record<string, { select: string; group: string }> = {
          intent:          { select: 'w.primary_intent_id AS intent_id, w.primary_intent_label AS intent_label', group: 'w.primary_intent_id, w.primary_intent_label' },
          company:         { select: 'w.company_id AS company_id, MAX(w.company) AS company',                    group: 'w.company_id' },
          marketplace:     { select: 'w.marketplace_country_code AS marketplace',                                group: 'w.marketplace_country_code' },
          brand:           { select: 'w.brand AS brand',                                                          group: 'w.brand' },
          parent_asin:     { select: 'w.parent_asin AS parent_asin',                                              group: 'w.parent_asin' },
          asin:            { select: 'w.asin AS asin',                                                            group: 'w.asin' },
          product_family:  { select: 'w.product_family AS product_family',                                        group: 'w.product_family' },
          search_term:     { select: 'w.searchquerydata_searchquery AS search_term',                              group: 'w.searchquerydata_searchquery' },
          // Brand Analytics weeks are Sunday-aligned, hence toStartOfWeek(..., 0).
          week:            { select: 'toStartOfWeek(w.week_start, 0) AS week',                                    group: 'toStartOfWeek(w.week_start, 0)' },
          month:           { select: 'toStartOfMonth(w.week_start) AS month',                                     group: 'toStartOfMonth(w.week_start)' },
        };
        const selects: string[] = [];
        const groups: string[] = [];
        for (const dim of groupByDims) {
          const m = dimMap[dim];
          if (!m) {
            throw new Error(`Unsupported group_by dimension: ${dim}`);
          }
          selects.push(m.select);
          groups.push(m.group);
        }

        const groupedTemplate = await loadTextFile(sqlGroupedPath);
        const renderedGrouped = renderSqlTemplate(groupedTemplate, {
          limit_top_n: Number(limitTopN),
          start_date_sql: sqlNullableDateExpr(time?.start_date),
          end_date_sql: sqlNullableDateExpr(time?.end_date),
          periods_back: Number(periodsBack),
          company_ids_array: sqlUInt64ArrayExpr(allowedCompanyIds),
          marketplaces_array: sqlStringArrayExpr(marketplaces),
          search_terms_array: sqlStringArrayExpr(searchTerms),
          term_intents_cte_sql: termIntentsCteSql(allowedCompanyIds),
          intent_terms_filter_sql: intentTermsFilterClauseSql(
            allowedCompanyIds,
            intentIds,
            'sqp.search_query',
          ),
          parent_asins_array: sqlStringArrayExpr(parentAsins),
          asins_array: sqlStringArrayExpr(asins),
          product_families_array: sqlStringArrayExpr(productFamilies),
          row_types_array: sqlStringArrayExpr(rowTypes),
          revenue_abcd_class_array: sqlStringArrayExpr(revenueClass),
          pareto_abc_class_array: sqlStringArrayExpr(paretoClass),
          group_by_select_clause: selects.join(',\n        '),
          group_by_clause: groups.join(', '),
        });

        const groupedResult = await executeBrandAnalyticsQuery(renderedGrouped);
        const aggregations = groupedResult.rows ?? [];
        return {
          items: [],
          aggregations,
          meta: { group_by: groupByDims, row_count: aggregations.length },
        };
      }

      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        ryg_company_id: Number(rygCompanyId),
        limit_top_n: Number(limitTopN),
        start_date_sql: sqlNullableDateExpr(time?.start_date),
        end_date_sql: sqlNullableDateExpr(time?.end_date),
        periods_back: Number(periodsBack),
        company_ids_array: sqlUInt64ArrayExpr(allowedCompanyIds),
        marketplaces_array: sqlStringArrayExpr(marketplaces),
        search_terms_array: sqlStringArrayExpr(searchTerms),
        term_intents_cte_sql: termIntentsCteSql(allowedCompanyIds),
        intent_terms_filter_sql: intentTermsFilterClauseSql(
          allowedCompanyIds,
          intentIds,
          'sqp.search_query',
        ),
        parent_asins_array: sqlStringArrayExpr(parentAsins),
        asins_array: sqlStringArrayExpr(asins),
        product_families_array: sqlStringArrayExpr(productFamilies),
        row_types_array: sqlStringArrayExpr(rowTypes),
        revenue_abcd_class_array: sqlStringArrayExpr(revenueClass),
        pareto_abc_class_array: sqlStringArrayExpr(paretoClass),
        strength_colors_array: sqlStringArrayExpr(strengthColors),
        weakness_colors_array: sqlStringArrayExpr(weaknessColors),
        opportunity_colors_array: sqlStringArrayExpr(opportunityColors),
        threshold_colors_array: sqlStringArrayExpr(thresholdColors),
        impression_trend_colors_array: sqlStringArrayExpr(impressionTrendColors),
        click_trend_colors_array: sqlStringArrayExpr(clickTrendColors),
        cart_add_trend_colors_array: sqlStringArrayExpr(cartAddTrendColors),
        purchase_trend_colors_array: sqlStringArrayExpr(purchaseTrendColors),
        ctr_advantage_trend_colors_array: sqlStringArrayExpr(ctrAdvantageTrendColors),
        diagnostic_scenarios_array: sqlStringArrayExpr(diagnosticScenarios),
        term_types_array: sqlStringArrayExpr(termTypes),
        priority_tiers_array: sqlStringArrayExpr(priorityTiers),
      });

      const result = await executeBrandAnalyticsQuery(rendered);
      const rows = result.rows ?? [];
      return applySelectFields(rows, selectFields);
    },
  });
}
