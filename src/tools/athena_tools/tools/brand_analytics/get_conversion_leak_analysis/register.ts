import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { neonPanelRequest } from '../../../../../clients/neonpanel-api';
import type { ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';
import {
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
  }>;
};

const querySchema = z
  .object({
    filters: z
      .object({
        company_ids: z.array(z.coerce.number().int().min(1)).min(1),
        asin: z.array(z.string()).max(20).optional(),
        parent_asin: z.array(z.string()).max(10).optional(),
        brand: z.array(z.string()).optional(),
        marketplaces: z.array(z.string()).min(1),
        revenue_abcd_class: z.array(z.enum(['A', 'B', 'C', 'D'])).optional(),
        pareto_abc_class: z.array(z.enum(['A', 'B', 'C'])).optional(),
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
    limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
  })
  .strict();

type QueryInput = z.infer<typeof querySchema>;

const toolSpecificSchema = z
  .object({
    leak_thresholds: z
      .object({
        impression_to_click_min: z.number().min(0).max(1).default(0.02).optional(),
        click_to_cart_min: z.number().min(0).max(1).default(0.15).optional(),
        cart_to_purchase_min: z.number().min(0).max(1).default(0.40).optional(),
      })
      .strict()
      .optional(),
    include_diagnostic_hints: z.boolean().default(true).optional(),
  })
  .strict();

type ToolSpecific = z.infer<typeof toolSpecificSchema>;

const inputSchema = z
  .object({
    query: querySchema,
    tool_specific: toolSpecificSchema.optional(),
  })
  .strict();

const SORTABLE_FIELDS = new Set([
  'brand_impressions',
  'brand_clicks',
  'brand_cart_adds',
  'brand_purchases',
  'brand_impression_to_click_rate',
  'brand_click_to_cart_rate',
  'brand_cart_to_purchase_rate',
  'brand_overall_conversion_rate',
  'click_through_efficiency',
  'conversion_efficiency',
  'total_leak_score',
  'impression_to_click_severity',
  'click_to_cart_severity',
  'cart_to_purchase_severity',
  'keyword_count',
]);

export function registerBrandAnalyticsGetConversionLeakAnalysisTool(registry: ToolRegistry) {
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
    name: 'brand_analytics_get_conversion_leak_analysis',
    description:
      'ASIN-level funnel diagnostics identifying where buyers drop off between discovery and purchase. Returns funnel rates, leak severity scores, diagnostic scenarios (A/B/C/D), and actionable hints.',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const query = parsed.query as QueryInput;
      const toolSpecific = parsed.tool_specific as ToolSpecific | undefined;

      // Permission check
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
      const allowedCompanyIds = requestedCompanyIds.filter((id: number) => permittedCompanyIds.includes(id));

      if (permittedCompanyIds.length === 0 || allowedCompanyIds.length === 0) {
        return { items: [] };
      }

      const marketplaces = query.filters.marketplaces.map((m: string) => m.trim()).filter(Boolean);
      const asins = (query.filters.asin ?? []).map((a) => a.trim()).filter(Boolean);
      const parentAsins = (query.filters.parent_asin ?? []).map((a) => a.trim()).filter(Boolean);
      const brands = (query.filters.brand ?? []).map((b) => b.trim()).filter(Boolean);
      const revenueClass = (query.filters.revenue_abcd_class ?? []).map((c) => c.trim()).filter(Boolean);
      const paretoClass = (query.filters.pareto_abc_class ?? []).map((c) => c.trim()).filter(Boolean);

      const leakThresholds = toolSpecific?.leak_thresholds;
      const impressionToClickMin = leakThresholds?.impression_to_click_min ?? 0.02;
      const clickToCartMin = leakThresholds?.click_to_cart_min ?? 0.15;
      const cartToPurchaseMin = leakThresholds?.cart_to_purchase_min ?? 0.40;

      const time = query.aggregation?.time;
      const periodsBack = time?.periods_back ?? 4;
      const limitTopN = query.limit ?? 50;
      const selectFields = query.select_fields;

      // Sort
      const sortField = query.sort?.field ?? 'total_leak_score';
      const sortDirection = query.sort?.direction ?? 'desc';
      const sortColumn = SORTABLE_FIELDS.has(sortField) ? sortField : 'total_leak_score';

      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        limit_top_n: Number(limitTopN),
        start_date_sql: sqlNullableDateExpr(time?.start_date),
        end_date_sql: sqlNullableDateExpr(time?.end_date),
        periods_back: Number(periodsBack),
        company_ids_array: sqlUInt64ArrayExpr(allowedCompanyIds),
        marketplaces_array: sqlStringArrayExpr(marketplaces),
        asins_array: sqlStringArrayExpr(asins),
        parent_asins_array: sqlStringArrayExpr(parentAsins),
        brands_array: sqlStringArrayExpr(brands),
        revenue_abcd_class_array: sqlStringArrayExpr(revenueClass),
        pareto_abc_class_array: sqlStringArrayExpr(paretoClass),
        impression_to_click_min: Number(impressionToClickMin),
        click_to_cart_min: Number(clickToCartMin),
        cart_to_purchase_min: Number(cartToPurchaseMin),
        sort_column: sortColumn,
        sort_direction: sortDirection.toUpperCase(),
      });

      const result = await executeBrandAnalyticsQuery(rendered);
      return applySelectFields(result.rows ?? [], selectFields);
    },
  });
}
