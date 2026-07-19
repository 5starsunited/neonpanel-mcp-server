import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  insertClickHouseJsonEachRow,
  runClickHouseQuery,
} from '../../../../../clients/clickhouse';
import { neonPanelRequest } from '../../../../../clients/neonpanel-api';
import { isAppError } from '../../../../../lib/errors';
import type { ToolExecutionContext, ToolRegistry, ToolSpecJson } from '../../../../types';

type CompaniesWithPermissionResponse = {
  companies?: Array<{ company_id?: number; companyId?: number; id?: number }>;
};

type ResolvedItem = {
  inventoryId: number;
  sku: string;
  marketplace: string;
  amazonMarketplaceId: string;
  countryCode: string;
};

function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlUInt64Array(values: number[]): string {
  return `[${values.map((value) => `toUInt64(${Math.trunc(value)})`).join(', ')}]`;
}

function pickFirstNonEmptyString(...candidates: Array<unknown>): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }
  return null;
}

function deriveAuthorName(
  authorNameInput: string | undefined,
  context: ToolExecutionContext,
): { value: string; source: string } {
  const fromInput = pickFirstNonEmptyString(authorNameInput);
  if (fromInput) return { value: fromInput, source: 'author.name' };

  const payload = (context.payload ?? {}) as Record<string, unknown>;
  const fromJwt = pickFirstNonEmptyString(
    payload.name,
    payload.preferred_username,
    payload.email,
    payload.upn,
    payload.nickname,
  );
  if (fromJwt) return { value: fromJwt, source: 'jwt' };

  const fromSub = pickFirstNonEmptyString(context.subject);
  if (fromSub) return { value: fromSub, source: 'sub' };
  return { value: 'unknown', source: 'unknown' };
}

const authorSchema = z
  .object({
    type: z.enum(['user', 'ai', 'system']).default('user'),
    name: z.string().optional(),
    id: z.string().optional(),
  })
  .strict()
  .superRefine((author, context) => {
    if (author.type === 'ai' && (author.name ?? '').trim().length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'author.name is required when author.type is "ai" (ask the user what name to record).',
      });
    }
  });

const writeItemSchema = z
  .object({
    inventory_id: z.coerce.number().int().min(1).optional(),
    sku: z.string().optional(),
    marketplace: z.string().optional(),
    sales_channel: z.string().optional(),
    scenario_uuid: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    forecast_period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    units_sold: z.coerce.number().finite().min(0),
    sales_amount: z.coerce.number().finite().min(0),
    currency: z.string().length(3),
    note: z.string().optional(),
  })
  .strict()
  .refine((write) => Boolean(write.inventory_id || (write.sku && write.marketplace)), {
    message: 'Each write must include inventory_id OR (sku + marketplace).',
  });

const inputSchema = z
  .object({
    company_id: z.coerce.number().int().min(1),
    author: authorSchema.optional(),
    reason: z.string().min(10),
    dry_run: z.boolean().default(true).optional(),
    write_mode: z.enum(['append', 'replace']).default('append').optional(),
    data_type: z.enum(['forecast', 'actual']).default('forecast').optional(),
    idempotency_key: z.string().optional(),
    debug_sql: z.boolean().optional(),
    writes: z.array(writeItemSchema).min(1).max(500),
  })
  .strict();

async function isAuthorizedForCompany(
  companyId: number,
  context: ToolExecutionContext,
): Promise<boolean> {
  const permission = 'view:quicksight_group.sales_and_marketing_new';
  const permissionResponse = await neonPanelRequest<CompaniesWithPermissionResponse>({
    token: context.userToken,
    path: `/api/v1/permissions/${encodeURIComponent(permission)}/companies`,
  });
  return (permissionResponse.companies ?? [])
    .map((company) => company.company_id ?? company.companyId ?? company.id)
    .some((id) => id === companyId);
}

function resolvedItemFromRow(row: Record<string, unknown>): ResolvedItem | null {
  const inventoryId = Number(row.inventory_id);
  const sku = String(row.sku ?? '').trim();
  const marketplace = String(row.requested_marketplace ?? row.marketplace ?? '').trim();
  const amazonMarketplaceId = String(row.amazon_marketplace_id ?? '').trim();
  const countryCode = String(row.country_code ?? '').trim();
  if (!Number.isFinite(inventoryId) || inventoryId <= 0) return null;
  if (!sku || !marketplace || !amazonMarketplaceId || !countryCode) return null;
  return {
    inventoryId: Math.trunc(inventoryId),
    sku,
    marketplace,
    amazonMarketplaceId,
    countryCode,
  };
}

