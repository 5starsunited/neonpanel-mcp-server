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

function sqlEscape(value: string): string {
  return value.replace(/'/g, "''");
}

function sqlString(value: string): string {
  return `'${sqlEscape(value)}'`;
}

function sqlNullableString(value: string | null | undefined): string {
  return value == null || value === '' ? 'NULL' : sqlString(value);
}

function sqlNullableInt(value: number | null | undefined): string {
  return value == null ? 'NULL' : String(Math.trunc(value));
}

const writeItemSchema = z.object({
  marketplace: z.string().min(1).max(10),
  competitor_asin: z.string().min(8).max(20),
  competitor_brand: z.string().max(200).nullable().optional(),
  competitor_label: z.string().max(300).nullable().optional(),
  against_my_asin: z.string().max(20).nullable().optional(),
  against_my_product_family: z.string().max(200).nullable().optional(),
  priority: z.number().int().min(1).max(5).nullable().optional(),
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
        `(${companyId}, ${sqlString(w.marketplace)}, ${sqlString(w.competitor_asin)}, ` +
        `${sqlNullableString(w.competitor_brand ?? null)}, ${sqlNullableString(w.competitor_label ?? null)}, ` +
        `${sqlNullableString(w.against_my_asin ?? null)}, ${sqlNullableString(w.against_my_product_family ?? null)}, ` +
        `${sqlNullableInt(w.priority ?? null)}, ${sqlString(userId)}, current_timestamp, ${isActive ? 'TRUE' : 'FALSE'})`
      );
    })
    .join(',\n  ');
}

function buildSlotsInClause(writes: Array<z.infer<typeof writeItemSchema>>): string {
  return writes
    .map(
      (w) =>
        `(${sqlString(w.marketplace)}, ${sqlString(w.competitor_asin)}, ` +
        `${sqlString(w.against_my_asin ?? '')}, ${sqlString(w.against_my_product_family ?? '')})`,
    )
    .join(',\n    ');
}

export function registerBrandAnalyticsWriteCompetitorAsinsTool(registry: ToolRegistry) {
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
    name: specJson?.name ?? 'brand_analytics_write_competitor_asins',
    description:
      specJson?.description ??
      "Writes company-specific competitor ASIN entries.",
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
            message: `Dry run: would deactivate ALL competitor entries for company_id=${companyId}.`,
          };
        }
        const resetTemplate = await loadTextFile(resetAllSqlPath);
        const resetSql = renderSqlTemplate(resetTemplate, { catalog, company_id: companyId });
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
          message: `All competitor entries for company_id=${companyId} have been deactivated.`,
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
          message: `Dry run: ${writes.length} competitor row(s) validated. Set dry_run=false to persist.`,
        };
      }

      // Step 1: delete existing rows for the same slots (upsert prep).
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

      // Step 2: insert fresh rows. For 'deactivate', insert with is_active=false so future reads skip them.
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
            ? `${writes.length} competitor row(s) written for company_id=${companyId}.`
            : `${writes.length} competitor row(s) deactivated for company_id=${companyId}.`,
      };
    },
  });
}
