import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runAthenaQuery } from '../../../../../clients/athena';
import { config } from '../../../../../config';
import type { ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';
import { applySelectFields } from '../select-fields';
import { intentTermsFilterClauseSql, termIntentsCteSql } from '../_intent_common';
import { getPermittedCompanyIds } from '../../../../../lib/permitted-companies';

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
        company_ids: z.array(z.coerce.number().int().min(1)).min(1),
        keywords: z.array(z.string()).optional(),
        intent_ids: z.array(z.string().min(1).max(64)).optional(),
        asin: z.array(z.string()).optional(),
        brand: z.array(z.string()).optional(),
        marketplaces: z.array(z.string()).optional(),
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
        group_by: z
          .array(z.enum(['intent', 'company', 'marketplace', 'keyword', 'week', 'month']))
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
    limit: z.coerce.number().int().min(1).max(200).default(100).optional(),
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

      // ── Permission check – user needs at least ONE of these permissions ──
      const permissions = [
        'view:quicksight_group.sales_and_marketing_new',
        'view:quicksight_group.marketing',
      ];

      const allPermittedCompanyIds = await getPermittedCompanyIds(context.userToken, permissions);

      const permittedCompanyIds = Array.from(allPermittedCompanyIds);

      const requestedCompanyIds = query.filters.company_ids ?? [];
      const allowedCompanyIds = requestedCompanyIds.filter((id) => permittedCompanyIds.includes(id));

      if (permittedCompanyIds.length === 0 || allowedCompanyIds.length === 0) {
        return { items: [] };
      }

      // ── Extract filter values ─────────────────────────────────────────────
      const catalog = config.athena.catalog;
      const database = 'sp_api_iceberg';

      const keywords = (query.filters.keywords ?? []).map((k) => k.trim()).filter(Boolean);
      const intentIds = (query.filters.intent_ids ?? []).map((t) => t.trim()).filter(Boolean);
      const marketplaces = (query.filters.marketplaces ?? []).map((m) => m.trim()).filter(Boolean);
      const asins = (query.filters.asin ?? []).map((a) => a.trim()).filter(Boolean);
      const brands = (query.filters.brand ?? []).map((b) => b.trim()).filter(Boolean);
      const productFamilies = (query.filters.product_family ?? []).map((f) => f.trim()).filter(Boolean);
      const revenueClass = (query.filters.revenue_abcd_class ?? []).map((c) => c.trim()).filter(Boolean);
      const paretoClass = (query.filters.pareto_abc_class ?? []).map((c) => c.trim()).filter(Boolean);

      const matchType = toolSpecific?.match_type ?? 'contains';
      const minSfr = toolSpecific?.min_search_frequency_rank ?? 0;
      const minImpressions = toolSpecific?.min_impressions ?? 0;

      const SORTABLE_FIELDS = new Set([
        'search_query_score', 'search_query_volume', 'total_impressions', 'brand_impression_share',
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
      const selectFields = query.select_fields;
      const sortField = SORTABLE_FIELDS.has(query.sort?.field ?? '') ? query.sort!.field! : 'search_query_volume';
      const sortDirection = query.sort?.direction ?? 'desc';

      // ── Grouped aggregation path ──────────────────────────────────────────
      const groupByDims = query.aggregation?.group_by ?? [];
      const isGrouped = groupByDims.length > 0;
      if (isGrouped) {
        const dimMap: Record<string, { select: string; group: string }> = {
          intent:      { select: 'w.primary_intent_id AS intent_id, w.primary_intent_label AS intent_label', group: 'w.primary_intent_id, w.primary_intent_label' },
          company:     { select: 'w.company_id AS company_id',                  group: 'w.company_id' },
          marketplace: { select: 'w.marketplace_country_code AS marketplace',   group: 'w.marketplace_country_code' },
          keyword:     { select: 'w.keyword AS keyword',                        group: 'w.keyword' },
          week:        { select: "date_trunc('week', w.week_start) AS week",   group: "date_trunc('week', w.week_start)" },
          month:       { select: "date_trunc('month', w.week_start) AS month", group: "date_trunc('month', w.week_start)" },
        };
        const selects: string[] = [];
        const groups: string[] = [];
        for (const dim of groupByDims) {
          const m = dimMap[dim];
          if (!m) throw new Error(`Unsupported group_by dimension: ${dim}`);
          selects.push(m.select);
          groups.push(m.group);
        }

        const groupedTemplate = await loadTextFile(sqlGroupedPath);
        const renderedGrouped = renderSqlTemplate(groupedTemplate, {
          catalog,
          term_intents_cte_sql: termIntentsCteSql(catalog, allowedCompanyIds),
          limit_top_n: Number(limitTopN),
          start_date_sql: sqlDateExpr(time?.start_date),
          end_date_sql: sqlDateExpr(time?.end_date),
          periods_back: Number(periodsBack),
          company_ids_array: sqlBigintArrayExpr(allowedCompanyIds),
          keywords_array: sqlVarcharArrayExpr(keywords),
          intent_terms_filter_sql: intentTermsFilterClauseSql(
            catalog,
            allowedCompanyIds,
            intentIds,
            'r.searchquerydata_searchquery',
          ),
          match_type_sql: sqlStringLiteral(matchType),
          marketplaces_array: sqlVarcharArrayExpr(marketplaces),
          asins_array: sqlVarcharArrayExpr(asins),
          brands_array: sqlVarcharArrayExpr(brands),
          product_families_array: sqlVarcharArrayExpr(productFamilies),
          revenue_abcd_class_array: sqlVarcharArrayExpr(revenueClass),
          pareto_abc_class_array: sqlVarcharArrayExpr(paretoClass),
          min_search_frequency_rank: Number(minSfr),
          min_impressions: Number(minImpressions),
          group_by_select_clause: selects.join(',\n        '),
          group_by_clause: groups.join(', '),
        });

        const athenaGrouped = await runAthenaQuery({
          query: renderedGrouped,
          database,
          workGroup: config.athena.workgroup,
          outputLocation: config.athena.outputLocation,
          maxRows: limitTopN,
        });

        const aggregations = athenaGrouped.rows ?? [];
        return {
          items: [],
          aggregations,
          meta: { group_by: groupByDims, row_count: aggregations.length },
        };
      }

      // ── Render & execute SQL ──────────────────────────────────────────────
      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        catalog,
        term_intents_cte_sql: termIntentsCteSql(catalog, allowedCompanyIds),
        limit_top_n: Number(limitTopN),
        start_date_sql: sqlDateExpr(time?.start_date),
        end_date_sql: sqlDateExpr(time?.end_date),
        periods_back: Number(periodsBack),
        company_ids_array: sqlBigintArrayExpr(allowedCompanyIds),
        keywords_array: sqlVarcharArrayExpr(keywords),
        intent_terms_filter_sql: intentTermsFilterClauseSql(
          catalog,
          allowedCompanyIds,
          intentIds,
          'r.searchquerydata_searchquery',
        ),
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

      const rows = athenaResult.rows ?? [];
      return applySelectFields(rows, selectFields);
    },
  });
}
