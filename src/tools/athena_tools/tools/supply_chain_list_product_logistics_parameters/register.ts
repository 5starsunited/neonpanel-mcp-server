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

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function toStringValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const s = String(value).trim();
  return s.length > 0 ? s : undefined;
}

function getRowValue(row: Record<string, unknown>, key: string): unknown {
  return row[key];
}

const inputSchema = z
  .object({
    inventory_ids: z.array(z.number().int().min(1)).optional(),
    sku: z.string().min(1).optional(),
    company_id: z.number().int().min(1).optional(),
    limit: z.number().int().min(1).max(2000).default(200).optional(),
  })
  .superRefine((value, ctx) => {
    const inventoryIdCount = value.inventory_ids?.length ?? 0;
    const hasInventoryIds = inventoryIdCount > 0;
    const sku = value.sku?.trim() ?? '';
    const hasSku = sku.length > 0;

    if (hasInventoryIds && hasSku) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either inventory_ids OR (sku + company_id), not both.',
      });
      return;
    }
    if (!hasInventoryIds && !hasSku) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide inventory_ids OR (sku + company_id).',
      });
      return;
    }
    if (hasSku && !value.company_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'company_id is required when using sku.',
        path: ['company_id'],
      });
    }
  });

function sqlEscapeString(value: string): string {
  return value.replace(/'/g, "''");
}

function sqlStringLiteral(value: string): string {
  return `'${sqlEscapeString(value)}'`;
}

function sqlBigintArrayExpr(values: number[]): string {
  if (values.length === 0) return 'CAST(ARRAY[] AS ARRAY(BIGINT))';
  return `CAST(ARRAY[${values.map((n) => String(Math.trunc(n))).join(',')}] AS ARRAY(BIGINT))`;
}

function sqlCompanyIdArrayExpr(values: number[]): string {
  // Iceberg snapshot uses BIGINT company_id, so filter using ARRAY(BIGINT).
  if (values.length === 0) return 'CAST(ARRAY[] AS ARRAY(BIGINT))';
  return `CAST(ARRAY[${values.map((n) => String(Math.trunc(n))).join(',')}] AS ARRAY(BIGINT))`;
}

export function registerSupplyChainListProductLogisticsParametersTool(registry: ToolRegistry) {
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
    name: 'supply_chain_list_product_logistics_parameters',
    description: 'List product logistics parameters (vendor/spec/dimensions/case pack/MOQ) from the latest snapshot.',
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
        (c): c is { company_id?: number; companyId?: number; id?: number; name?: string; short_name?: string } =>
          c !== null && typeof c === 'object',
      );

      const permittedCompanyIds = permittedCompanies
        .map((c) => c.company_id ?? c.companyId ?? c.id)
        .filter((id): id is number => typeof id === 'number' && Number.isFinite(id) && id > 0);

      const requestedCompanyIds = parsed.company_id ? [parsed.company_id] : permittedCompanyIds;
      const allowedCompanyIds = requestedCompanyIds.filter((id) => permittedCompanyIds.includes(id));

      if (permittedCompanyIds.length === 0 || allowedCompanyIds.length === 0) {
        return { items: [] };
      }

      const catalog = config.athena.catalog;
      const database = config.athena.database;
      const table = config.athena.tables.inventoryPlanningSnapshot;

      const inventoryIds = parsed.inventory_ids ?? [];
      const hasInventoryIds = inventoryIds.length > 0;
      const sku = parsed.sku?.trim() ?? '';
      const hasSku = sku.length > 0;

      const applyInventoryIdsFilter = hasInventoryIds;
      const applySkuFilter = !hasInventoryIds && hasSku;

      const baseLimit = parsed.limit ?? 200;
      const effectiveLimit = Math.min(2000, Math.max(baseLimit, hasInventoryIds ? inventoryIds.length : 0));

      const template = await loadTextFile(sqlPath);
      const query = renderSqlTemplate(template, {
        catalog,
        database,
        table,
        company_ids_array: sqlCompanyIdArrayExpr(allowedCompanyIds),
        inventory_ids_array: sqlBigintArrayExpr(inventoryIds),
        sku_sql: sqlStringLiteral(applySkuFilter ? sku : ''),
        apply_inventory_ids_filter_sql: applyInventoryIdsFilter ? 'TRUE' : 'FALSE',
        apply_sku_filter_sql: applySkuFilter ? 'TRUE' : 'FALSE',
        limit_top_n: Number(effectiveLimit),
      });

      const athenaResult = await runAthenaQuery({
        query,
        database,
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows: effectiveLimit,
      });

      const items = (athenaResult.rows ?? []).map((row) => {
        const record = row;

        const item_ref = {
          inventory_id: toInt(getRowValue(record, 'item_ref_inventory_id')) ?? undefined,
          sku: (getRowValue(record, 'item_ref_sku') ?? undefined) as string | undefined,
          asin: (getRowValue(record, 'item_ref_asin') ?? undefined) as string | undefined,
          marketplace: (getRowValue(record, 'item_ref_marketplace') ?? undefined) as 'US' | 'UK' | undefined,
          item_name: (getRowValue(record, 'item_ref_item_name') ?? undefined) as string | undefined,
          item_icon_url: (getRowValue(record, 'item_ref_item_icon_url') ?? undefined) as string | undefined,
        };

        const product_spec =
          toStringValue(getRowValue(record, 'vendor_product_specs')) ??
          toStringValue(getRowValue(record, 'product_spec')) ??
          toStringValue(getRowValue(record, 'vendor_product_spec'));

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

          company_id: toInt(getRowValue(record, 'company_id')) ?? undefined,
          vendor: toStringValue(getRowValue(record, 'vendor')) ?? toStringValue(getRowValue(record, 'vendor_name')),
          brand: toStringValue(getRowValue(record, 'brand')),
          product_family: toStringValue(getRowValue(record, 'product_family')),
          product_spec,
          optional_product_code: toStringValue(getRowValue(record, 'optional_product_code')),
          optional_product_code_type: toStringValue(getRowValue(record, 'optional_product_code_type')),

          product_weight: toNumber(getRowValue(record, 'product_weight')) ?? undefined,
          product_length: toNumber(getRowValue(record, 'product_length')) ?? undefined,
          product_depth: toNumber(getRowValue(record, 'product_depth')) ?? undefined,
          product_height: toNumber(getRowValue(record, 'product_height')) ?? undefined,
          length_and_girth: toNumber(getRowValue(record, 'length_and_girth')) ?? undefined,

          box_quantity: toInt(getRowValue(record, 'box_quantity')) ?? undefined,
          box_length: toNumber(getRowValue(record, 'box_length')) ?? undefined,
          box_depth: toNumber(getRowValue(record, 'box_depth')) ?? undefined,
          box_height: toNumber(getRowValue(record, 'box_height')) ?? undefined,
          box_weight: toNumber(getRowValue(record, 'box_weight')) ?? undefined,
          moq: toInt(getRowValue(record, 'moq')) ?? undefined,

          snapshot_year: toStringValue(getRowValue(record, 'snapshot_year')),
          snapshot_month: toStringValue(getRowValue(record, 'snapshot_month')),
          snapshot_day: toStringValue(getRowValue(record, 'snapshot_day')),
        };
      });

      return { items };
    },
  });
}
