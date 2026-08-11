import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';
import {
  executeBrandAnalyticsQuery,
  intentTermsFilterClauseSql,
  sqlStringLiteral,
  termIntentsCteSql,
} from '../_clickhouse';

const inputSchema = z
  .object({
    company_ids: z.array(z.coerce.number().int().min(1)).min(1),
    marketplaces: z.array(z.string().min(1).max(10)).optional(),
    keywords: z.array(z.string().min(1).max(200)).optional(),
    intent_ids: z.array(z.string().min(1).max(64)).optional(),
    uploaded_by: z.array(z.string().min(1).max(200)).optional(),
    period_overlap_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    period_overlap_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(200).optional(),
  })
  .strict();

function arrayInClause(values: string[] | undefined, column: string, caseInsensitive = false): string {
  if (!values || values.length === 0) return '1';
  if (caseInsensitive) {
    const mapped = values.map((v) => sqlStringLiteral(v.toLowerCase()));
    return `lower(${column}) IN (${mapped.join(', ')})`;
  }
  const mapped = values.map((v) => sqlStringLiteral(v));
  return `${column} IN (${mapped.join(', ')})`;
}

function periodOverlapClause(start: string | undefined, end: string | undefined): string {
  if (!start && !end) return '1';
  const s = start ?? '1970-01-01';
  const e = end ?? '2149-06-06';
  return `t.period_start <= toDate(${sqlStringLiteral(e)}) AND t.period_end >= toDate(${sqlStringLiteral(s)})`;
}

/**
 * The ClickHouse state table stores competitors as a JSON string. Re-hydrate it
 * so the published `competitors` field keeps the array-of-objects shape.
 */
function hydrateCompetitors(row: Record<string, unknown>): Record<string, unknown> {
  const { competitors_json: competitorsJson, ...rest } = row;
  let competitors: unknown = [];
  if (typeof competitorsJson === 'string' && competitorsJson.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(competitorsJson);
      competitors = Array.isArray(parsed) ? parsed : [];
    } catch {
      competitors = [];
    }
  }
  return { ...rest, competitors };
}

export function registerBrandAnalyticsListSqpQueryDetailsUploadsTool(registry: ToolRegistry) {
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
    name: specJson?.name ?? 'brand_analytics_list_sqp_query_details_uploads',
    description:
      specJson?.description ??
      'Lists persisted Seller Central Search Query Details uploads.',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args) => {
      const parsed = inputSchema.parse(args);

      const limitTopN = parsed.limit ?? 200;

      const companyIdsSql = parsed.company_ids.map((n) => String(n)).join(', ');
      const companyFilterSql = `t.company_id IN (${companyIdsSql})`;

      // Callers pass country codes; uploads key on the canonical marketplace id,
      // so match either representation.
      const marketplaceTokens = (parsed.marketplaces ?? []).map((m) => sqlStringLiteral(m.toLowerCase()));
      const marketplaceFilterSql =
        marketplaceTokens.length > 0
          ? `lower(t.marketplace_id) IN (${marketplaceTokens.join(', ')}) ` +
            `OR lower(ifNull(mk.country_code, '')) IN (${marketplaceTokens.join(', ')})`
          : '1';

      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        term_intents_cte_sql: termIntentsCteSql(parsed.company_ids),
        company_filter_sql: companyFilterSql,
        marketplace_filter_sql: marketplaceFilterSql,
        keyword_filter_sql: arrayInClause(parsed.keywords, 't.keyword', true),
        intent_terms_filter_sql: intentTermsFilterClauseSql(
          parsed.company_ids,
          parsed.intent_ids,
          't.keyword',
        ),
        uploaded_by_filter_sql: arrayInClause(parsed.uploaded_by, 't.uploaded_by'),
        period_overlap_filter_sql: periodOverlapClause(
          parsed.period_overlap_start,
          parsed.period_overlap_end,
        ),
        limit_top_n: limitTopN,
      });

      const result = await executeBrandAnalyticsQuery(rendered);

      return { items: (result.rows ?? []).map(hydrateCompetitors) };
    },
  });
}
