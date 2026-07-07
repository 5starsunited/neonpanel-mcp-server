import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runAthenaQuery } from '../../../../../clients/athena';
import { neonPanelRequest } from '../../../../../clients/neonpanel-api';
import { config } from '../../../../../config';
import type { ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';
import { buildItemPresentation } from '../../../runtime/presentation';

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

function toFloat(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function sqlEscapeString(value: string): string {
  return value.replace(/'/g, "''");
}

function sqlStringLiteral(value: string): string {
  return `'${sqlEscapeString(value)}'`;
}

function sqlCompanyIdArrayExpr(values: number[]): string {
  if (values.length === 0) return 'CAST(ARRAY[] AS ARRAY(BIGINT))';
  return `CAST(ARRAY[${values.map((n) => String(Math.trunc(n))).join(',')}] AS ARRAY(BIGINT))`;
}

function sqlVarcharArrayExpr(values: string[]): string {
  if (values.length === 0) return 'CAST(ARRAY[] AS ARRAY(VARCHAR))';
  return `CAST(ARRAY[${values.map(sqlStringLiteral).join(',')}] AS ARRAY(VARCHAR))`;
}

const inputSchema = z.object({
  company_id: z.number().int().min(1).optional(),
  marketplace: z.enum(['US', 'UK']).optional(),
  asin: z.array(z.string().min(1)).max(50).optional(),
  parent_asin: z.array(z.string().min(1)).max(20).optional(),
  sku: z.array(z.string().min(1)).max(50).optional(),
  brand: z.string().min(1).optional(),
  product_family: z.string().min(1).optional(),
  include_siblings: z.boolean().default(true).optional(),
  limit: z.number().int().min(1).max(200).default(50).optional(),
  debug: z.boolean().default(false).optional(),
});

export function registerAccountLookupAsinCatalogTool(registry: ToolRegistry) {
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
    name: 'account_lookup_asin_catalog',
    description:
      'ASIN catalog lookup & parent-child mapping. Resolves parent ↔ child ASIN relationships, SKU ↔ ASIN mapping, and product attributes.',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);

      // Permission gate - broad permissions since this is a cross-domain utility
      const permissions = [
        'view:quicksight_group.inventory_management_new',
        'view:quicksight_group.finance-new',
      ];

      const allPermittedCompanyIds = new Set<number>();
      for (const permission of permissions) {
        try {
          const permissionResponse = await neonPanelRequest<CompaniesWithPermissionResponse>({
            token: context.userToken,
            path: `/api/v1/permissions/${encodeURIComponent(permission)}/companies`,
          });

          const permittedCompanies = (permissionResponse.companies ?? []).filter(
            (c): c is { company_id?: number; companyId?: number; id?: number } =>
              c !== null && typeof c === 'object',
          );

          permittedCompanies.forEach((c) => {
            const id = c.company_id ?? c.companyId ?? c.id;
            if (typeof id === 'number' && Number.isFinite(id) && id > 0) {
              allPermittedCompanyIds.add(id);
            }
          });
        } catch {
          // Continue if one permission check fails
        }
      }

      const permittedCompanyIds = Array.from(allPermittedCompanyIds);
      const requestedCompanyIds = parsed.company_id ? [parsed.company_id] : permittedCompanyIds;
      const allowedCompanyIds = requestedCompanyIds.filter((id) => permittedCompanyIds.includes(id));

      if (permittedCompanyIds.length === 0 || allowedCompanyIds.length === 0) {
        return {
          items: [],
          total_rows: 0,
          diagnostics: {
            error: 'No authorized companies found.',
            permitted_company_ids_count: permittedCompanyIds.length,
          },
        };
      }

      // Require at least one lookup filter to avoid full table scans
      const hasFilter =
        (parsed.asin && parsed.asin.length > 0) ||
        (parsed.parent_asin && parsed.parent_asin.length > 0) ||
        (parsed.sku && parsed.sku.length > 0) ||
        parsed.brand ||
        parsed.product_family;

      if (!hasFilter) {
        return {
          items: [],
          total_rows: 0,
          error:
            'At least one filter is required: asin, parent_asin, sku, brand, or product_family. This prevents full catalog scans.',
        };
      }

      const catalog = config.athena.catalog;
      const limit = parsed.limit ?? 50;
      const includeSiblings = parsed.include_siblings !== false;

      // Build marketplace filter clause (injected into SQL template)
      const marketplaceFilterClause = parsed.marketplace
        ? `AND UPPER(TRIM(s.country_code)) = ${sqlStringLiteral(parsed.marketplace.toUpperCase())}`
        : '';

      const template = await loadTextFile(sqlPath);
      const query = renderSqlTemplate(template, {
        catalog,
        company_ids_array: sqlCompanyIdArrayExpr(allowedCompanyIds),
        asin_array: sqlVarcharArrayExpr(parsed.asin ?? []),
        parent_asin_array: sqlVarcharArrayExpr(parsed.parent_asin ?? []),
        sku_array: sqlVarcharArrayExpr(parsed.sku ?? []),
        brand_sql: sqlStringLiteral(parsed.brand ?? ''),
        product_family_sql: sqlStringLiteral(parsed.product_family ?? ''),
        apply_asin_filter: parsed.asin && parsed.asin.length > 0 ? 'TRUE' : 'FALSE',
        apply_parent_asin_filter: parsed.parent_asin && parsed.parent_asin.length > 0 ? 'TRUE' : 'FALSE',
        apply_sku_filter: parsed.sku && parsed.sku.length > 0 ? 'TRUE' : 'FALSE',
        apply_brand_filter: parsed.brand ? 'TRUE' : 'FALSE',
        apply_product_family_filter: parsed.product_family ? 'TRUE' : 'FALSE',
        include_siblings: includeSiblings ? 'TRUE' : 'FALSE',
        marketplace_filter_clause: marketplaceFilterClause,
        marketplace_filter_clause_sibling: marketplaceFilterClause,
        limit_top_n: Number(limit),
      });

      const athenaResult = await runAthenaQuery({
        query,
        database: 'inventory_planning',
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows: Math.min(2000, limit),
      });

      const rows = athenaResult.rows ?? [];

      const items = rows.map((row) => {
        const record = row as Record<string, unknown>;

        const childAsin = (record.child_asin ?? '') as string;
        const parentAsin = (record.parent_asin ?? '') as string;
        const sku = (record.sku ?? '') as string;
        const marketplace = (record.marketplace ?? '') as string;
        const inventoryId = toInt(record.inventory_id);
        const imageUrl = (record.item_icon_url ?? '') as string;

        return {
          child_asin: childAsin,
          parent_asin: parentAsin,
          sku,
          fnsku: (record.fnsku ?? undefined) as string | undefined,
          product_name: (record.product_name ?? '') as string,
          brand: (record.brand ?? '') as string,
          product_family: (record.product_family ?? '') as string,
          color: (record.color ?? undefined) as string | undefined,
          size: (record.size ?? undefined) as string | undefined,
          marketplace,
          company_id: toInt(record.company_id),
          revenue_abcd_class: (record.revenue_abcd_class ?? undefined) as string | undefined,
          pareto_abc_class: (record.pareto_abc_class ?? undefined) as string | undefined,
          revenue_share: toFloat(record.revenue_share),
          sibling_count: toInt(record.sibling_count),
          is_hero: record.is_hero === true || record.is_hero === 'true',
          units_30d: toFloat(record.units_30d),
          revenue_30d: toFloat(record.revenue_30d),
          avg_units_7d: toFloat(record.avg_units_7d),
          item_icon_url: imageUrl || undefined,
          presentation: buildItemPresentation({
            sku,
            asin: childAsin,
            inventory_id: inventoryId ?? undefined,
            marketplace_code: marketplace as 'US' | 'UK' | undefined,
            image_url: imageUrl || undefined,
          }),
        };
      });

      const result: Record<string, unknown> = {
        items,
        total_rows: items.length,
      };

      if (parsed.debug) {
        result.diagnostics = {
          permitted_company_ids_count: permittedCompanyIds.length,
          allowed_company_ids: allowedCompanyIds.slice(0, 50),
          rendered_sql: query,
        };
      }

      return result;
    },
  });
}
