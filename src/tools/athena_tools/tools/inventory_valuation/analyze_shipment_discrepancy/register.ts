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
  sqlStringLiteral,
  sqlVarcharArrayExpr,
} from '../common';

const dateFieldSchema = z.enum(['shipped_at', 'received_at', 'arrived_at', 'created_at', 'updated_at']);
const periodicitySchema = z.enum(['total', 'day', 'month', 'year']);
const groupBySchema = z.enum([
  'company',
  'shipment',
  'sku',
  'inventory_id',
  'marketplace',
  'origin',
  'destination',
  'status',
  'shipment_type',
  'amazon_status',
  'scope',
]);
const detailSortFieldSchema = z.enum([
  'selected_date',
  'shipped_at',
  'received_at',
  'quantity_shipped',
  'quantity_received',
  'quantity_discrepancy',
  'absolute_discrepancy',
  'received_rate_percent',
  'seller_sku',
  'shipment_id',
]);
const groupedSortFieldSchema = z.enum([
  'quantity_shipped',
  'quantity_received',
  'quantity_discrepancy',
  'absolute_discrepancy',
  'received_rate_percent',
  'shipment_line_count',
  'shipment_count',
  'sku_count',
  'discrepant_line_count',
  'latest_selected_date',
]);

const inputSchema = z.object({
  query: z.object({
    filters: z.object({
      company_id: z.array(z.coerce.number().int().min(1)).min(1),
      start_date: z.string(),
      end_date: z.string(),
      date_field: dateFieldSchema.optional().default('shipped_at'),
      sku: z.array(z.string()).optional(),
      shipment_id: z.array(z.coerce.number().int().min(1)).optional(),
      amazon_shipment_id: z.array(z.string()).optional(),
      marketplace_id: z.array(z.string()).optional(),
      origin_warehouse: z.array(z.string()).optional(),
      destination_warehouse: z.array(z.string()).optional(),
      shipment_status: z.array(z.string()).optional(),
      shipment_type: z.array(z.string()).optional(),
      include_inactive: z.boolean().optional().default(false),
      include_cancelled_deleted: z.boolean().optional().default(false),
    }),
    discrepancy: z.object({
      quantity_tolerance: z.coerce.number().min(0).optional().default(0),
      discrepancy_only: z.boolean().optional().default(false),
    }).optional().default({ quantity_tolerance: 0, discrepancy_only: false }),
    aggregation: z.object({
      group_by: z.array(groupBySchema).optional().default([]),
      time: z.object({
        periodicity: periodicitySchema.optional().default('total'),
      }).optional().default({ periodicity: 'total' as const }),
    }).optional().default({ group_by: [], time: { periodicity: 'total' as const } }),
    sort: z.object({
      field: z.union([detailSortFieldSchema, groupedSortFieldSchema]).optional().default('absolute_discrepancy'),
      direction: z.enum(['asc', 'desc']).optional().default('desc'),
    }).optional().default({ field: 'absolute_discrepancy' as const, direction: 'desc' as const }),
    limit: z.coerce.number().int().min(1).max(10000).optional().default(500),
  }),
});

type InputType = z.infer<typeof inputSchema>;
type GroupByField = z.infer<typeof groupBySchema>;

type DimensionConfig = { expression: string; alias: string };

const dimensionMap: Record<GroupByField, DimensionConfig> = {
  company: { expression: 'f.company_id', alias: 'company_id' },
  shipment: { expression: 'f.shipment_id', alias: 'shipment_id' },
  sku: { expression: 'f.seller_sku', alias: 'seller_sku' },
  inventory_id: { expression: 'f.inventory_id', alias: 'inventory_id' },
  marketplace: { expression: 'COALESCE(CAST(f.amazon_marketplace_id AS VARCHAR), CAST(f.marketplace_id AS VARCHAR))', alias: 'marketplace_id' },
  origin: { expression: 'f.origin', alias: 'origin' },
  destination: { expression: 'f.destination', alias: 'destination' },
  status: { expression: 'f.shipment_status', alias: 'shipment_status' },
  shipment_type: { expression: 'f.shipment_type', alias: 'shipment_type' },
  amazon_status: { expression: 'f.amazon_status', alias: 'amazon_status' },
  scope: { expression: 'f.shipment_line_scope', alias: 'shipment_line_scope' },
};

