import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runAthenaQuery } from '../../../../../clients/athena';
import { config } from '../../../../../config';
import type { ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';

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

function sqlString(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

function arrayInClause(values: string[] | undefined, column: string, wrap?: (s: string) => string): string {
  if (!values || values.length === 0) return 'TRUE';
  const mapped = values.map((v) => sqlString(wrap ? wrap(v) : v));
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

      const catalog = config.athena.catalog;
      const limitTopN = parsed.limit ?? 200;

      const companyIdsSql = parsed.company_ids.map((n) => String(n)).join(', ');
      const companyFilterSql = `company_id IN (${companyIdsSql})`;

      const marketplaceFilterSql = arrayInClause(parsed.marketplaces, 'marketplace');
      const competitorAsinFilterSql = arrayInClause(parsed.competitor_asins, 'competitor_asin');
      const againstAsinFilterSql = arrayInClause(parsed.against_my_asin, 'against_my_asin');
      const againstFamilyFilterSql = arrayInClause(parsed.against_my_product_family, 'against_my_product_family');

      const activeFilterSql = parsed.include_inactive ? 'TRUE' : 'is_active = TRUE';

      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        catalog,
        company_filter_sql: companyFilterSql,
        marketplace_filter_sql: marketplaceFilterSql,
        competitor_asin_filter_sql: competitorAsinFilterSql,
        against_my_asin_filter_sql: againstAsinFilterSql,
        against_my_product_family_filter_sql: againstFamilyFilterSql,
        active_filter_sql: activeFilterSql,
        limit_top_n: limitTopN,
      });

      const athenaResult = await runAthenaQuery({
        query: rendered,
        database: 'brand_analytics_iceberg',
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows: limitTopN,
      });

      return { items: athenaResult.rows ?? [] };
    },
  });
}
