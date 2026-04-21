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

function sqlString(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

function arrayInClause(values: string[] | undefined, column: string, caseInsensitive = false): string {
  if (!values || values.length === 0) return 'TRUE';
  if (caseInsensitive) {
    const mapped = values.map((v) => sqlString(v.toLowerCase()));
    return `LOWER(${column}) IN (${mapped.join(', ')})`;
  }
  const mapped = values.map((v) => sqlString(v));
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

      const catalog = config.athena.catalog;
      const limitTopN = parsed.limit ?? 200;

      const companyIdsSql = parsed.company_ids.map((n) => String(n)).join(', ');
      const companyFilterSql = `company_id IN (${companyIdsSql})`;

      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        catalog,
        company_filter_sql: companyFilterSql,
        marketplace_filter_sql: arrayInClause(parsed.marketplaces, 'marketplace'),
        watchlist_name_filter_sql: arrayInClause(parsed.watchlist_names, 'watchlist_name', true),
        grain_filter_sql: arrayInClause(parsed.grain, 'grain'),
        cadence_filter_sql: arrayInClause(parsed.cadence, 'cadence'),
        focus_filter_sql: arrayInClause(parsed.focus, 'focus'),
        owner_filter_sql: arrayInClause(parsed.owner, 'owner'),
        active_filter_sql: parsed.include_inactive ? 'TRUE' : 'is_active = TRUE',
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