async function resolveItemsByInventoryId(
  companyId: number,
  inventoryIds: number[],
): Promise<Map<number, ResolvedItem>> {
  if (inventoryIds.length === 0) return new Map();
  const result = await runClickHouseQuery({
    query: `
SELECT
  inventory_id,
  sku,
  market_country_code AS marketplace,
  amazon_marketplace_id,
  market_country_code AS country_code
FROM etl.sku_dimensions
WHERE company_id = toUInt64(${companyId})
  AND has(${sqlUInt64Array(inventoryIds)}, inventory_id)
FORMAT JSON`,
  });
  const resolved = new Map<number, ResolvedItem>();
  for (const row of result.rows) {
    const item = resolvedItemFromRow(row);
    if (item) resolved.set(item.inventoryId, item);
  }
  return resolved;
}

async function resolveItemsBySku(
  companyId: number,
  pairs: Array<{ sku: string; marketplace: string }>,
): Promise<Map<string, ResolvedItem>> {
  if (pairs.length === 0) return new Map();
  const values = pairs
    .map((pair) => `(${sqlStringLiteral(pair.sku)}, ${sqlStringLiteral(pair.marketplace)})`)
    .join(',\n    ');
  const result = await runClickHouseQuery({
    query: `
SELECT
  dimensions.inventory_id,
  dimensions.sku,
  requested.marketplace AS requested_marketplace,
  dimensions.amazon_marketplace_id,
  dimensions.market_country_code AS country_code
FROM etl.sku_dimensions AS dimensions
INNER JOIN VALUES(
  'sku String, marketplace String',
    ${values}
) AS requested
  ON lowerUTF8(trimBoth(dimensions.sku)) = lowerUTF8(trimBoth(requested.sku))
 AND (
   lowerUTF8(trimBoth(dimensions.market_country_code)) = lowerUTF8(trimBoth(requested.marketplace))
   OR lowerUTF8(trimBoth(dimensions.amazon_marketplace_id)) = lowerUTF8(trimBoth(requested.marketplace))
 )
WHERE dimensions.company_id = toUInt64(${companyId})
FORMAT JSON`,
  });
  const resolved = new Map<string, ResolvedItem>();
  for (const row of result.rows) {
    const item = resolvedItemFromRow(row);
    if (item) resolved.set(`${item.sku.toLowerCase()}|${item.marketplace.toLowerCase()}`, item);
  }
  return resolved;
}

const CLICKHOUSE_FORECAST_COLUMNS = [
  'amazon_marketplace_id',
  'currency',
  'sku',
  'company_id',
  'inventory_id',
  'forecast_period',
  'units_sold',
  'sales_amount',
  'dataset',
  'scenario_uuid',
  'calc_period',
  'data_type',
  'author_name',
  'updated_at',
  'sales_channel',
  'country_code',
] as const;

