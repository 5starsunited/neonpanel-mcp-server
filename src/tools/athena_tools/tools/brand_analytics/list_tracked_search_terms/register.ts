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
    asin: z.array(z.string().min(1).max(20)).optional(),
    parent_asin: z.array(z.string().min(1).max(20)).optional(),
    product_family: z.array(z.string().min(1).max(200)).optional(),
    keywords: z.array(z.string().min(1).max(200)).optional(),
    intent: z.array(z.enum(['defend', 'attack', 'evaluate', 'branded'])).optional(),
    intent_ids: z.array(z.string().min(1).max(64)).optional(),
    include_inactive: z.boolean().default(false).optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(500).optional(),
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

export function registerBrandAnalyticsListTrackedSearchTermsTool(registry: ToolRegistry) {
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
    name: specJson?.name ?? 'brand_analytics_list_tracked_search_terms',
    description:
      specJson?.description ??
      "Lists the company's tracked search terms (keyword cores).",
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args) => {
      const parsed = inputSchema.parse(args);

      const limitTopN = parsed.limit ?? 500;

      const companyIdsSql = parsed.company_ids.map((n) => String(n)).join(', ');
      const companyFilterSql = `r.company_id IN (${companyIdsSql})`;

      // Callers pass country codes; state rows key on the canonical marketplace
      // id, so match either representation.
      const marketplaceTokens = (parsed.marketplaces ?? []).map((m) => sqlStringLiteral(m.toLowerCase()));
      const marketplaceFilterSql =
        marketplaceTokens.length > 0
          ? `lower(r.marketplace_id) IN (${marketplaceTokens.join(', ')}) ` +
            `OR lower(ifNull(mk.country_code, '')) IN (${marketplaceTokens.join(', ')})`
          : '1';

      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        term_intents_cte_sql: termIntentsCteSql(parsed.company_ids),
        company_filter_sql: companyFilterSql,
        marketplace_filter_sql: marketplaceFilterSql,
        asin_filter_sql: arrayInClause(parsed.asin, 'r.asin'),
        parent_asin_filter_sql: arrayInClause(parsed.parent_asin, 'r.parent_asin'),
        product_family_filter_sql: arrayInClause(parsed.product_family, 'r.product_family'),
        keyword_filter_sql: arrayInClause(parsed.keywords, 'r.keyword', true),
        intent_filter_sql: arrayInClause(parsed.intent, 'r.intent'),
        intent_terms_filter_sql: intentTermsFilterClauseSql(
          parsed.company_ids,
          parsed.intent_ids,
          'r.keyword',
        ),
        active_filter_sql: parsed.include_inactive ? '1' : 'r.is_active = 1',
        limit_top_n: limitTopN,
      });

      const result = await executeBrandAnalyticsQuery(rendered);

      return { items: result.rows ?? [] };
    },
  });
}
