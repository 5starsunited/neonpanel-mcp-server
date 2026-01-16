import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runAthenaQuery } from '../../../../clients/athena';
import { neonPanelRequest } from '../../../../clients/neonpanel-api';
import { config } from '../../../../config';
import type { ToolExecutionContext, ToolRegistry, ToolSpecJson } from '../../../types';
import { loadTextFile } from '../../runtime/load-assets';
import { renderSqlTemplate } from '../../runtime/render-sql';

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

function sqlNullableVarcharExpr(value: string | null | undefined): string {
  if (value === null || value === undefined) return 'CAST(NULL AS VARCHAR)';
  const trimmed = String(value).trim();
  if (trimmed.length === 0) return 'CAST(NULL AS VARCHAR)';
  return sqlStringLiteral(trimmed);
}

function sqlNullableBigintExpr(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'CAST(NULL AS BIGINT)';
  if (!Number.isFinite(value)) return 'CAST(NULL AS BIGINT)';
  return String(Math.trunc(value));
}

function sqlNullableDoubleExpr(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'CAST(NULL AS DOUBLE)';
  if (!Number.isFinite(value)) return 'CAST(NULL AS DOUBLE)';
  return String(value);
}

function sqlBooleanLiteral(value: boolean): string {
  return value ? 'TRUE' : 'FALSE';
}

function sqlBigintArrayExpr(values: number[]): string {
  if (values.length === 0) return 'CAST(ARRAY[] AS ARRAY(BIGINT))';
  return `CAST(ARRAY[${values.map((n) => String(Math.trunc(n))).join(',')}] AS ARRAY(BIGINT))`;
}

function pickFirstNonEmptyString(...candidates: Array<unknown>): string | null {
  for (const c of candidates) {
    if (typeof c === 'string') {
      const t = c.trim();
      if (t.length > 0) return t;
    }
  }
  return null;
}

function deriveAuthorName(authorNameInput: string | undefined, context: ToolExecutionContext): { value: string; source: string } {
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
  .strict();

const writeItemSchema = z
  .object({
    inventory_id: z.coerce.number().int().min(1).optional(),
    sku: z.string().optional(),
    marketplace: z.string().optional(),

    scenario: z
      .object({
        id: z.coerce.number().int().min(1).optional(),
        uuid: z.string().optional(),
        name: z.string().optional(),
      })
      .strict()
      .optional(),

    forecast_period: z.string().min(1),
    units_sold: z.coerce.number().min(0),

    sales_amount: z.coerce.number().min(0).optional(),
    currency: z.string().optional(),

    note: z.string().optional(),
  })
  .strict()
  .refine((w) => (w.inventory_id ? true : Boolean(w.sku && w.marketplace)), {
    message: 'Each write must include inventory_id OR (sku + marketplace).',
  });

const inputSchema = z
  .object({
    company_id: z.coerce.number().int().min(1),
    author: authorSchema.optional(),
    reason: z.string().min(3),
    dry_run: z.boolean().default(true).optional(),
    idempotency_key: z.string().optional(),
    debug_sql: z.boolean().optional(),
    writes: z.array(writeItemSchema).min(1).max(500),
  })
  .strict();

function toBoolean(value: unknown): boolean {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === 'true' || v === '1' || v === 't' || v === 'yes' || v === 'y';
  }
  if (typeof value === 'number') return value !== 0;
  return false;
}

async function isAuthorizedForCompany(companyId: number, context: ToolExecutionContext): Promise<boolean> {
  const permission = 'view:quicksight_group.business_planning_new';
  const permissionResponse = await neonPanelRequest<CompaniesWithPermissionResponse>({
    token: context.userToken,
    path: `/api/v1/permissions/${encodeURIComponent(permission)}/companies`,
  });

  const permittedCompanyIds = (permissionResponse.companies ?? [])
    .map((c) => c.company_id ?? c.companyId ?? c.id)
    .filter((id): id is number => typeof id === 'number' && Number.isFinite(id) && id > 0);

  return permittedCompanyIds.includes(companyId);
}

function buildWritesValuesSql(writes: Array<z.infer<typeof writeItemSchema>>): string {
  // Must match the column order documented in query.sql.
  // inventory_id, sku, marketplace, scenario_id, scenario_uuid, scenario_name,
  // forecast_period, units_sold, sales_amount, currency, note
  return writes
    .map((w) => {
      const inventoryIdExpr = sqlNullableBigintExpr(w.inventory_id ?? null);
      const skuExpr = sqlNullableVarcharExpr(w.sku ?? null);
      const marketplaceExpr = sqlNullableVarcharExpr(w.marketplace ?? null);

      const scenarioIdExpr = sqlNullableBigintExpr(w.scenario?.id ?? null);
      const scenarioUuidExpr = sqlNullableVarcharExpr(w.scenario?.uuid ?? null);
      const scenarioNameExpr = sqlNullableVarcharExpr(w.scenario?.name ?? null);

      const forecastPeriodExpr = sqlNullableVarcharExpr(w.forecast_period);
      const unitsSoldExpr = sqlNullableDoubleExpr(w.units_sold);
      const salesAmountExpr = sqlNullableDoubleExpr(w.sales_amount ?? null);
      const currencyExpr = sqlNullableVarcharExpr(w.currency ?? null);
      const noteExpr = sqlNullableVarcharExpr(w.note ?? null);

      return `(${[
        inventoryIdExpr,
        skuExpr,
        marketplaceExpr,
        scenarioIdExpr,
        scenarioUuidExpr,
        scenarioNameExpr,
        forecastPeriodExpr,
        unitsSoldExpr,
        salesAmountExpr,
        currencyExpr,
        noteExpr,
      ].join(', ')})`;
    })
    .join(',\n      ');
}