export function registerForecastingWriteSalesForecastTool(registry: ToolRegistry) {
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
    name: 'forecasting_write_sales_forecast',
    description: 'Validate and write forecast overrides directly to ClickHouse.',
    isConsequential: true,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const companyId = Math.trunc(parsed.company_id);
      const warnings: string[] = [];
      if (!(await isAuthorizedForCompany(companyId, context))) {
        return {
          dry_run: true,
          accepted: 0,
          written: 0,
          items: [],
          meta: { warnings: ['Not authorized for requested company_id.'] },
        };
      }

      const dryRun = parsed.dry_run ?? true;
      const writeMode = parsed.write_mode ?? 'append';
      const author = parsed.author ?? { type: 'user' as const };
      const derivedAuthor = deriveAuthorName(author.name, context);
      if (derivedAuthor.source !== 'author.name') {
        warnings.push(`author.name not provided; using ${derivedAuthor.source} for author_name.`);
      }
      warnings.push(
        'Audit metadata (reason, note, author_type, author_id, idempotency_key) is not persisted in the forecast table; author_name and updated_at are persisted.',
      );

      const inventoryIds = [...new Set(
        parsed.writes
          .map((write) => write.inventory_id)
          .filter((id): id is number => id !== undefined),
      )];
      const skuPairs = [...new Map(
        parsed.writes
          .filter((write) => !write.inventory_id && write.sku && write.marketplace)
          .map((write) => {
            const pair = { sku: write.sku!.trim(), marketplace: write.marketplace!.trim() };
            return [`${pair.sku.toLowerCase()}|${pair.marketplace.toLowerCase()}`, pair] as const;
          }),
      ).values()];

      let byInventoryId: Map<number, ResolvedItem>;
      let bySku: Map<string, ResolvedItem>;
      try {
        [byInventoryId, bySku] = await Promise.all([
          resolveItemsByInventoryId(companyId, inventoryIds),
          resolveItemsBySku(companyId, skuPairs),
        ]);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown ClickHouse error.';
        const details = isAppError(error) ? { code: error.code, details: error.details } : undefined;
        return {
          dry_run: true,
          accepted: parsed.writes.length,
          written: 0,
          items: [],
          meta: { warnings, error: { message, ...(details ? { details } : {}) } },
        };
      }

      const resolvedWrites = parsed.writes.map((write) => {
        if (write.inventory_id) return byInventoryId.get(write.inventory_id);
        const key = `${write.sku!.trim().toLowerCase()}|${write.marketplace!.trim().toLowerCase()}`;
        return bySku.get(key);
      });
      const items = parsed.writes.map((write, index) => {
        const resolved = resolvedWrites[index];
        return {
          status: resolved ? 'ok' : 'error',
          inventory_id: resolved?.inventoryId ?? write.inventory_id,
          sku: resolved?.sku ?? write.sku,
          marketplace: resolved?.marketplace ?? write.marketplace,
          forecast_period: write.forecast_period,
          scenario: { id: null, uuid: write.scenario_uuid, name: null },
          message: resolved
            ? dryRun ? 'Validated (dry run).' : 'Validated (ready to write).'
            : 'Validation failed: item was not found in the current ClickHouse inventory catalog.',
        };
      });
      const invalidRows = items.filter((item) => item.status === 'error');
      const accepted = parsed.writes.length;
      if (invalidRows.length > 0) {
        warnings.push(`Refusing to write: ${invalidRows.length} row(s) failed validation.`);
        return { dry_run: true, accepted, written: 0, items, meta: { warnings } };
      }
      if (dryRun) return { dry_run: true, accepted, written: 0, items, meta: { warnings } };

      const updatedAt = new Date().toISOString();
      const calcPeriod = updatedAt.slice(0, 7);
      const isActual = (parsed.data_type ?? 'forecast') === 'actual';
      const rows = parsed.writes.map((write, index) => {
        const resolved = resolvedWrites[index]!;
        return {
          amazon_marketplace_id: resolved.amazonMarketplaceId,
          currency: write.currency.toUpperCase(),
          sku: resolved.sku,
          company_id: companyId,
          inventory_id: resolved.inventoryId,
          forecast_period: write.forecast_period,
          units_sold: write.units_sold,
          sales_amount: write.sales_amount,
          dataset: isActual ? 'actual' : 'manual',
          scenario_uuid: isActual ? 'actual' : write.scenario_uuid,
          calc_period: calcPeriod,
          data_type: isActual ? 'actual' : 'forecast',
          author_name: derivedAuthor.value,
          updated_at: updatedAt,
          sales_channel: write.sales_channel?.trim() || 'Amazon',
          country_code: resolved.countryCode,
        };
      });

      try {
        await insertClickHouseJsonEachRow({
          table: 'analytics.sales_forecast',
          columns: [...CLICKHOUSE_FORECAST_COLUMNS],
          rows,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown ClickHouse error.';
        const details = isAppError(error) ? { code: error.code, details: error.details } : undefined;
        return {
          dry_run: false,
          accepted,
          written: 0,
          items,
          meta: { warnings, error: { message, ...(details ? { details } : {}) } },
        };
      }

      return {
        dry_run: false,
        accepted,
        written: rows.length,
        items: items.map((item) => ({ ...item, message: `Written (${writeMode}).` })),
        meta: { warnings },
      };
    },
  });
}
