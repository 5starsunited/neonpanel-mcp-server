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

function sqlCompanyIdArrayExpr(values: number[]): string {
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
        company_id: z.coerce.number().int().min(1),
        search_terms: z.array(z.string()).min(1).max(100).optional(),
        competitor_asins: z.array(z.string()).optional(),
        my_asins: z.array(z.string()).optional(),
        marketplace: z.array(z.string()).min(1).max(1).optional(),
        category: z.array(z.string()).optional(),
      })
      .strict(),
    aggregation: z
      .object({
        time: z
          .object({
            periodicity: z.enum(['week', 'month', 'quarter']).default('week').optional(),
            start_date: z.string().optional(),
            end_date: z.string().optional(),
            periods_back: z.coerce.number().int().min(1).max(26).default(4).optional(),
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
    limit: z.coerce.number().int().min(1).max(500).default(100).optional(),
  })
  .strict();

type QueryInput = z.infer<typeof querySchema>;

const toolSpecificSchema = z
  .object({
    weak_leader_detection: z
      .object({
        max_leader_conversion_share: z.coerce.number().min(0).max(1).optional(),
        min_search_volume_rank: z.coerce.number().int().min(1).optional(),
        require_my_presence: z.boolean().optional(),
      })
      .optional(),
  })
  .strict();

type ToolSpecific = z.infer<typeof toolSpecificSchema>;

const inputSchema = z
  .object({
    query: querySchema,
    tool_specific: toolSpecificSchema.optional(),
  })
  .strict();

export function registerBrandAnalyticsGetCompetitiveLandscapeTool(registry: ToolRegistry) {
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
    name: 'brand_analytics_get_competitive_landscape',
    description:
      'Top 3 clicked products for search terms from Brand Analytics, with weak leader detection and share gaps.',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const query = parsed.query as QueryInput;
      const toolSpecific = parsed.tool_specific as ToolSpecific | undefined;

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

      const requestedCompanyIds = query.filters.company_id ? [query.filters.company_id] : permittedCompanyIds;
      const allowedCompanyIds = requestedCompanyIds.filter((id) => permittedCompanyIds.includes(id));

      if (permittedCompanyIds.length === 0 || allowedCompanyIds.length === 0) {
        return { items: [] };
      }

      const catalog = config.athena.catalog;
      const database = 'sp_api_iceberg';

      const marketplaces = (query.filters.marketplace ?? []).map((m) => m.trim()).filter(Boolean);
      const searchTerms = (query.filters.search_terms ?? []).map((t) => t.trim()).filter(Boolean);
      const competitorAsins = (query.filters.competitor_asins ?? []).map((a) => a.trim()).filter(Boolean);
      const myAsins = (query.filters.my_asins ?? []).map((a) => a.trim()).filter(Boolean);
      const categories = (query.filters.category ?? []).map((c) => c.trim()).filter(Boolean);

      const time = query.aggregation?.time;
      const periodicity = time?.periodicity ?? 'week';
      const periodsBack = time?.periods_back ?? 4;

      const weakLeaderMax = toolSpecific?.weak_leader_detection?.max_leader_conversion_share ?? 0.15;
      const weakLeaderMinRank = toolSpecific?.weak_leader_detection?.min_search_volume_rank ?? 50000;
      const weakLeaderRequireMine = toolSpecific?.weak_leader_detection?.require_my_presence ?? false;

      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        catalog,
        periodicity_sql: sqlStringLiteral(periodicity),
        periods_back: Number(periodsBack),
        start_date_sql: sqlDateExpr(time?.start_date),
        end_date_sql: sqlDateExpr(time?.end_date),
        company_ids_array: sqlCompanyIdArrayExpr(allowedCompanyIds),
        search_terms_array: sqlVarcharArrayExpr(searchTerms),
        competitor_asins_array: sqlVarcharArrayExpr(competitorAsins),
        my_asins_array: sqlVarcharArrayExpr(myAsins),
        marketplaces_array: sqlVarcharArrayExpr(marketplaces),
        categories_array: sqlVarcharArrayExpr(categories),
        limit_top_n: Number(query.limit ?? 100),
        weak_leader_max_conversion_share: Number(weakLeaderMax),
        weak_leader_min_search_volume_rank: Number(weakLeaderMinRank),
        weak_leader_require_my_presence: weakLeaderRequireMine ? 'TRUE' : 'FALSE',
      });

      const athenaResult = await runAthenaQuery({
        query: rendered,
        database,
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows: query.limit ?? 100,
      });

      return { items: athenaResult.rows ?? [] };
    },
  });
}