async function resolveSkuAndMarketplaceFromSnapshot(
  companyId: number,
  inventoryIds: number[],
): Promise<Map<number, { sku: string; marketplace: string }>> {
  if (inventoryIds.length === 0) return new Map();

  const catalog = config.athena.catalog;
  const database = config.athena.database;
  const table = config.athena.tables.inventoryPlanningSnapshot;

  const query = `
WITH params AS (
  SELECT
    CAST(${companyId} AS BIGINT) AS company_id,
    ${sqlBigintArrayExpr(inventoryIds)} AS inventory_ids
),
latest_snapshot AS (
  SELECT pil.year, pil.month, pil.day
  FROM "${catalog}"."${database}"."${table}" pil
  CROSS JOIN params p
  WHERE pil.company_id = p.company_id
  GROUP BY 1, 2, 3
  ORDER BY CAST(pil.year AS INTEGER) DESC, CAST(pil.month AS INTEGER) DESC, CAST(pil.day AS INTEGER) DESC
  LIMIT 1
)
SELECT
  pil.inventory_id,
  pil.sku,
  pil.country_code AS marketplace
FROM "${catalog}"."${database}"."${table}" pil
CROSS JOIN params p
CROSS JOIN latest_snapshot s
WHERE
  pil.company_id = p.company_id
  AND pil.year = s.year AND pil.month = s.month AND pil.day = s.day
  AND contains(p.inventory_ids, pil.inventory_id)
`;

  const res = await runAthenaQuery({
    query,
    database,
    workGroup: config.athena.workgroup,
    outputLocation: config.athena.outputLocation,
    maxRows: Math.min(1000, inventoryIds.length + 5),
  });

  const m = new Map<number, { sku: string; marketplace: string }>();
  for (const row of res.rows ?? []) {
    const idRaw = row.inventory_id;
    const id = idRaw === null ? NaN : Number(idRaw);
    const sku = (row.sku ?? '') as string;
    const marketplace = (row.marketplace ?? '') as string;
    if (!Number.isFinite(id) || id <= 0) continue;
    if (typeof sku !== 'string' || sku.trim().length === 0) continue;
    if (typeof marketplace !== 'string' || marketplace.trim().length === 0) continue;
    m.set(Math.trunc(id), { sku: sku.trim(), marketplace: marketplace.trim() });
  }
  return m;
}

