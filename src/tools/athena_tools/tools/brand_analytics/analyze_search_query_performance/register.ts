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

const querySchema = z
  .object({
    filters: z
      .object({
        company_id: z.array(z.coerce.number().int().min(1)).min(1),
        search_terms: z.array(z.string()).optional(),
        parent_asins: z.array(z.string()).optional(),
        asins: z.array(z.string()).optional(),
        marketplace: z.array(z.string()).min(1).max(1).optional(),
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
      })
      .optional(),
    sort: z
      .object({
        field: z.string().optional(),
        direction: z.enum(['asc', 'desc']).optional(),
      })
      .optional(),
    select_fields: z.array(z.string()).optional(),
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

      const requestedCompanyIds = query.filters.company_id ?? [];
      const allowedCompanyIds = requestedCompanyIds.filter((id) => permittedCompanyIds.includes(id));

      if (permittedCompanyIds.length === 0 || allowedCompanyIds.length === 0) {
        return { items: [] };
      }

      const catalog = config.athena.catalog;
      const database = 'sp_api_iceberg';

      const marketplaces = (query.filters.marketplace ?? []).map((m) => m.trim()).filter(Boolean);
      const searchTerms = (query.filters.search_terms ?? []).map((t) => t.trim()).filter(Boolean);
      const parentAsins = (query.filters.parent_asins ?? []).map((a) => a.trim()).filter(Boolean);
      const asins = (query.filters.asins ?? []).map((a) => a.trim()).filter(Boolean);
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

      const time = query.aggregation?.time;
      const periodsBack = time?.periods_back ?? 12;
      const limitTopN = query.limit ?? 50;
      const selectFields = query.select_fields;

      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        catalog,
        limit_top_n: Number(limitTopN),
        start_date_sql: sqlDateExpr(time?.start_date),
        end_date_sql: sqlDateExpr(time?.end_date),
        periods_back: Number(periodsBack),
        company_ids_array: sqlBigintArrayExpr(allowedCompanyIds),
        marketplaces_array: sqlVarcharArrayExpr(marketplaces),
        search_terms_array: sqlVarcharArrayExpr(searchTerms),
        parent_asins_array: sqlVarcharArrayExpr(parentAsins),
        asins_array: sqlVarcharArrayExpr(asins),
        row_types_array: sqlVarcharArrayExpr(rowTypes),
        revenue_abcd_class_array: sqlVarcharArrayExpr(revenueClass),
        pareto_abc_class_array: sqlVarcharArrayExpr(paretoClass),
        strength_colors_array: sqlVarcharArrayExpr(strengthColors),
        weakness_colors_array: sqlVarcharArrayExpr(weaknessColors),
        opportunity_colors_array: sqlVarcharArrayExpr(opportunityColors),
        threshold_colors_array: sqlVarcharArrayExpr(thresholdColors),
        impression_trend_colors_array: sqlVarcharArrayExpr(impressionTrendColors),
        click_trend_colors_array: sqlVarcharArrayExpr(clickTrendColors),
        cart_add_trend_colors_array: sqlVarcharArrayExpr(cartAddTrendColors),
        purchase_trend_colors_array: sqlVarcharArrayExpr(purchaseTrendColors),
        ctr_advantage_trend_colors_array: sqlVarcharArrayExpr(ctrAdvantageTrendColors),
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
