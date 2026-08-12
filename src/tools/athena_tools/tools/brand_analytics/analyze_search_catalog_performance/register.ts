import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { neonPanelRequest } from '../../../../../clients/neonpanel-api';
import type { ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';
import {
  asinClassCteSql,
  asinClassJoinSql,
  executeBrandAnalyticsQuery,
  sqlNullableDateExpr,
  sqlStringArrayExpr,
  sqlUInt64ArrayExpr,
} from '../_clickhouse';
import { applySelectFields } from '../select-fields';

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
        asins: z.array(z.string()).optional(),
        parent_asins: z.array(z.string()).optional(),
        product_family: z.array(z.string()).optional(),
        marketplaces: z.array(z.string()).optional(),
        row_type: z.array(z.enum(['child', 'parent'])).optional(),
        revenue_abcd_class: z.array(z.enum(['A', 'B', 'C', 'D'])).optional(),
        pareto_abc_class: z.array(z.enum(['A', 'B', 'C'])).optional(),
        strength_colors: z.array(z.enum(['green', 'yellow', 'red'])).optional(),
        weakness_colors: z.array(z.enum(['green', 'yellow', 'red'])).optional(),
        opportunity_colors: z.array(z.enum(['green', 'yellow', 'red'])).optional(),
        threshold_colors: z.array(z.enum(['green', 'yellow', 'red'])).optional(),
        click_trend_colors: z.array(z.enum(['green', 'yellow', 'red'])).optional(),
        cart_add_trend_colors: z.array(z.enum(['green', 'yellow', 'red'])).optional(),
        purchase_trend_colors: z.array(z.enum(['green', 'yellow', 'red'])).optional(),
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

export function registerBrandAnalyticsAnalyzeSearchCatalogPerformanceTool(registry: ToolRegistry) {
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
    name: specJson?.name ?? 'brand_analytics_analyze_search_catalog_performance',
    description:
      specJson?.description ??
      'Analyzes Search Catalog Performance snapshot with KPI metrics, deltas, and RYG signals.',
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
      const clickTrendColors = (query.filters.click_trend_colors ?? []).map((c) => c.trim()).filter(Boolean);
      const cartAddTrendColors = (query.filters.cart_add_trend_colors ?? []).map((c) => c.trim()).filter(Boolean);
      const purchaseTrendColors = (query.filters.purchase_trend_colors ?? []).map((c) => c.trim()).filter(Boolean);

      const time = query.aggregation?.time;
      const periodsBack = time?.periods_back ?? 12;
      const limitTopN = query.limit ?? 50;
      const selectFields = query.select_fields;
      const rygCompanyId = query.ryg_company_id ?? allowedCompanyIds[0];

      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        asin_class_cte_sql: asinClassCteSql(allowedCompanyIds),
        asin_class_join_sql: asinClassJoinSql('scp'),
        ryg_company_id: Number(rygCompanyId),
        limit_top_n: Number(limitTopN),
        start_date_sql: sqlNullableDateExpr(time?.start_date),
        end_date_sql: sqlNullableDateExpr(time?.end_date),
        periods_back: Number(periodsBack),
        company_ids_array: sqlUInt64ArrayExpr(allowedCompanyIds),
        marketplaces_array: sqlStringArrayExpr(marketplaces),
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
        click_trend_colors_array: sqlStringArrayExpr(clickTrendColors),
        cart_add_trend_colors_array: sqlStringArrayExpr(cartAddTrendColors),
        purchase_trend_colors_array: sqlStringArrayExpr(purchaseTrendColors),
      });

      const result = await executeBrandAnalyticsQuery(rendered);
      const rows = result.rows ?? [];
      return applySelectFields(rows, selectFields);
    },
  });
}
