import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { neonPanelRequest } from '../../../../../clients/neonpanel-api';
import type { ToolExecutionContext, ToolRegistry, ToolSpecJson } from '../../../../types';
import { deactivateCompanyState, insertBrandAnalyticsState, nowVersion } from '../_clickhouse';

type CompaniesWithPermissionResponse = {
  companies?: Array<{
    company_id?: number;
    companyId?: number;
    id?: number;
  }>;
};

const STATE_TABLE = 'analytics.ba_ryg_thresholds';
const STATE_COLUMNS = [
  'company_id',
  'user_id',
  'tool',
  'signal_group',
  'metric',
  'color',
  'threshold_value',
  'signal_code',
  'signal_description',
  'is_active',
  'version',
  'updated_at',
];

const writeItemSchema = z.object({
  tool: z.enum(['sqp', 'scp', 'global', 'growth_machine']),
  signal_group: z.enum([
    'strength',
    'weakness',
    'opportunity',
    'threshold',
    'ceiling',
    'diagnostic',
    'trend',
    'proven_winner',
    'bleeder',
    'cannibalization',
    'cart_leak',
    'weak_leader',
    'defend',
  ]),
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

export function registerBrandAnalyticsWriteRygThresholdsTool(registry: ToolRegistry) {
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
            message: `Dry run: would deactivate ALL threshold overrides for company_id=${companyId}.`,
          };
        }

        // Company overrides are deactivated, never deleted; the seeded defaults
        // carry company_id = NULL so they are untouched and take over again.
        const deleted = await deactivateCompanyState({
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
          deleted,
          message: `${deleted} threshold override(s) for company_id=${companyId} have been deactivated. System defaults now apply.`,
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

      // The table is a SharedReplacingMergeTree keyed on
      // (company_id, tool, signal_group, metric, color), so inserting a newer
      // version replaces the previous override for the same slot.
      const version = nowVersion();
      await insertBrandAnalyticsState({
        table: STATE_TABLE,
        columns: STATE_COLUMNS,
        rows: writes.map((w) => ({
          company_id: companyId,
          user_id: 'default',
          tool: w.tool,
          signal_group: w.signal_group,
          metric: w.metric,
          color: w.color,
          threshold_value: w.threshold_value,
          signal_code: w.signal_code,
          signal_description: w.signal_description,
          is_active: 1,
          version,
          updated_at: version,
        })),
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
