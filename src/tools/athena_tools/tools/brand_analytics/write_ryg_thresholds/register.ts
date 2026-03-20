import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runAthenaQuery } from '../../../../../clients/athena';
import { neonPanelRequest } from '../../../../../clients/neonpanel-api';
import { config } from '../../../../../config';
import type { ToolExecutionContext, ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';

type CompaniesWithPermissionResponse = {
  companies?: Array<{
    company_id?: number;
    companyId?: number;
    id?: number;
  }>;
};

function sqlEscapeString(value: string): string {
  return value.replace(/'/g, "''");
}

function sqlStringLiteral(value: string): string {
  return `'${sqlEscapeString(value)}'`;
}

const writeItemSchema = z.object({
  tool: z.enum(['sqp', 'scp', 'global']),
  signal_group: z.enum(['strength', 'weakness', 'opportunity', 'threshold', 'trend']),
  metric: z.string().min(1).max(100),
  color: z.enum(['green', 'yellow', 'red']),
  threshold_value: z.number(),
  signal_code: z.string().min(1).max(100),
  signal_description: z.string().min(1).max(500),
});

const inputSchema = z
  .object({
    company_id: z.coerce.number().int().min(1),
    reason: z.string().min(5),
    action: z.enum(['write', 'reset']).default('write').optional(),
    dry_run: z.boolean().default(true).optional(),
    writes: z.array(writeItemSchema).min(1).max(50).optional(),
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

function buildWritesValuesSql(companyId: number, writes: Array<z.infer<typeof writeItemSchema>>): string {
  return writes
    .map((w) => {
      return `(${companyId}, 'default', ${sqlStringLiteral(w.tool)}, ${sqlStringLiteral(w.signal_group)}, ${sqlStringLiteral(w.metric)}, ${sqlStringLiteral(w.color)}, ${w.threshold_value}, ${sqlStringLiteral(w.signal_code)}, ${sqlStringLiteral(w.signal_description)}, current_timestamp)`;
    })
    .join(',\n  ');
}

function buildSlotsInClause(writes: Array<z.infer<typeof writeItemSchema>>): string {
  return writes
    .map((w) => `(${sqlStringLiteral(w.tool)}, ${sqlStringLiteral(w.signal_group)}, ${sqlStringLiteral(w.metric)}, ${sqlStringLiteral(w.color)})`)
    .join(',\n    ');
}

export function registerBrandAnalyticsWriteRygThresholdsTool(registry: ToolRegistry) {
  const toolJsonPath = path.join(__dirname, 'tool.json');
  const insertSqlPath = path.join(__dirname, 'insert.sql');
  const deleteSlotsSqlPath = path.join(__dirname, 'delete_slots.sql');
  const deleteAllSqlPath = path.join(__dirname, 'delete_all.sql');

  let specJson: ToolSpecJson | undefined;
  try {
    if (fs.existsSync(toolJsonPath)) {
      specJson = JSON.parse(fs.readFileSync(toolJsonPath, 'utf8')) as ToolSpecJson;
    }
  } catch {
    specJson = undefined;
  }

  registry.register({
    name: specJson?.name ?? 'brand_analytics_write_ryg_thresholds',
    description:
      specJson?.description ??
      'Write company-specific RYG threshold overrides for Brand Analytics tools.',
    isConsequential: true,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const companyId = parsed.company_id;
      const action = parsed.action ?? 'write';
      const dryRun = parsed.dry_run !== false;
      const writes = parsed.writes ?? [];

      const authorized = await isAuthorizedForCompany(companyId, context);
      if (!authorized) {
        return { dry_run: dryRun, action, accepted: 0, written: 0, error: 'Not authorized for this company.' };
      }

      if (action === 'reset') {
        if (dryRun) {
          return {
            dry_run: true,
            action: 'reset',
            accepted: 0,
            written: 0,
            deleted: 0,
            message: `Dry run: would delete ALL threshold overrides for company_id=${companyId}.`,
          };
        }

        const deleteAllTemplate = await loadTextFile(deleteAllSqlPath);
        const deleteAllSql = renderSqlTemplate(deleteAllTemplate, {
          catalog: config.athena.catalog,
          company_id: companyId,
        });

        await runAthenaQuery({
          query: deleteAllSql,
          database: 'brand_analytics_iceberg',
          workGroup: config.athena.workgroup,
          outputLocation: config.athena.outputLocation,
          maxRows: 0,
        });

        return {
          dry_run: false,
          action: 'reset',
          accepted: 0,
          written: 0,
          deleted: -1, // Iceberg DELETE doesn't return count
          message: `All threshold overrides for company_id=${companyId} have been deleted. System defaults now apply.`,
        };
      }

      // action === 'write'
      if (writes.length === 0) {
        return { dry_run: dryRun, action: 'write', accepted: 0, written: 0, error: 'writes array is required for action=write.' };
      }

      const items = writes.map((w) => ({
        status: 'ok' as const,
        tool: w.tool,
        signal_group: w.signal_group,
        metric: w.metric,
        color: w.color,
        threshold_value: w.threshold_value,
      }));

      if (dryRun) {
        return {
          dry_run: true,
          action: 'write',
          accepted: writes.length,
          written: 0,
          items,
          message: `Dry run: ${writes.length} threshold(s) validated. Set dry_run=false to persist.`,
        };
      }

      const catalog = config.athena.catalog;

      // Step 1: Delete existing rows for the same slots
      const deleteSlotsTemplate = await loadTextFile(deleteSlotsSqlPath);
      const deleteSlotsSql = renderSqlTemplate(deleteSlotsTemplate, {
        catalog,
        company_id: companyId,
        slots_in_clause: buildSlotsInClause(writes),
      });

      await runAthenaQuery({
        query: deleteSlotsSql,
        database: 'brand_analytics_iceberg',
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows: 0,
      });

      // Step 2: Insert new rows
      const insertTemplate = await loadTextFile(insertSqlPath);
      const insertSql = renderSqlTemplate(insertTemplate, {
        catalog,
        writes_values_sql: buildWritesValuesSql(companyId, writes),
      });

      await runAthenaQuery({
        query: insertSql,
        database: 'brand_analytics_iceberg',
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows: 0,
      });

      return {
        dry_run: false,
        action: 'write',
        accepted: writes.length,
        written: writes.length,
        items,
        message: `${writes.length} threshold override(s) written for company_id=${companyId}.`,
      };
    },
  });
}
