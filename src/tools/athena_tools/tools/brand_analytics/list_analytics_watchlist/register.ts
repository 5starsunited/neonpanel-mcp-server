import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';
import { executeBrandAnalyticsQuery, sqlStringLiteral } from '../_clickhouse';

const inputSchema = z
  .object({
    company_ids: z.array(z.coerce.number().int().min(1)).min(1),
    marketplaces: z.array(z.string().min(1).max(10)).optional(),
    watchlist_names: z.array(z.string().min(1).max(200)).optional(),
    grain: z.array(z.enum(['child_asin', 'parent_asin', 'product_family', 'brand'])).optional(),
    cadence: z.array(z.enum(['weekly', 'monthly', 'quarterly'])).optional(),
    focus: z
      .array(
        z.enum(['growth_machine', 'cart_leak', 'cannibalization', 'weak_leader', 'defend', 'generic']),
      )
      .optional(),
    owner: z.array(z.string().min(1).max(200)).optional(),
    include_inactive: z.boolean().default(false).optional(),
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

export function registerBrandAnalyticsListAnalyticsWatchlistTool(registry: ToolRegistry) {
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
    name: specJson?.name ?? 'brand_analytics_list_analytics_watchlist',
    description:
      specJson?.description ?? "Lists the company's saved analytics watchlists.",
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args) => {
      const parsed = inputSchema.parse(args);

      const limitTopN = parsed.limit ?? 200;

      const companyIdsSql = parsed.company_ids.map((n) => String(n)).join(', ');
      const companyFilterSql = `w.company_id IN (${companyIdsSql})`;

      // Callers pass country codes; state rows key on the canonical marketplace
      // id, so match either representation.
      const marketplaceTokens = (parsed.marketplaces ?? []).map((m) => sqlStringLiteral(m.toLowerCase()));
      const marketplaceFilterSql =
        marketplaceTokens.length > 0
          ? `lower(w.marketplace_id) IN (${marketplaceTokens.join(', ')}) ` +
            `OR lower(ifNull(mk.country_code, '')) IN (${marketplaceTokens.join(', ')})`
          : '1';

      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        company_filter_sql: companyFilterSql,
        marketplace_filter_sql: marketplaceFilterSql,
        watchlist_name_filter_sql: arrayInClause(parsed.watchlist_names, 'w.watchlist_name', true),
        grain_filter_sql: arrayInClause(parsed.grain, 'w.grain'),
        cadence_filter_sql: arrayInClause(parsed.cadence, 'w.cadence'),
        focus_filter_sql: arrayInClause(parsed.focus, 'w.focus'),
        owner_filter_sql: arrayInClause(parsed.owner, 'w.owner'),
        active_filter_sql: parsed.include_inactive ? '1' : 'w.is_active = 1',
        limit_top_n: limitTopN,
      });

      const result = await executeBrandAnalyticsQuery(rendered);

      return { items: result.rows ?? [] };
    },
  });
}
