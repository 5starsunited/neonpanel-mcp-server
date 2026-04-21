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
    keywords: z.array(z.string().min(1).max(200)).optional(),
    uploaded_by: z.array(z.string().min(1).max(200)).optional(),
    period_overlap_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    period_overlap_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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

function periodOverlapClause(start: string | undefined, end: string | undefined): string {
  if (!start && !end) return 'TRUE';
  const s = start ?? '1970-01-01';
  const e = end ?? '9999-12-31';
  return `period_start <= DATE ${sqlString(e)} AND period_end >= DATE ${sqlString(s)}`;
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

      const catalog = config.athena.catalog;
      const limitTopN = parsed.limit ?? 200;

      const companyIdsSql = parsed.company_ids.map((n) => String(n)).join(', ');
      const companyFilterSql = `company_id IN (${companyIdsSql})`;

      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        catalog,
        company_filter_sql: companyFilterSql,
        marketplace_filter_sql: arrayInClause(parsed.marketplaces, 'marketplace'),
        keyword_filter_sql: arrayInClause(parsed.keywords, 'keyword', true),
        uploaded_by_filter_sql: arrayInClause(parsed.uploaded_by, 'uploaded_by'),
        period_overlap_filter_sql: periodOverlapClause(
          parsed.period_overlap_start,
          parsed.period_overlap_end,
        ),
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