export function registerForecastingWriteSalesForecastTool(registry: ToolRegistry) {
  const toolJsonPath = path.join(__dirname, 'tool.json');
  const sqlPath = path.join(__dirname, 'query.sql');
  const insertSqlPath = path.join(__dirname, 'insert.sql');

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
    description: 'Write forecast overrides to an Iceberg table (dry-run validation supported).',
    isConsequential: true,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const companyId = Math.trunc(parsed.company_id);

      const warnings: string[] = [];

      const authorized = await isAuthorizedForCompany(companyId, context);
      if (!authorized) {
        return {
          dry_run: true,
          accepted: 0,
          written: 0,
          items: [],
          meta: { warnings: ['Not authorized for requested company_id.'] },
        };
      }

      const dryRun = parsed.dry_run ?? true;

      const author = parsed.author ?? { type: 'user' as const };
      const derived = deriveAuthorName(author.name, context);
      const resolvedAuthorName = derived.value;
      if (derived.source !== 'author.name') {
        warnings.push(`author.name not provided; using ${derived.source} for author_name.`);
      }

      // The target schema (fc_sales_forecast_iceberg) does not have these fields.
      warnings.push(
        'Note: reason/note/author_type/author_id/idempotency_key are not persisted in the target forecast table schema; only author_name and updated_at are written for audit.',
      );

      // Resolve inventory_id-only writes to include sku + marketplace (required by the forecast table schema).
      const writes = parsed.writes.map((w) => ({
        ...w,
        sku: w.sku ? w.sku.trim() : w.sku,
        marketplace: w.marketplace ? w.marketplace.trim() : w.marketplace,
      }));

      const unresolvedInventoryIds = writes
        .filter((w) => w.inventory_id && (!w.sku || !w.marketplace))
        .map((w) => Math.trunc(Number(w.inventory_id)))
        .filter((id) => Number.isFinite(id) && id > 0);

      const resolutionMap = await resolveSkuAndMarketplaceFromSnapshot(companyId, unresolvedInventoryIds);
      for (const w of writes) {
        if (w.inventory_id && (!w.sku || !w.marketplace)) {
          const key = Math.trunc(Number(w.inventory_id));
          const resolved = resolutionMap.get(key);
          if (resolved) {
            w.sku = resolved.sku;
            w.marketplace = resolved.marketplace;
          } else {
            warnings.push(`Could not resolve sku/marketplace for inventory_id=${key} from latest snapshot.`);
          }
        }
      }

      const template = await loadTextFile(sqlPath);
      const writesValuesSql = buildWritesValuesSql(writes as any);

      const debugSql = parsed.debug_sql === true;

      const rendered = renderSqlTemplate(template, {
        forecast_catalog: config.athena.catalog,
        forecast_database: config.athena.tables.forecastingDatabase,
        company_id: companyId,
        dry_run_sql: sqlBooleanLiteral(dryRun),
        reason_sql: sqlStringLiteral(parsed.reason),

        author_type_sql: sqlStringLiteral(author.type),
        author_name_sql: sqlStringLiteral(resolvedAuthorName),
        author_id_sql: sqlNullableVarcharExpr(author.id ?? null),

        idempotency_key_sql: sqlNullableVarcharExpr(parsed.idempotency_key ?? null),

        writes_values_sql: writesValuesSql,
      });

      const athenaResult = await runAthenaQuery({
        query: rendered,
        database: config.athena.database,
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows: 500,
      });

      const previewRows = (athenaResult.rows ?? []) as Array<Record<string, unknown>>;

      const invalidRows = previewRows.filter((r) => {
        const okForecastPeriod = toBoolean(r.ok_forecast_period);
        const okUnitsSold = toBoolean(r.ok_units_sold);
        const okSalesAmount = toBoolean(r.ok_sales_amount);
        const okItemSelector = toBoolean(r.ok_item_selector);
        return !(okForecastPeriod && okUnitsSold && okSalesAmount && okItemSelector);
      });

      const writableRows = previewRows.length - invalidRows.length;

      if (!dryRun && invalidRows.length > 0) {
        warnings.push(`Refusing to write: ${invalidRows.length} row(s) failed validation.`);
      }

      const items = previewRows.map((r) => {
        const okForecastPeriod = toBoolean(r.ok_forecast_period);
        const okUnitsSold = toBoolean(r.ok_units_sold);
        const okSalesAmount = toBoolean(r.ok_sales_amount);
        const okItemSelector = toBoolean(r.ok_item_selector);

        const problems: string[] = [];
        if (!okForecastPeriod) problems.push('invalid forecast_period');
        if (!okUnitsSold) problems.push('invalid units_sold');
        if (!okSalesAmount) problems.push('invalid sales_amount');
        if (!okItemSelector) problems.push('missing item selector');

        const status = problems.length === 0 ? 'ok' : 'error';

        return {
          status,
          inventory_id: r.inventory_id,
          sku: r.sku,
          marketplace: r.marketplace,
          forecast_period: r.forecast_period,
          scenario: {
            id: r.scenario_id,
            uuid: r.scenario_uuid,
            name: r.scenario_name,
          },
          message:
            problems.length > 0
              ? `Validation failed: ${problems.join(', ')}.`
              : dryRun
                ? 'Validated (dry run).'
                : 'Validated (ready to write).',
        };
      });

      const accepted = parsed.writes.length;

      if (!dryRun) {
        if (invalidRows.length > 0) {
          return {
            dry_run: true,
            accepted,
            written: 0,
            items,
            meta: {
              warnings,
              ...(debugSql ? { debug: { rendered_sql: rendered } } : {}),
            },
          };
        }

        const insertTemplate = await loadTextFile(insertSqlPath);
        const insertRendered = renderSqlTemplate(insertTemplate, {
          forecast_catalog: config.athena.catalog,
          forecast_database: config.athena.tables.forecastingDatabase,
          forecast_table_sales_forecast_writes: config.athena.tables.salesForecastWrites,

          company_id: companyId,
          author_name_sql: sqlStringLiteral(resolvedAuthorName),

          writes_values_sql: writesValuesSql,
        });

        // Execute INSERT. Athena returns an execution id; result rows are ignored.
        await runAthenaQuery({
          query: insertRendered,
          database: config.athena.tables.forecastingDatabase,
          workGroup: config.athena.workgroup,
          outputLocation: config.athena.outputLocation,
          maxRows: 1,
        });

        return {
          dry_run: false,
          accepted,
          written: writableRows,
          items: items.map((it) => ({
            ...it,
            message: it.status === 'ok' ? 'Written (append-only).' : it.message,
          })),
          meta: {
            warnings,
            ...(debugSql ? { debug: { rendered_sql: rendered } } : {}),
          },
        };
      }

      return {
        dry_run: dryRun,
        accepted,
        written: 0,
        items,
        meta: {
          warnings,
          ...(debugSql ? { debug: { rendered_sql: rendered } } : {}),
        },
      };
    },
  });
}
