import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';
import { executeBrandAnalyticsQuery, sqlStringLiteral } from '../_clickhouse';

const MAX_ROWS = 200;

const inputSchema = z
  .object({
    company_ids: z.array(z.coerce.number().int().min(1)).min(1),
    tool: z.enum(['sqp', 'scp', 'global', 'growth_machine']).optional(),
    include_defaults: z.boolean().default(true).optional(),
  })
  .strict();

export function registerBrandAnalyticsListRygThresholdsTool(registry: ToolRegistry) {
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
    name: specJson?.name ?? 'brand_analytics_list_ryg_thresholds',
    description:
      specJson?.description ??
      'Lists RYG signal thresholds (defaults + company overrides) for Brand Analytics tools.',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args) => {
      const parsed = inputSchema.parse(args);

      const includeDefaults = parsed.include_defaults !== false;

      const toolFilter = parsed.tool ? `tool = ${sqlStringLiteral(parsed.tool)}` : '1';

      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        company_id_sql: String(parsed.company_ids[0]),
        include_defaults: includeDefaults ? '1' : '0',
        tool_filter_sql: toolFilter,
        limit: MAX_ROWS,
      });

      const result = await executeBrandAnalyticsQuery(rendered);

      return { items: result.rows ?? [] };
    },
  });
}
