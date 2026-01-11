import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runAthenaQuery } from '../../../../clients/athena';
import { neonPanelRequest } from '../../../../clients/neonpanel-api';
import { config } from '../../../../config';
import type { ToolRegistry, ToolSpecJson } from '../../../types';
import { loadTextFile } from '../../runtime/load-assets';
import { renderSqlTemplate } from '../../runtime/render-sql';
import { buildItemPresentation } from '../../runtime/presentation';

type CompaniesWithPermissionResponse = {
  companies?: Array<{
    company_id?: number;
    companyId?: number;
    id?: number;
    uuid?: string;
    name?: string;
    short_name?: string;
  }>;
};

function toInt(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function sanitizeSnapshot(record: Record<string, unknown>): Record<string, unknown> {
  const snapshot: Record<string, unknown> = { ...record };

  // Drop Amazon-provided ship-by dates from the dataset output. They are often forward-looking
  // even when the item is overdue, which creates UX confusion.
  delete snapshot.recommended_ship_by_date;
  delete snapshot.recommended_ship_date;
  delete snapshot.recommendedShipByDate;
  delete snapshot.recommendedShipDate;

  // Rename Amazon-provided replenishment quantity for clarity.
  if (
    snapshot.recommended_by_amazon_replenishment_quantity === undefined &&
    snapshot.recommended_replenishment_qty !== undefined
  ) {
    snapshot.recommended_by_amazon_replenishment_quantity = snapshot.recommended_replenishment_qty;
    delete snapshot.recommended_replenishment_qty;
  }

  // Naming fix: this metric represents average *purchase* price.
  // The upstream snapshot column is average_item_price; expose as average_purchase_price.
  if (snapshot.average_purchase_price === undefined && snapshot.average_item_price !== undefined) {
    snapshot.average_purchase_price = snapshot.average_item_price;
  }
  if (snapshot.average_purchase_price === undefined && snapshot.averageItemPrice !== undefined) {
    snapshot.average_purchase_price = snapshot.averageItemPrice;
  }

  delete snapshot.average_item_price;
  delete snapshot.averageItemPrice;

  return snapshot;
}

function sqlEscapeString(value: string): string {
  return value.replace(/'/g, "''");
}

function sqlStringLiteral(value: string): string {
  return `'${sqlEscapeString(value)}'`;
}

function sqlCompanyIdArrayExpr(values: number[]): string {
  // Iceberg snapshot uses BIGINT company_id, so filter using ARRAY(BIGINT).
  if (values.length === 0) return 'CAST(ARRAY[] AS ARRAY(BIGINT))';
  return `CAST(ARRAY[${values.map((n) => String(Math.trunc(n))).join(',')}] AS ARRAY(BIGINT))`;
}

const inputSchema = z.object({
  sku: z.string().min(1).optional(),
  marketplace: z.enum(['US', 'UK']).optional(),
  company_id: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(25).default(5).optional(),
  debug: z.boolean().default(false).optional(),
});

export function registerSupplyChainInspectInventorySkuSnapshotTool(registry: ToolRegistry) {
  const toolJsonPath = path.join(__dirname, 'tool.json');
  const sqlPath = path.join(__dirname, 'query.sql');

  let specJson: ToolSpecJson | undefined;
  try {
    if (fs.existsSync(toolJsonPath)) {
      specJson = JSON.parse(fs.readFileSync(toolJsonPath, 'utf8')) as ToolSpecJson;
    }
  } catch {
    specJson = undefined;
  }

  registry.register({
    name: 'supply_chain_inspect_inventory_sku_snapshot',
    description: 'Inventory SKU deep dive (raw snapshot inspection) for a specific SKU + marketplace.',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);

      // Permission gate: use NeonPanel permission endpoint, then filter Athena by company_id.
      const permission = 'view:quicksight_group.business_planning_new';
      const permissionResponse = await neonPanelRequest<CompaniesWithPermissionResponse>({
        token: context.userToken,
        path: `/api/v1/permissions/${encodeURIComponent(permission)}/companies`,
      });

      const permittedCompanies = (permissionResponse.companies ?? []).filter(
        (c): c is { company_id?: number; companyId?: number; id?: number } => c !== null && typeof c === 'object',
      );

      const permittedCompanyIds = permittedCompanies
        .map((c) => c.company_id ?? c.companyId ?? c.id)
        .filter((id): id is number => typeof id === 'number' && Number.isFinite(id) && id > 0);

      const requestedCompanyIds = parsed.company_id ? [parsed.company_id] : permittedCompanyIds;
      const allowedCompanyIds = requestedCompanyIds.filter((id) => permittedCompanyIds.includes(id));

      const catalog = config.athena.catalog;
      const database = config.athena.database;
      const table = config.athena.tables.inventoryPlanningSnapshot;

      const limit = parsed.limit ?? 5;

      const includeDiagnostics = parsed.debug === true;

      // If auth yields no companies, return diagnostics (do not attempt Athena).
      if (permittedCompanyIds.length === 0 || allowedCompanyIds.length === 0) {
        return {
          items: [],
          diagnostics: {
            permitted_company_ids_count: permittedCompanyIds.length,
            allowed_company_ids: allowedCompanyIds.slice(0, 50),
          },
        };
      }

      const template = await loadTextFile(sqlPath);
      const query = renderSqlTemplate(template, {
        catalog,
        database,
        table,
        company_ids_array: sqlCompanyIdArrayExpr(allowedCompanyIds),
        sku_sql: sqlStringLiteral(parsed.sku ?? ''),
        marketplace_sql: sqlStringLiteral(parsed.marketplace ?? ''),
        apply_sku_filter_sql: parsed.sku ? 'TRUE' : 'FALSE',
        apply_marketplace_filter_sql: parsed.marketplace ? 'TRUE' : 'FALSE',
        limit_top_n: Number(limit),

        // Back-compat for older draft templates
        companyIdsSql: allowedCompanyIds.map((id) => sqlStringLiteral(String(id))).join(', '),
        topN: Number(limit),
      });

      const athenaResult = await runAthenaQuery({
        query,
        database,
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows: Math.min(2000, limit),
      });

      const rows = athenaResult.rows ?? [];
      const shouldComputeDiagnostics = includeDiagnostics || rows.length === 0;

      let diagnostics:
        | {
            permitted_company_ids_count: number;
            allowed_company_ids: number[];
            selected_snapshot_partition?: { year?: string; month?: string; day?: string };
            available_countries_for_sku?: string[];
            sample_row_present?: boolean;
            sample_country?: string;
          }
        | undefined;

      if (shouldComputeDiagnostics) {
        // 1) Determine selected snapshot partition for these allowed companies.
        const latestSnapshotQuery = renderSqlTemplate(
          `WITH params AS (
  SELECT {{company_ids_array}} AS company_ids
)
SELECT pil.year, pil.month, pil.day
FROM "{{catalog}}"."{{database}}"."{{table}}" pil
CROSS JOIN params p
WHERE contains(p.company_ids, pil.company_id)
GROUP BY 1, 2, 3
ORDER BY CAST(pil.year AS INTEGER) DESC, CAST(pil.month AS INTEGER) DESC, CAST(pil.day AS INTEGER) DESC
LIMIT 1`,
          {
            catalog,
            database,
            table,
            company_ids_array: sqlCompanyIdArrayExpr(allowedCompanyIds),
          },
        );

        const latestSnapshotResult = await runAthenaQuery({
          query: latestSnapshotQuery,
          database,
          workGroup: config.athena.workgroup,
          outputLocation: config.athena.outputLocation,
          maxRows: 5,
        });

        const latestRow = (latestSnapshotResult.rows ?? [])[0] as Record<string, unknown> | undefined;
        const selected_snapshot_partition = latestRow
          ? {
              year: (latestRow.year ?? undefined) as string | undefined,
              month: (latestRow.month ?? undefined) as string | undefined,
              day: (latestRow.day ?? undefined) as string | undefined,
            }
          : undefined;

        // 1b) Probe whether that partition has any rows for allowed companies (fast existence check).
        let sample_row_present: boolean | undefined;
        let sample_country: string | undefined;
        if (selected_snapshot_partition?.year && selected_snapshot_partition?.month && selected_snapshot_partition?.day) {
          const sampleRowQuery = renderSqlTemplate(
            `WITH params AS (
  SELECT
    {{company_ids_array}} AS company_ids,
    {{year_sql}} AS y,
    {{month_sql}} AS m,
    {{day_sql}} AS d
)
SELECT pil.country AS country
FROM "{{catalog}}"."{{database}}"."{{table}}" pil
CROSS JOIN params p
WHERE
  contains(p.company_ids, pil.company_id)
  AND pil.year = p.y AND pil.month = p.m AND pil.day = p.d
LIMIT 1`,
            {
              catalog,
              database,
              table,
              company_ids_array: sqlCompanyIdArrayExpr(allowedCompanyIds),
              year_sql: sqlStringLiteral(selected_snapshot_partition.year),
              month_sql: sqlStringLiteral(selected_snapshot_partition.month),
              day_sql: sqlStringLiteral(selected_snapshot_partition.day),
            },
          );

          const sampleRowResult = await runAthenaQuery({
            query: sampleRowQuery,
            database,
            workGroup: config.athena.workgroup,
            outputLocation: config.athena.outputLocation,
            maxRows: 5,
          });

          const sr = (sampleRowResult.rows ?? [])[0] as Record<string, unknown> | undefined;
          sample_row_present = !!sr;
          sample_country = (sr?.country ?? undefined) as string | undefined;
        }

        // 2) If we have a snapshot partition, list available countries for this SKU (ignoring marketplace filter).
        let available_countries_for_sku: string[] | undefined;
        if (
          parsed.sku &&
          selected_snapshot_partition?.year &&
          selected_snapshot_partition?.month &&
          selected_snapshot_partition?.day
        ) {
          const skuCountriesQuery = renderSqlTemplate(
            `WITH params AS (
  SELECT
    {{company_ids_array}} AS company_ids,
    UPPER(TRIM(regexp_replace({{sku_sql}}, '[‐‑‒–—−]', '-'))) AS sku_norm,
    {{year_sql}} AS y,
    {{month_sql}} AS m,
    {{day_sql}} AS d
)
SELECT DISTINCT pil.country AS country
FROM "{{catalog}}"."{{database}}"."{{table}}" pil
CROSS JOIN params p
WHERE
  contains(p.company_ids, pil.company_id)
  AND pil.year = p.y AND pil.month = p.m AND pil.day = p.d
  AND UPPER(TRIM(regexp_replace(pil.sku, '[‐‑‒–—−]', '-'))) = p.sku_norm
LIMIT 50`,
            {
              catalog,
              database,
              table,
              company_ids_array: sqlCompanyIdArrayExpr(allowedCompanyIds),
              sku_sql: sqlStringLiteral(parsed.sku),
              year_sql: sqlStringLiteral(selected_snapshot_partition.year),
              month_sql: sqlStringLiteral(selected_snapshot_partition.month),
              day_sql: sqlStringLiteral(selected_snapshot_partition.day),
            },
          );

          const skuCountriesResult = await runAthenaQuery({
            query: skuCountriesQuery,
            database,
            workGroup: config.athena.workgroup,
            outputLocation: config.athena.outputLocation,
            maxRows: 100,
          });

          available_countries_for_sku = (skuCountriesResult.rows ?? [])
            .map((r) => (r as Record<string, unknown>).country)
            .filter((c): c is string => typeof c === 'string' && c.length > 0);
        }

        diagnostics = {
          permitted_company_ids_count: permittedCompanyIds.length,
          allowed_company_ids: allowedCompanyIds.slice(0, 50),
          selected_snapshot_partition,
          available_countries_for_sku,
          sample_row_present,
          sample_country,
        };
      }

      const items = rows.map((row) => {
        const record = row as Record<string, unknown>;

        const item_ref = {
          company_id: toInt(record.company_id) ?? undefined,
          inventory_id: toInt(record.item_ref_inventory_id) ?? undefined,
          sku: (record.item_ref_sku ?? undefined) as string | undefined,
          asin: (record.item_ref_asin ?? undefined) as string | undefined,
          marketplace: (record.item_ref_marketplace ?? undefined) as 'US' | 'UK' | undefined,
          item_name: (record.item_ref_item_name ?? undefined) as string | undefined,
          item_icon_url: (record.item_ref_item_icon_url ?? undefined) as string | undefined,
        };

        const snapshot_partition = {
          year: (record.snapshot_year ?? record.year ?? undefined) as string | undefined,
          month: (record.snapshot_month ?? record.month ?? undefined) as string | undefined,
          day: (record.snapshot_day ?? record.day ?? undefined) as string | undefined,
        };

        const sales_forecast_scenario = {
          id: toInt(record.sales_forecast_scenario_id) ?? undefined,
          name: (record.sales_forecast_scenario_name ?? undefined) as string | undefined,
          uuid: (record.sales_forecast_scenario_uuid ?? undefined) as string | undefined,
        };

        return {
          item_ref,
          presentation: buildItemPresentation({
            sku: item_ref.sku,
            asin: item_ref.asin,
            inventory_id: item_ref.inventory_id,
            marketplace_code: item_ref.marketplace,
            image_url: item_ref.item_icon_url,
            image_source_field: 'item_ref.item_icon_url',
          }),
          sales_forecast_scenario,
          snapshot_partition,
          snapshot: sanitizeSnapshot(record),
        };
      });

      return diagnostics ? { items, diagnostics } : { items };
    },
  });
}
