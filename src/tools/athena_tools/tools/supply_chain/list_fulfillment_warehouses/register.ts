import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runClickHouseQuery } from '../../../../../clients/clickhouse';
import type { ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';
import { canReadSupplyChainCompany } from '../bom-planning';

export const TOOL_NAME = 'supply_chain_list_fulfillment_warehouses';

export const inputSchema = z
  .object({
    company_id: z.coerce.number().int().min(1),
    include_non_eligible: z.boolean().default(false).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(50).optional(),
  })
  .strict();

export type ListFulfillmentWarehousesInput = z.infer<typeof inputSchema>;

const fallbackOutputSchema = {
  type: 'object',
  properties: {
    items: { type: 'array', items: { type: 'object', additionalProperties: true } },
    meta: { type: 'object', additionalProperties: true },
  },
  required: ['items'],
};

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toFlag(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

export function buildFulfillmentWarehousesSqlVariables(
  input: ListFulfillmentWarehousesInput,
): Record<string, string | number> {
  return {
    company_id: Math.trunc(input.company_id),
    include_non_eligible_sql: input.include_non_eligible ? 'TRUE' : 'FALSE',
    limit_top_n: Math.trunc(input.limit ?? 50),
  };
}

export function mapFulfillmentWarehouseRow(row: Record<string, unknown>) {
  return {
    company_id: toNumber(row.company_id),
    company_name: (row.company_name ?? null) as string | null,
    warehouse_id: toNumber(row.warehouse_id),
    warehouse_uuid: (row.warehouse_uuid ?? null) as string | null,
    warehouse_name: (row.warehouse_name ?? null) as string | null,
    warehouse_type: (row.warehouse_type ?? null) as string | null,
    is_planning_eligible_type: toFlag(row.is_planning_eligible_type),
    is_fulfillment: toFlag(row.is_fulfillment),
    first_sale_date: (row.first_sale_date ?? null) as string | null,
    last_sale_date: (row.last_sale_date ?? null) as string | null,
    units_sold_30d: toNumber(row.units_sold_30d) ?? 0,
    units_sold_90d: toNumber(row.units_sold_90d) ?? 0,
    item_invoice_lines_90d: toNumber(row.item_invoice_lines_90d) ?? 0,
    items_sold_90d: toNumber(row.items_sold_90d) ?? 0,
    sales_channels_90d: Array.isArray(row.sales_channels_90d) ? (row.sales_channels_90d as string[]) : [],
    lead_time_events_365d: toNumber(row.lead_time_events_365d) ?? 0,
    median_lead_time_days: toNumber(row.median_lead_time_days),
    p80_lead_time_days: toNumber(row.p80_lead_time_days),
    default_lead_time_days: toNumber(row.default_lead_time_days) ?? 30,
    default_safety_stock_days: toNumber(row.default_safety_stock_days) ?? 10,
    default_replenishment_frequency_days: toNumber(row.default_replenishment_frequency_days) ?? 14,
  };
}

export function registerSupplyChainListFulfillmentWarehousesTool(registry: ToolRegistry): void {
  const toolJsonPath = path.join(__dirname, 'tool.json');
  const specJson = JSON.parse(fs.readFileSync(toolJsonPath, 'utf8')) as ToolSpecJson;

  registry.register({
    name: TOOL_NAME,
    description: specJson.description,
    isConsequential: false,
    inputSchema,
    outputSchema: specJson.outputSchema ?? fallbackOutputSchema,
    specJson,
    execute: async (args, context) => {
      const input = inputSchema.parse(args);
      if (!(await canReadSupplyChainCompany(context, input.company_id))) {
        return { items: [], meta: { warnings: ['No authorized company found for company_id.'] } };
      }

      const template = await loadTextFile(path.join(__dirname, 'query.sql'));
      const query = renderSqlTemplate(template, buildFulfillmentWarehousesSqlVariables(input));
      const result = await runClickHouseQuery({ query });
      const items = result.rows.map(mapFulfillmentWarehouseRow);

      const warnings: string[] = [];
      if (items.length === 0) {
        warnings.push(
          input.include_non_eligible
            ? 'No warehouse is referenced by invoices for this company. Non-FBA warehouse replenishment planning needs invoice-fulfilled sales (Invoice V1/V2) posted against a warehouse.'
            : 'No fulfillment warehouse with invoice sales in the last 90 days for this company. Retry with include_non_eligible=true to see every warehouse referenced by invoices (including FBA/AWD/transit locations); FBA replenishment is covered by supply_chain_list_fba_replenishment_candidates.',
        );
      }

      return {
        items,
        meta: {
          warnings,
          source: 'etl.fulfillment_warehouses',
          include_non_eligible: input.include_non_eligible ?? false,
          sort: 'units_sold_90d desc',
        },
      };
    },
  });
}
