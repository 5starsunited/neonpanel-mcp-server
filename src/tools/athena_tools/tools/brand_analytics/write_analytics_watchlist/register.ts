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
  companies?: Array<{ company_id?: number; companyId?: number; id?: number }>;
};

function sqlEscape(v: string): string {
  return v.replace(/'/g, "''");
}
function sqlString(v: string): string {
  return `'${sqlEscape(v)}'`;
}
function sqlNullableString(v: string | null | undefined): string {
  return v == null || v === '' ? 'NULL' : sqlString(v);
}
function buildEntityIdsArraySql(ids: string[]): string {
  if (ids.length === 0) return 'CAST(NULL AS ARRAY<VARCHAR>)';
  return `ARRAY[${ids.map((s) => sqlString(s)).join(', ')}]`;
}

const writeItemSchema = z.object({
  marketplace: z.string().min(1).max(10),
  watchlist_name: z.string().min(1).max(200),
  grain: z.enum(['child_asin', 'parent_asin', 'product_family', 'brand']),
  entity_ids: z.array(z.string().min(1).max(200)).min(1).max(500),
  cadence: z.enum(['weekly', 'monthly', 'quarterly']),
  focus: z.enum([
    'growth_machine',
    'cart_leak',
    'cannibalization',
    'weak_leader',
    'defend',
    'generic',
  ]),
  owner: z.string().max(200).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

const inputSchema = z
  .object({
    company_id: z.coerce.number().int().min(1),
    reason: z.string().min(5),
    action: z.enum(['write', 'deactivate', 'reset']).default('write').optional(),
    dry_run: z.boolean().default(true).optional(),
    writes: z.array(writeItemSchema).min(1).max(100).optional(),
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

function buildWritesValuesSql(
  companyId: number,
  userId: string,
  isActive: boolean,
  writes: Array<z.infer<typeof writeItemSchema>>,
): string {
  return writes
    .map((w) => {
      return (
        `(${companyId}, ${sqlString(w.marketplace)}, ${sqlString(w.watchlist_name)}, ` +
        `${sqlString(w.grain)}, ${buildEntityIdsArraySql(w.entity_ids)}, ` +
        `${sqlString(w.cadence)}, ${sqlString(w.focus)}, ${sqlNullableString(w.owner ?? null)}, ` +
        `CAST(NULL AS TIMESTAMP), ${isActive ? 'TRUE' : 'FALSE'}, ` +
        `current_timestamp, current_timestamp, ${sqlString(userId)}, ${sqlString(userId)}, ` +
        `${sqlNullableString(w.notes ?? null)})`
      );
    })
    .join(',\n  ');
}

function buildSlotsInClause(writes: Array<z.infer<typeof writeItemSchema>>): string {
  return writes
    .map((w) => `(${sqlString(w.marketplace)}, ${sqlString(w.watchlist_name.toLowerCase())})`)
    .join(',\n    ');
}

export function registerBrandAnalyticsWriteAnalyticsWatchlistTool(registry: ToolRegistry) {
  const toolJsonPath = path.join(__dirname, 'tool.json');
  const insertSqlPath = path.join(__dirname, 'insert.sql');
  const deleteSlotsSqlPath = path.join(__dirname, 'delete_slots.sql');
  const resetAllSqlPath = path.join(__dirname, 'reset_all.sql');

  let specJson: ToolSpecJson | undefined;
  try {
    if (fs.existsSync(toolJsonPath)) {
      specJson = JSON.parse(fs.readFileSync(toolJsonPath, 'utf8')) as ToolSpecJson;
    }
  } catch {
    specJson = undefined;
  }

  registry.register({
    name: specJson?.name ?? 'brand_analytics_write_analytics_watchlist',
    description:
      specJson?.description ?? "Upserts, deactivates, or resets the company's saved analytics watchlists.",
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
      const catalog = config.athena.catalog;
      const userId = context.subject ?? 'unknown';

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
            deactivated: 0,
            message: `Dry run: would deactivate ALL analytics watchlist rows for company_id=${companyId}.`,
          };
        }
        const resetTemplate = await loadTextFile(resetAllSqlPath);
        const resetSql = renderSqlTemplate(resetTemplate, {
          catalog,
          company_id: companyId,
          updated_by_literal: sqlString(userId),
        });
        await runAthenaQuery({
          query: resetSql,
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
          deactivated: -1,
          message: `All analytics watchlist rows for company_id=${companyId} have been deactivated.`,
        };
      }

      if (writes.length === 0) {
        return {
          dry_run: dryRun,
          action,
          accepted: 0,
          written: 0,
          error: `writes array is required for action=${action}.`,
        };
      }

      if (dryRun) {
        return {
          dry_run: true,
          action,
          accepted: writes.length,
          written: 0,
          message: `Dry run: ${writes.length} analytics watchlist row(s) validated. Set dry_run=false to persist.`,
        };
      }

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

      const isActive = action === 'write';
      const insertTemplate = await loadTextFile(insertSqlPath);
      const insertSql = renderSqlTemplate(insertTemplate, {
        catalog,
        writes_values_sql: buildWritesValuesSql(companyId, userId, isActive, writes),
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
        action,
        accepted: writes.length,
        written: action === 'write' ? writes.length : 0,
        deactivated: action === 'deactivate' ? writes.length : 0,
        message:
          action === 'write'
            ? `${writes.length} analytics watchlist row(s) written for company_id=${companyId}.`
            : `${writes.length} analytics watchlist row(s) deactivated for company_id=${companyId}.`,
      };
    },
  });
}
