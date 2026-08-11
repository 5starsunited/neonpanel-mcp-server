import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { neonPanelRequest } from '../../../../../clients/neonpanel-api';
import type { ToolExecutionContext, ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';
import {
  executeBrandAnalyticsQuery,
  insertBrandAnalyticsState,
  nowVersion,
  resolveMarketplaceIds,
  sqlStringLiteral,
} from '../_clickhouse';

type CompaniesWithPermissionResponse = {
  companies?: Array<{ company_id?: number; companyId?: number; id?: number }>;
};

const STATE_TABLE = 'analytics.ba_analytics_watchlist';
const STATE_COLUMNS = [
  'company_id',
  'marketplace_id',
  'watchlist_name',
  'grain',
  'entity_ids',
  'cadence',
  'focus',
  'owner',
  'last_run_at',
  'is_active',
  'created_at',
  'updated_at',
  'created_by',
  'updated_by',
  'notes',
  'version',
];

const inputSchema = z
  .object({
    company_id: z.coerce.number().int().min(1),
    marketplace: z.string().min(1).max(20),
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
  // Defensive: entity_ids is Array(String) in ClickHouse and arrives as a real
  // array, but tolerate a bracketed or comma-separated string too.
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

      // Callers supply a country code; state rows key on the canonical Amazon
      // marketplace id, so resolve before looking the watchlist up.
      const marketplaceIds = await resolveMarketplaceIds([marketplace]);
      const marketplaceId = marketplaceIds.get(marketplace.trim().toLowerCase());
      if (!marketplaceId) {
        return {
          dry_run: dryRun,
          found: false,
          watchlist: null,
          diagnosis_parameters: null,
          last_run_at_updated: false,
          error: `Unknown marketplace: ${marketplace}.`,
        };
      }

      const selectTemplate = await loadTextFile(selectSqlPath);
      const selectSql = renderSqlTemplate(selectTemplate, {
        company_id: companyId,
        marketplace_id_literal: sqlStringLiteral(marketplaceId),
        watchlist_name_literal_lower: sqlStringLiteral(watchlistName.toLowerCase()),
      });
      const selectResult = await executeBrandAnalyticsQuery(selectSql);
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

      // The state table is append-only SharedReplacingMergeTree(version), so
      // bumping last_run_at means re-inserting the whole row with a newer
      // version rather than issuing an UPDATE. Every column not being changed
      // is carried over from the row just read.
      const stateRow = row as Record<string, unknown>;
      const version = nowVersion();
      await insertBrandAnalyticsState({
        table: STATE_TABLE,
        columns: STATE_COLUMNS,
        rows: [
          {
            company_id: companyId,
            marketplace_id: marketplaceId,
            watchlist_name: String(stateRow.watchlist_name ?? watchlistName),
            grain: String(stateRow.grain ?? ''),
            entity_ids: entityIds,
            cadence: String(stateRow.cadence ?? ''),
            focus: String(stateRow.focus ?? ''),
            owner: String(stateRow.owner ?? ''),
            last_run_at: version,
            is_active: 1,
            created_at: String(stateRow.created_at ?? version),
            updated_at: version,
            created_by: String(stateRow.created_by ?? userId),
            updated_by: userId,
            notes: String(stateRow.notes ?? ''),
            version,
          },
        ],
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
