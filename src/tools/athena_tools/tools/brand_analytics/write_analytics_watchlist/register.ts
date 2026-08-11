import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { neonPanelRequest } from '../../../../../clients/neonpanel-api';
import type { ToolExecutionContext, ToolRegistry, ToolSpecJson } from '../../../../types';
import {
  deactivateCompanyState,
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

type ExistingSlot = { created_at: string; created_by: string; last_run_at: string | null };

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

function slotKey(marketplaceId: string, watchlistName: string): string {
  return `${marketplaceId}\u0000${watchlistName.toLowerCase()}`;
}

/**
 * The state table is append-only, so an update re-inserts the whole row. Carry
 * the creation audit and the last_run_at stamp owned by
 * brand_analytics_run_watchlist forward instead of resetting them.
 */
async function loadExistingSlots(
  companyId: number,
  marketplaceIds: readonly string[],
): Promise<Map<string, ExistingSlot>> {
  const existing = new Map<string, ExistingSlot>();
  const uniqueMarketplaceIds = Array.from(new Set(marketplaceIds.filter(Boolean)));
  if (uniqueMarketplaceIds.length === 0) return existing;

  const result = await executeBrandAnalyticsQuery(
    `SELECT marketplace_id, watchlist_name, created_at, created_by, last_run_at\n` +
      `FROM ${STATE_TABLE} FINAL\n` +
      `WHERE company_id = ${companyId}\n` +
      `  AND marketplace_id IN (${uniqueMarketplaceIds.map(sqlStringLiteral).join(', ')})`,
  );

  for (const row of result.rows) {
    existing.set(slotKey(String(row.marketplace_id ?? ''), String(row.watchlist_name ?? '')), {
      created_at: String(row.created_at ?? ''),
      created_by: String(row.created_by ?? ''),
      last_run_at: row.last_run_at == null ? null : String(row.last_run_at),
    });
  }
  return existing;
}

export function registerBrandAnalyticsWriteAnalyticsWatchlistTool(registry: ToolRegistry) {
  const toolJsonPath = path.join(__dirname, 'tool.json');

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
        const deactivated = await deactivateCompanyState({
          table: STATE_TABLE,
          columns: STATE_COLUMNS,
          companyId,
          version: nowVersion(),
        });
        return {
          dry_run: false,
          action: 'reset',
          accepted: 0,
          written: 0,
          deactivated,
          message: `${deactivated} analytics watchlist row(s) for company_id=${companyId} have been deactivated.`,
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

      // Callers supply a country code; state rows key on the canonical Amazon
      // marketplace id so they stay joinable to the SQP/SCP contracts.
      const marketplaceIds = await resolveMarketplaceIds(writes.map((w) => w.marketplace));
      const unresolved = Array.from(
        new Set(
          writes
            .map((w) => w.marketplace.trim())
            .filter((m) => !marketplaceIds.has(m.toLowerCase())),
        ),
      );
      if (unresolved.length > 0) {
        return {
          dry_run: dryRun,
          action,
          accepted: 0,
          written: 0,
          error: `Unknown marketplace(s): ${unresolved.join(', ')}.`,
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

      const resolvedWrites = writes.map((w) => ({
        write: w,
        marketplaceId: marketplaceIds.get(w.marketplace.trim().toLowerCase()) ?? '',
      }));
      const existing = await loadExistingSlots(
        companyId,
        resolvedWrites.map((entry) => entry.marketplaceId),
      );

      // 'deactivate' writes a tombstone version of the same ORDER BY key instead
      // of deleting: SharedReplacingMergeTree(version) collapses to it.
      const isActive = action === 'write' ? 1 : 0;
      const version = nowVersion();
      await insertBrandAnalyticsState({
        table: STATE_TABLE,
        columns: STATE_COLUMNS,
        rows: resolvedWrites.map(({ write, marketplaceId }) => {
          const prior = existing.get(slotKey(marketplaceId, write.watchlist_name));
          return {
            company_id: companyId,
            marketplace_id: marketplaceId,
            watchlist_name: write.watchlist_name,
            grain: write.grain,
            entity_ids: write.entity_ids,
            cadence: write.cadence,
            focus: write.focus,
            owner: write.owner ?? '',
            last_run_at: prior?.last_run_at ?? null,
            is_active: isActive,
            created_at: prior?.created_at || version,
            updated_at: version,
            created_by: prior?.created_by || userId,
            updated_by: userId,
            notes: write.notes ?? '',
            version,
          };
        }),
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
