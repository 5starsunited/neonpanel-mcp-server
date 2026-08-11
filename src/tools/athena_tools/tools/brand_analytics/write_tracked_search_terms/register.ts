import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { neonPanelRequest } from '../../../../../clients/neonpanel-api';
import type { ToolExecutionContext, ToolRegistry, ToolSpecJson } from '../../../../types';
import {
  deactivateCompanyState,
  insertBrandAnalyticsState,
  nowVersion,
  resolveMarketplaceIds,
} from '../_clickhouse';

type CompaniesWithPermissionResponse = {
  companies?: Array<{ company_id?: number; companyId?: number; id?: number }>;
};

const STATE_TABLE = 'analytics.ba_tracked_search_terms';
const STATE_COLUMNS = [
  'company_id',
  'marketplace_id',
  'asin',
  'parent_asin',
  'product_family',
  'keyword',
  'priority',
  'intent',
  'added_by',
  'added_at',
  'is_active',
  'notes',
  'version',
];

const writeItemSchema = z.object({
  marketplace: z.string().min(1).max(10),
  keyword: z.string().min(1).max(200),
  asin: z.string().max(20).nullable().optional(),
  parent_asin: z.string().max(20).nullable().optional(),
  product_family: z.string().max(200).nullable().optional(),
  priority: z.number().int().min(1).max(5).nullable().optional(),
  intent: z.enum(['defend', 'attack', 'evaluate', 'branded']).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

const inputSchema = z
  .object({
    company_id: z.coerce.number().int().min(1),
    reason: z.string().min(5),
    action: z.enum(['write', 'deactivate', 'reset']).default('write').optional(),
    dry_run: z.boolean().default(true).optional(),
    writes: z.array(writeItemSchema).min(1).max(200).optional(),
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

export function registerBrandAnalyticsWriteTrackedSearchTermsTool(registry: ToolRegistry) {
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
    name: specJson?.name ?? 'brand_analytics_write_tracked_search_terms',
    description:
      specJson?.description ??
      "Writes company-specific tracked search term entries (keyword cores).",
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
            message: `Dry run: would deactivate ALL tracked search term entries for company_id=${companyId}.`,
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
          message: `${deactivated} tracked search term entr(ies) for company_id=${companyId} have been deactivated.`,
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
          message: `Dry run: ${writes.length} tracked search term row(s) validated. Set dry_run=false to persist.`,
        };
      }

      // 'deactivate' writes a tombstone version of the same ORDER BY key instead
      // of deleting: SharedReplacingMergeTree(version) collapses to it.
      const isActive = action === 'write' ? 1 : 0;
      const version = nowVersion();
      await insertBrandAnalyticsState({
        table: STATE_TABLE,
        columns: STATE_COLUMNS,
        rows: writes.map((w) => ({
          company_id: companyId,
          marketplace_id: marketplaceIds.get(w.marketplace.trim().toLowerCase()) ?? '',
          asin: w.asin ?? '',
          parent_asin: w.parent_asin ?? '',
          product_family: w.product_family ?? '',
          keyword: w.keyword,
          // The column is UInt16, not nullable; 0 is the "unset" sentinel that
          // list_tracked_search_terms sorts last.
          priority: w.priority ?? 0,
          intent: w.intent ?? '',
          added_by: userId,
          added_at: version,
          is_active: isActive,
          notes: w.notes ?? '',
          version,
        })),
      });

      return {
        dry_run: false,
        action,
        accepted: writes.length,
        written: action === 'write' ? writes.length : 0,
        deactivated: action === 'deactivate' ? writes.length : 0,
        message:
          action === 'write'
            ? `${writes.length} tracked search term row(s) written for company_id=${companyId}.`
            : `${writes.length} tracked search term row(s) deactivated for company_id=${companyId}.`,
      };
    },
  });
}
