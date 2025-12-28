import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runAthenaQuery } from '../../../../clients/athena';
import { neonPanelRequest } from '../../../../clients/neonpanel-api';
import { config } from '../../../../config';
import type { ToolRegistry, ToolSpecJson } from '../../../types';
import { loadTextFile } from '../../runtime/load-assets';
import { renderSqlTemplate } from '../../runtime/render-sql';

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

function sqlEscapeString(value: string): string {
  return value.replace(/'/g, "''");
}

function sqlStringLiteral(value: string): string {
  return `'${sqlEscapeString(value)}'`;
}

function sqlCompanyIdArrayExpr(values: number[]): string {
  // company_id is a STRING partition column in Athena, so we filter using ARRAY(VARCHAR).
  if (values.length === 0) return 'CAST(ARRAY[] AS ARRAY(VARCHAR))';
  return `CAST(ARRAY[${values.map((n) => sqlStringLiteral(String(Math.trunc(n)))).join(',')}] AS ARRAY(VARCHAR))`;
}

const inputSchema = z.object({
  sku: z.string().min(1),
  marketplace: z.enum(['US', 'UK']),
  company_id: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(25).default(5).optional(),
});

export function registerInventorySkuDeepDiveTool(registry: ToolRegistry) {
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
    name: 'amazon_supply_chain.inventory_sku_deep_dive',
    description: 'Deep dive of the raw inventory_planning_snapshot row(s) for a specific SKU + marketplace.',
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

      if (permittedCompanyIds.length === 0 || allowedCompanyIds.length === 0) {
        return { items: [] };
      }

      const catalog = config.athena.catalog;
      const database = config.athena.database;
      const table = config.athena.tables.inventoryPlanningSnapshot;

      const limit = parsed.limit ?? 5;

      const template = await loadTextFile(sqlPath);
      const query = renderSqlTemplate(template, {
        catalog,
        database,
        table,
        company_ids_array: sqlCompanyIdArrayExpr(allowedCompanyIds),
        sku_sql: sqlStringLiteral(parsed.sku),
        marketplace_sql: sqlStringLiteral(parsed.marketplace),
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

      const items = (athenaResult.rows ?? []).map((row) => {
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

        return {
          item_ref,
          snapshot_partition,
          snapshot: record,
        };
      });

      return { items };
    },
  });
}
