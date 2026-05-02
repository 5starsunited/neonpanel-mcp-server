import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runAthenaQuery } from '../../../../../clients/athena';
import { config } from '../../../../../config';
import type { ToolExecutionContext, ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';
import {
  getAllowedInventoryValuationCompanyIds,
  sqlBigintArrayExpr,
  sqlNullableDateLiteral,
  sqlStringLiteral,
  sqlVarcharArrayExpr,
} from '../common';

const sortFieldSchema = z.enum([
  'abs_quantity_difference',
  'quantity_difference',
  'actual_quantity',
  'calculated_quantity',
  'percent_difference',
  'sku',
  'warehouse_name',
  'audit_status',
]);

const inputSchema = z.object({
  query: z.object({
    filters: z.object({
      company_id: z.array(z.coerce.number().int().min(1)).min(1),
      snapshot_date: z.string().optional(),
      sku: z.array(z.string()).optional(),
      source: z.array(z.string()).optional(),
      status: z.array(z.string()).optional(),
      inventory_id: z.array(z.coerce.number().int().min(1)).optional(),
      warehouse_id: z.array(z.coerce.number().int().min(1)).optional(),
      warehouse_name: z.array(z.string()).optional(),
    }),
    audit: z.object({
      quantity_tolerance: z.coerce.number().min(0).optional().default(0),
      only_discrepancies: z.boolean().optional().default(true),
    }).optional().default({ quantity_tolerance: 0, only_discrepancies: true }),
    sort: z.object({
      field: sortFieldSchema.optional().default('abs_quantity_difference'),
      direction: z.enum(['asc', 'desc']).optional().default('desc'),
    }).optional().default({ field: 'abs_quantity_difference' as const, direction: 'desc' as const }),
    limit: z.coerce.number().int().min(1).max(10000).optional().default(500),
  }),
});

type InputType = z.infer<typeof inputSchema>;

function cleanStringValues(values: string[] | undefined, lower = false): string[] {
  return (values ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map((value) => (lower ? value.toLowerCase() : value));
}

async function executeAuditInventoryBalances(params: InputType, context: ToolExecutionContext) {
  const filters = params.query.filters;
  const audit = params.query.audit ?? { quantity_tolerance: 0, only_discrepancies: true };
  const sort = params.query.sort ?? { field: 'abs_quantity_difference' as const, direction: 'desc' as const };
  const limit = params.query.limit ?? 500;

  const { allowedCompanyIds } = await getAllowedInventoryValuationCompanyIds(filters.company_id, context);
  if (allowedCompanyIds.length === 0) {
    return {
      items: [],
      meta: {
        query: { company_ids: filters.company_id, message: 'No permitted companies in request' },
        row_count: 0,
        limit,
      },
    };
  }

  const sortDirection = sort.direction ?? 'desc';
  const orderByClause = `ORDER BY ${sort.field ?? 'abs_quantity_difference'} ${sortDirection.toUpperCase()}`;
  const template = await loadTextFile(path.join(__dirname, 'query.sql'));
  const renderedQuery = renderSqlTemplate(template, {
    catalog: config.athena.catalog,
    company_ids_array: sqlBigintArrayExpr(allowedCompanyIds),
    skus_array: sqlVarcharArrayExpr(cleanStringValues(filters.sku)),
    sources_array: sqlVarcharArrayExpr(cleanStringValues(filters.source, true)),
    statuses_array: sqlVarcharArrayExpr(cleanStringValues(filters.status, true)),
    inventory_ids_array: sqlBigintArrayExpr(filters.inventory_id ?? []),
    warehouse_ids_array: sqlBigintArrayExpr(filters.warehouse_id ?? []),
    warehouse_names_array: sqlVarcharArrayExpr(cleanStringValues(filters.warehouse_name)),
    warehouse_names_lower_array: sqlVarcharArrayExpr(cleanStringValues(filters.warehouse_name, true)),
    snapshot_date_sql: sqlNullableDateLiteral(filters.snapshot_date),
    quantity_tolerance: String(audit.quantity_tolerance ?? 0),
    only_discrepancies_sql: audit.only_discrepancies === false ? 'false' : 'true',
    sort_field_sql: sqlStringLiteral(sort.field ?? 'abs_quantity_difference'),
    sort_direction_sql: sqlStringLiteral(sortDirection),
    order_by_clause: orderByClause,
    limit_rows: String(limit),
  });

  const result = await runAthenaQuery({
    query: renderedQuery,
    database: config.athena.database,
    workGroup: config.athena.workgroup,
    outputLocation: config.athena.outputLocation,
    maxRows: limit,
  });

  const rows = result.rows ?? [];
  return {
    items: rows,
    meta: {
      query: {
        company_ids: allowedCompanyIds,
        filters,
        date_selection: filters.snapshot_date ? 'exact_snapshot_date' : 'latest_available_actual_date_per_company',
      },
      audit: {
        quantity_tolerance: audit.quantity_tolerance ?? 0,
        only_discrepancies: audit.only_discrepancies !== false,
        match_logic: 'company + audit_date + (inventory_id or SKU) + warehouse_name',
      },
      sort: { field: sort.field ?? 'abs_quantity_difference', direction: sortDirection },
      row_count: rows.length,
      limit,
    },
  };
}

export function registerInventoryValuationAuditInventoryBalancesTool(registry: ToolRegistry): void {
  const toolJsonPath = path.join(__dirname, 'tool.json');
  let specJson: ToolSpecJson | undefined;

  try {
    if (fs.existsSync(toolJsonPath)) {
      specJson = JSON.parse(fs.readFileSync(toolJsonPath, 'utf-8')) as ToolSpecJson;
    }
  } catch {
    specJson = undefined;
  }

  registry.register({
    name: specJson?.name ?? 'inventory_valuation_audit_inventory_balances',
    description: specJson?.description ?? 'Compare actual inventory balances with NeonPanel calculated FIFO inventory quantities.',
    inputSchema,
    outputSchema: specJson?.outputSchema ?? {
      type: 'object',
      properties: {
        items: { type: 'array', items: { type: 'object', additionalProperties: true } },
        meta: { type: 'object', additionalProperties: true },
      },
      required: ['items'],
    },
    isConsequential: specJson?.isConsequential ?? false,
    specJson,
    execute: async (rawInput: unknown, context: ToolExecutionContext) => {
      const parsed = inputSchema.parse(rawInput);
      return executeAuditInventoryBalances(parsed, context);
    },
  });
}