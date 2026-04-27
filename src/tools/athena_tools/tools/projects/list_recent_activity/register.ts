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
    days_back: z.coerce.number().int().min(1).max(30).default(3).optional(),
    event_types: z.array(z.enum(['task_status_changed', 'field_value_changed'])).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100).optional(),
  })
  .strict();

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildSummary(row: Record<string, unknown>): string {
  const actor = String(row.actor_user_name ?? 'Unknown user');
  const action = row.event_type === 'field_value_changed' ? 'updated field' : 'changed task';
  const entityName = String(row.entity_name ?? 'unknown item');
  const projectName = String(row.project_name ?? 'unassigned project');
  const content = String(row.item_content ?? '').trim();
  return content
    ? `${actor} ${action} ${entityName} in ${projectName}: ${content}`
    : `${actor} ${action} ${entityName} in ${projectName}`;
}

function arrayInClause(values: string[] | undefined, column: string): string {
  if (!values || values.length === 0) return 'TRUE';
  return `${column} IN (${values.map((value) => sqlString(value)).join(', ')})`;
}

export function registerProjectsListRecentActivityTool(registry: ToolRegistry) {
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
    name: specJson?.name ?? 'projects_list_recent_activity',
    description:
      specJson?.description ??
      'Lists recent project, task, and field activity for the last N days.',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args) => {
      const parsed = inputSchema.parse(args);
      const catalog = config.athena.catalog;
      const limitTopN = parsed.limit ?? 100;
      const companyFilterSql = `e.company_id IN (${parsed.company_ids.map((id) => String(id)).join(', ')})`;

      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        catalog,
        company_filter_sql: companyFilterSql,
        event_type_filter_sql: arrayInClause(parsed.event_types, 'e.event_type'),
        days_back: parsed.days_back ?? 3,
        limit_top_n: limitTopN,
      });

      const athenaResult = await runAthenaQuery({
        query: rendered,
        database: config.athena.database,
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows: limitTopN,
      });

      const items = (athenaResult.rows ?? []).map((row) => ({
        ...row,
        summary: buildSummary(row as Record<string, unknown>),
      }));

      return {
        items,
        meta: {
          row_count: items.length,
          days_back: parsed.days_back ?? 3,
          company_ids: parsed.company_ids,
          event_types: parsed.event_types ?? ['task_status_changed', 'field_value_changed'],
        },
      };
    },
  });
}