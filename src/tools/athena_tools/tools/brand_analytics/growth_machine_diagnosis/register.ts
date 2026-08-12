import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { neonPanelRequest } from '../../../../../clients/neonpanel-api';
import type { ToolExecutionContext, ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';
import {
  executeBrandAnalyticsQuery,
  resolveMarketplaceIds,
  sqlStringArrayExpr,
  sqlStringLiteral,
  termIntentsCteSql,
} from '../_clickhouse';

type CompaniesWithPermissionResponse = {
  companies?: Array<{ company_id?: number; companyId?: number; id?: number }>;
};

function sqlDateLiteral(value: string): string {
  return `toDate(${sqlStringLiteral(value)})`;
}

/**
 * screenshot_competitors is a JSON string in ClickHouse (the Athena source held
 * a real array<row<...>>). Parse it back so the tool's output contract keeps
 * exposing an array rather than leaking the storage encoding to the caller.
 */
function parseScreenshotCompetitors(row: Record<string, unknown>): Record<string, unknown> {
  const raw = row.screenshot_competitors;
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ...row, screenshot_competitors: null };
  }
  try {
    return { ...row, screenshot_competitors: JSON.parse(raw) };
  } catch {
    return { ...row, screenshot_competitors: null };
  }
}

const inputSchema = z
  .object({
    company_id: z.coerce.number().int().min(1),
    marketplace: z.string().min(1).max(20).default('us').optional(),
    period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    grain: z
      .enum(['child_asin', 'parent_asin', 'product_family', 'brand'])
      .default('child_asin')
      .optional(),
    entity_ids: z.array(z.string().min(1).max(200)).default([]).optional(),
    keywords: z.array(z.string().min(1).max(200)).default([]).optional(),
    intent_ids: z.array(z.string().min(1).max(64)).default([]).optional(),
    use_tracked_search_terms: z.boolean().default(true).optional(),
    use_competitor_registry: z.boolean().default(true).optional(),
    focus: z
      .enum(['growth_machine', 'cart_leak', 'cannibalization', 'weak_leader', 'defend', 'generic'])
      .default('growth_machine')
      .optional(),
    limit: z.coerce.number().int().min(1).max(2000).default(200).optional(),
    group_by: z
      .array(z.enum(['intent', 'prescription', 'product_family', 'brand', 'parent_asin']))
      .max(3)
      .optional(),
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

      const marketplaceIds = await resolveMarketplaceIds([marketplace]);
      const marketplaceId = marketplaceIds.get(marketplace.trim().toLowerCase());
      if (!marketplaceId) {
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
            error: `Unknown marketplace: ${marketplace}.`,
          },
          items: [],
        };
      }

      const sharedTokens = {
        company_id: companyId,
        marketplace_id_literal: sqlStringLiteral(marketplaceId),
        marketplace_code_upper_literal: sqlStringLiteral(marketplace.trim().toUpperCase()),
        period_start_literal: sqlDateLiteral(parsed.period_start),
        period_end_literal: sqlDateLiteral(parsed.period_end),
        grain_literal: sqlStringLiteral(grain),
        focus_literal: sqlStringLiteral(focus),
        entity_ids_array_sql: sqlStringArrayExpr(entityIds),
        keywords_array_sql: sqlStringArrayExpr(keywords),
        intent_ids_array_sql: sqlStringArrayExpr(
          (parsed.intent_ids ?? []).map((s) => s.trim()).filter(Boolean),
        ),
        use_tracked_search_terms_sql: useTracked ? '1' : '0',
        use_competitor_registry_sql: useCompetitors ? '1' : '0',
        limit_top_n: limitTopN,
      };

      // ── Grouped aggregation path ──────────────────────────────────────────
      const groupByDims = parsed.group_by ?? [];
      if (groupByDims.length > 0) {
        const dimMap: Record<string, { select: string; group: string }> = {
          intent:         { select: 'e.intent_id AS intent_id, e.intent_label AS intent_label',      group: 'e.intent_id, e.intent_label' },
          prescription:   { select: 'e.prescription AS prescription',                                group: 'e.prescription' },
          product_family: { select: "ifNull(e.product_family, '__UNKNOWN__') AS product_family",     group: "ifNull(e.product_family, '__UNKNOWN__')" },
          brand:          { select: "ifNull(e.brand, '__UNKNOWN__') AS brand",                       group: "ifNull(e.brand, '__UNKNOWN__')" },
          parent_asin:    { select: 'e.parent_asin AS parent_asin',                                  group: 'e.parent_asin' },
        };
        const selects: string[] = [];
        const groups: string[] = [];
        for (const dim of groupByDims) {
          const m = dimMap[dim];
          if (!m) throw new Error(`Unsupported group_by dimension: ${dim}`);
          selects.push(m.select);
          groups.push(m.group);
        }

        const sqlGroupedPath = path.join(__dirname, 'query_grouped.sql');
        const groupedTemplate = await loadTextFile(sqlGroupedPath);
        const renderedGrouped = renderSqlTemplate(groupedTemplate, {
          ...sharedTokens,
          term_intents_cte_sql: termIntentsCteSql([companyId]),
          group_by_select_clause: selects.join(',\n        '),
          group_by_clause: groups.join(', '),
        });

        const grouped = await executeBrandAnalyticsQuery(renderedGrouped);

        const aggregations = grouped.rows ?? [];
        return {
          header: {
            company_id: companyId,
            marketplace,
            period_start: parsed.period_start,
            period_end: parsed.period_end,
            grain,
            focus,
            rows_returned: aggregations.length,
            keywords_in_scope: null,
            normalization_match_rate: null,
            use_tracked_search_terms: useTracked,
            use_competitor_registry: useCompetitors,
            group_by: groupByDims,
          },
          items: [],
          aggregations,
        };
      }

      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, sharedTokens);

      const result = await executeBrandAnalyticsQuery(rendered);

      const items = (result.rows ?? []).map((row) =>
        parseScreenshotCompetitors(row as Record<string, unknown>),
      );
      const keywordsInScope = new Set<string>();
      let ppcAttributedRows = 0;
      for (const it of items) {
        const k = it.keyword_normalized;
        if (typeof k === 'string') keywordsInScope.add(k);
        if (it.ppc_impressions !== null && it.ppc_impressions !== undefined) ppcAttributedRows += 1;
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
          // NULL ppc_* means "not attributable", not "zero spend": the upstream
          // PPC table does not yet populate the promoted ASIN. Surfaced so a
          // caller can tell an absent PPC leg from a genuinely idle keyword.
          ppc_attributed_rows: ppcAttributedRows,
        },
        items,
      };
    },
  });
}
