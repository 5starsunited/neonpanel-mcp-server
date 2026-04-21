import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runAthenaQuery } from '../../../../../clients/athena';
import { neonPanelRequest } from '../../../../../clients/neonpanel-api';
import { config } from '../../../../../config';
import type { ToolExecutionContext, ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';

type CompaniesWithPermissionResponse = {
  companies?: Array<{ company_id?: number; companyId?: number; id?: number }>;
};

function sqlString(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

function buildStringArraySql(values: string[] | undefined): string {
  if (!values || values.length === 0) return 'CAST(ARRAY[] AS ARRAY<VARCHAR>)';
  return `ARRAY[${values.map((v) => sqlString(v)).join(', ')}]`;
}

const inputSchema = z
  .object({
    company_id: z.coerce.number().int().min(1),
    marketplace: z.string().min(1).max(10).default('us').optional(),
    period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    grain: z
      .enum(['child_asin', 'parent_asin', 'product_family', 'brand'])
      .default('child_asin')
      .optional(),
    entity_ids: z.array(z.string().min(1).max(200)).default([]).optional(),
    keywords: z.array(z.string().min(1).max(200)).default([]).optional(),
    use_tracked_search_terms: z.boolean().default(true).optional(),
    use_competitor_registry: z.boolean().default(true).optional(),
    focus: z
      .enum(['growth_machine', 'cart_leak', 'cannibalization', 'weak_leader', 'defend', 'generic'])
      .default('growth_machine')
      .optional(),
    limit: z.coerce.number().int().min(1).max(2000).default(200).optional(),
  })
  .strict();

async function isAuthorizedForCompany(companyId: number, context: ToolExecutionContext): Promise<boolean> {
  const permissions = [
    'view:quicksight_group.sales_and_marketing_new',
    'view:quicksight_group.marketing',
  ];
  for (const permission of permissions) {
    try {
      const resp = await neonPanelRequest<CompaniesWithPermissionResponse>({
        token: context.userToken,
        path: `/api/v1/permissions/${encodeURIComponent(permission)}/companies`,
      });
      const ids = (resp.companies ?? [])
        .map((c) => c.company_id ?? c.companyId ?? c.id)
        .filter((id): id is number => typeof id === 'number' && Number.isFinite(id) && id > 0);
      if (ids.includes(companyId)) return true;
    } catch {
      // continue
    }
  }
  return false;
}

export function registerBrandAnalyticsGrowthMachineDiagnosisTool(registry: ToolRegistry) {
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
    name: specJson?.name ?? 'brand_analytics_growth_machine_diagnosis',
    description:
      specJson?.description ?? 'Fuses SQP + SCP + PPC and emits one locked prescription per (keyword × ASIN).',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const companyId = parsed.company_id;
      const marketplace = parsed.marketplace ?? 'us';
      const grain = parsed.grain ?? 'child_asin';
      const focus = parsed.focus ?? 'growth_machine';
      const entityIds = parsed.entity_ids ?? [];
      const keywords = parsed.keywords ?? [];
      const useTracked = parsed.use_tracked_search_terms !== false;
      const useCompetitors = parsed.use_competitor_registry !== false;
      const limitTopN = parsed.limit ?? 200;

      const authorized = await isAuthorizedForCompany(companyId, context);
      if (!authorized) {
        return {
          header: {
            company_id: companyId,
            marketplace,
            period_start: parsed.period_start,
            period_end: parsed.period_end,
            grain,
            focus,
            rows_returned: 0,
            keywords_in_scope: 0,
            normalization_match_rate: null,
            use_tracked_search_terms: useTracked,
            use_competitor_registry: useCompetitors,
            error: 'Not authorized for this company.',
          },
          items: [],
        };
      }

      if (parsed.period_start > parsed.period_end) {
        return {
          header: {
            company_id: companyId,
            marketplace,
            period_start: parsed.period_start,
            period_end: parsed.period_end,
            grain,
            focus,
            rows_returned: 0,
            keywords_in_scope: 0,
            normalization_match_rate: null,
            use_tracked_search_terms: useTracked,
            use_competitor_registry: useCompetitors,
            error: 'period_start must be <= period_end.',
          },
          items: [],
        };
      }

      const catalog = config.athena.catalog;
      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        catalog,
        company_id: companyId,
        marketplace_literal: sqlString(marketplace),
        period_start_literal: sqlString(parsed.period_start),
        period_end_literal: sqlString(parsed.period_end),
        grain_literal: sqlString(grain),
        focus_literal: sqlString(focus),
        entity_ids_array_sql: buildStringArraySql(entityIds),
        keywords_array_sql: buildStringArraySql(keywords),
        use_tracked_search_terms_sql: useTracked ? 'TRUE' : 'FALSE',
        use_competitor_registry_sql: useCompetitors ? 'TRUE' : 'FALSE',
        limit_top_n: limitTopN,
      });

      const athenaResult = await runAthenaQuery({
        query: rendered,
        database: 'brand_analytics_iceberg',
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows: limitTopN,
      });

      const items = athenaResult.rows ?? [];
      const keywordsInScope = new Set<string>();
      for (const it of items) {
        const k = (it as Record<string, unknown>).keyword_normalized;
        if (typeof k === 'string') keywordsInScope.add(k);
      }

      return {
        header: {
          company_id: companyId,
          marketplace,
          period_start: parsed.period_start,
          period_end: parsed.period_end,
          grain,
          focus,
          rows_returned: items.length,
          keywords_in_scope: keywordsInScope.size,
          normalization_match_rate: null,
          use_tracked_search_terms: useTracked,
          use_competitor_registry: useCompetitors,
        },
        items,
      };
    },
  });
}
