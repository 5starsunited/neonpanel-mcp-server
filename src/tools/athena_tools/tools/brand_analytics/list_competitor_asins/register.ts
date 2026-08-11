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
    against_my_asin: z.array(z.string().min(1).max(20)).optional(),
    against_my_product_family: z.array(z.string().min(1).max(200)).optional(),
    competitor_asins: z.array(z.string().min(1).max(20)).optional(),
    include_inactive: z.boolean().default(false).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(200).optional(),
  })
  .strict();

function arrayInClause(values: string[] | undefined, column: string): string {
  if (!values || values.length === 0) return '1';
  const mapped = values.map((value) => sqlStringLiteral(value));
  return `${column} IN (${mapped.join(', ')})`;
}

export function registerBrandAnalyticsListCompetitorAsinsTool(registry: ToolRegistry) {
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
    name: specJson?.name ?? 'brand_analytics_list_competitor_asins',
    description:
      specJson?.description ??
      "Lists the company's registered competitor ASINs.",
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args) => {
      const parsed = inputSchema.parse(args);

      const limitTopN = parsed.limit ?? 200;

      const companyIdsSql = parsed.company_ids.map((n) => String(n)).join(', ');
      const companyFilterSql = `competitors.company_id IN (${companyIdsSql})`;

      // Callers pass country codes; state rows key on the canonical marketplace
      // id, so match either representation.
      const marketplaceFilterSql =
        parsed.marketplaces && parsed.marketplaces.length > 0
          ? `lower(competitors.marketplace_id) IN (${parsed.marketplaces
              .map((m) => sqlStringLiteral(m.toLowerCase()))
              .join(', ')}) OR lower(ifNull(marketplace.country_code, '')) IN (${parsed.marketplaces
              .map((m) => sqlStringLiteral(m.toLowerCase()))
              .join(', ')})`
          : '1';
      const competitorAsinFilterSql = arrayInClause(parsed.competitor_asins, 'competitors.competitor_asin');
      const againstAsinFilterSql = arrayInClause(parsed.against_my_asin, 'competitors.against_my_asin');
      const againstFamilyFilterSql = arrayInClause(
        parsed.against_my_product_family,
        'competitors.against_my_product_family',
      );

      const activeFilterSql = parsed.include_inactive ? '1' : 'competitors.is_active = 1';

      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        company_filter_sql: companyFilterSql,
        marketplace_filter_sql: marketplaceFilterSql,
        competitor_asin_filter_sql: competitorAsinFilterSql,
        against_my_asin_filter_sql: againstAsinFilterSql,
        against_my_product_family_filter_sql: againstFamilyFilterSql,
        active_filter_sql: activeFilterSql,
        limit_top_n: limitTopN,
      });

      const result = await executeBrandAnalyticsQuery(rendered);

      return { items: result.rows ?? [] };
    },
  });
}
