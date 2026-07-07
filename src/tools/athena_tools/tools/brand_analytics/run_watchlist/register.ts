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

function sqlString(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

const inputSchema = z
  .object({
    company_id: z.coerce.number().int().min(1),
    marketplace: z.string().min(1).max(10),
    watchlist_name: z.string().min(1).max(200),
    dry_run: z.boolean().default(true).optional(),
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

function cadenceLookbackDays(cadence: string | undefined): number {
  switch (cadence) {
    case 'weekly':
      return 7;
    case 'monthly':
      return 30;
    case 'quarterly':
      return 90;
    default:
      return 30;
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function parseEntityIds(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).filter((s) => s.length > 0);
  if (typeof raw !== 'string') return [];
  const s = raw.trim();
  if (s.length === 0) return [];
  // Athena array output often looks like "[a, b, c]".
  if (s.startsWith('[') && s.endsWith(']')) {
    return s
      .slice(1, -1)
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }
  return s.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
}

export function registerBrandAnalyticsRunWatchlistTool(registry: ToolRegistry) {
  const toolJsonPath = path.join(__dirname, 'tool.json');
  const selectSqlPath = path.join(__dirname, 'select.sql');
  const touchSqlPath = path.join(__dirname, 'touch_last_run.sql');

  let specJson: ToolSpecJson | undefined;
  try {
    if (fs.existsSync(toolJsonPath)) {
      specJson = JSON.parse(fs.readFileSync(toolJsonPath, 'utf8')) as ToolSpecJson;
    }
  } catch {
    specJson = undefined;
  }

  registry.register({
    name: specJson?.name ?? 'brand_analytics_run_watchlist',
    description:
      specJson?.description ??
      'Expands a saved analytics watchlist into diagnosis parameters and bumps last_run_at.',
    isConsequential: true,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const { company_id: companyId, marketplace, watchlist_name: watchlistName } = parsed;
      const dryRun = parsed.dry_run !== false;
      const catalog = config.athena.catalog;
      const userId = context.subject ?? 'unknown';

      const authorized = await isAuthorizedForCompany(companyId, context);
      if (!authorized) {
        return {
          dry_run: dryRun,
          found: false,
          watchlist: null,
          diagnosis_parameters: null,
          last_run_at_updated: false,
          error: 'Not authorized for this company.',
        };
      }

      const selectTemplate = await loadTextFile(selectSqlPath);
      const selectSql = renderSqlTemplate(selectTemplate, {
        catalog,
        company_id: companyId,
        marketplace_literal: sqlString(marketplace),
        watchlist_name_literal_lower: sqlString(watchlistName.toLowerCase()),
      });
      const selectResult = await runAthenaQuery({
        query: selectSql,
        database: 'brand_analytics_iceberg',
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows: 1,
      });
      const row = (selectResult.rows ?? [])[0];
      if (!row) {
        return {
          dry_run: dryRun,
          found: false,
          watchlist: null,
          diagnosis_parameters: null,
          last_run_at_updated: false,
          message: `No active watchlist found for company_id=${companyId}, marketplace=${marketplace}, watchlist_name='${watchlistName}'.`,
        };
      }

      const grain = (row as Record<string, unknown>).grain as string | undefined;
      const cadence = (row as Record<string, unknown>).cadence as string | undefined;
      const focus = (row as Record<string, unknown>).focus as string | undefined;
      const entityIds = parseEntityIds((row as Record<string, unknown>).entity_ids);
      const lookback = cadenceLookbackDays(cadence);

      const diagnosisParameters = {
        company_id: companyId,
        marketplace,
        grain: grain ?? 'child_asin',
        entity_ids: entityIds,
        focus: focus ?? 'growth_machine',
        period_start: daysAgoIso(lookback),
        period_end: todayIso(),
        use_tracked_search_terms: true,
        use_competitor_registry: true,
      };

      if (dryRun) {
        return {
          dry_run: true,
          found: true,
          watchlist: row,
          diagnosis_parameters: diagnosisParameters,
          last_run_at_updated: false,
          message: `Dry run: watchlist resolved. Set dry_run=false to bump last_run_at.`,
        };
      }

      const touchTemplate = await loadTextFile(touchSqlPath);
      const touchSql = renderSqlTemplate(touchTemplate, {
        catalog,
        company_id: companyId,
        marketplace_literal: sqlString(marketplace),
        watchlist_name_literal_lower: sqlString(watchlistName.toLowerCase()),
        updated_by_literal: sqlString(userId),
      });
      await runAthenaQuery({
        query: touchSql,
        database: 'brand_analytics_iceberg',
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows: 0,
      });

      return {
        dry_run: false,
        found: true,
        watchlist: row,
        diagnosis_parameters: diagnosisParameters,
        last_run_at_updated: true,
        message: `Watchlist '${watchlistName}' executed: last_run_at bumped. Feed diagnosis_parameters to brand_analytics_growth_machine_diagnosis.`,
      };
    },
  });
}