function cleanStringValues(values: string[] | undefined, lower = false): string[] {
  return (values ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map((value) => (lower ? value.toLowerCase() : value));
}

function buildDimensionClauses(groupBy: GroupByField[]) {
  const uniqueGroupBy = [...new Set(groupBy)];
  const groupByFields = [
    `CASE
      WHEN p.periodicity = 'day' THEN CAST(f.selected_date AS VARCHAR)
      WHEN p.periodicity = 'month' THEN FORMAT('%d-%02d', YEAR(f.selected_date), MONTH(f.selected_date))
      WHEN p.periodicity = 'year' THEN CAST(YEAR(f.selected_date) AS VARCHAR)
      ELSE NULL
    END`,
  ];

  const groupBySelectFields: string[] = [];
  const selectDimensions: string[] = [];

  for (const dimension of uniqueGroupBy) {
    const configForDimension = dimensionMap[dimension];
    groupByFields.push(configForDimension.expression);
    groupBySelectFields.push(`${configForDimension.expression} AS ${configForDimension.alias}`);
    selectDimensions.push(`ag.${configForDimension.alias}`);
  }

  return {
    uniqueGroupBy,
    groupByClause: groupByFields.join(', '),
    groupBySelectClause: groupBySelectFields.length > 0 ? `${groupBySelectFields.join(',\n    ')},` : '',
    selectDimensionsClause: selectDimensions.length > 0 ? `${selectDimensions.join(',\n  ')},` : '',
  };
}

function buildOrderByClause(field: string, direction: string, isGrouped: boolean): string {
  const detailSortFields = new Set(detailSortFieldSchema.options);
  const groupedSortFields = new Set(groupedSortFieldSchema.options);
  const fallback = isGrouped ? 'absolute_discrepancy' : 'absolute_discrepancy';
  const safeField = isGrouped
    ? groupedSortFields.has(field as z.infer<typeof groupedSortFieldSchema>) ? field : fallback
    : detailSortFields.has(field as z.infer<typeof detailSortFieldSchema>) ? field : fallback;
  return `ORDER BY ${safeField} ${direction.toUpperCase()}`;
}

async function executeAnalyzeShipmentDiscrepancy(params: InputType, context: ToolExecutionContext) {
  const filters = params.query.filters;
  const discrepancy = params.query.discrepancy ?? { quantity_tolerance: 0, discrepancy_only: false };
  const aggregation = params.query.aggregation ?? { group_by: [], time: { periodicity: 'total' as const } };
  const groupBy = aggregation.group_by ?? [];
  const periodicity = aggregation.time?.periodicity ?? 'total';
  const sort = params.query.sort ?? { field: 'absolute_discrepancy' as const, direction: 'desc' as const };
  const sortDirection = sort.direction ?? 'desc';
  const limit = params.query.limit ?? 500;
  const isGrouped = groupBy.length > 0 || periodicity !== 'total';

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

  const clauses = buildDimensionClauses(groupBy);
  const template = await loadTextFile(path.join(__dirname, isGrouped ? 'query_grouped.sql' : 'query.sql'));
  const renderedQuery = renderSqlTemplate(template, {
    catalog: config.athena.catalog,
    company_ids_array: sqlBigintArrayExpr(allowedCompanyIds),
    start_date_sql: `DATE ${sqlStringLiteral(filters.start_date)}`,
    end_date_sql: `DATE ${sqlStringLiteral(filters.end_date)}`,
    date_field_sql: sqlStringLiteral(filters.date_field ?? 'shipped_at'),
    skus_array: sqlVarcharArrayExpr(cleanStringValues(filters.sku)),
    shipment_ids_array: sqlBigintArrayExpr(filters.shipment_id ?? []),
    amazon_shipment_ids_array: sqlVarcharArrayExpr(cleanStringValues(filters.amazon_shipment_id)),
    marketplace_ids_array: sqlVarcharArrayExpr(cleanStringValues(filters.marketplace_id)),
    origin_warehouse_names_lower_array: sqlVarcharArrayExpr(cleanStringValues(filters.origin_warehouse, true)),
    destination_warehouse_names_lower_array: sqlVarcharArrayExpr(cleanStringValues(filters.destination_warehouse, true)),
    shipment_statuses_lower_array: sqlVarcharArrayExpr(cleanStringValues(filters.shipment_status, true)),
    shipment_types_lower_array: sqlVarcharArrayExpr(cleanStringValues(filters.shipment_type, true)),
    quantity_tolerance: String(discrepancy.quantity_tolerance ?? 0),
    discrepancy_only_sql: discrepancy.discrepancy_only === true ? 'true' : 'false',
    include_inactive_sql: filters.include_inactive === true ? 'true' : 'false',
    include_cancelled_deleted_sql: filters.include_cancelled_deleted === true ? 'true' : 'false',
    periodicity_sql: sqlStringLiteral(periodicity),
    group_by_select_clause: clauses.groupBySelectClause,
    group_by_clause: clauses.groupByClause,
    select_dimensions: clauses.selectDimensionsClause,
    order_by_clause: buildOrderByClause(sort.field ?? 'absolute_discrepancy', sortDirection, isGrouped),
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
        filters: {
          ...filters,
          company_id: allowedCompanyIds,
          date_field: filters.date_field ?? 'shipped_at',
          include_inactive: filters.include_inactive === true,
          include_cancelled_deleted: filters.include_cancelled_deleted === true,
        },
      },
      discrepancy: {
        quantity_tolerance: discrepancy.quantity_tolerance ?? 0,
        discrepancy_only: discrepancy.discrepancy_only === true,
      },
      aggregation: { mode: isGrouped ? 'grouped' : 'detail', group_by: clauses.uniqueGroupBy, periodicity },
      sort: { field: sort.field ?? 'absolute_discrepancy', direction: sortDirection },
      row_count: rows.length,
      limit,
    },
  };
}

export function registerInventoryValuationAnalyzeShipmentDiscrepancyTool(registry: ToolRegistry): void {
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
    name: specJson?.name ?? 'inventory_valuation_analyze_shipment_discrepancy',
    description: specJson?.description ?? 'Analyze shipment shipped-vs-received quantity discrepancies from inventory shipment and FBA inbound ledger data.',
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
      return executeAnalyzeShipmentDiscrepancy(parsed, context);
    },
  });
}
