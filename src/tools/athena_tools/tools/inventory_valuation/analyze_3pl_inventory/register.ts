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

const groupBySchema = z.enum([
  'company',
  'date',
  'source',
  'status',
  'seller_id',
  'inventory_id',
  'sku',
  'warehouse',
  'warehouse_id',
]);

const sortFieldSchema = z.enum([
  'balance_quantity',
  'record_count',
  'distinct_inventory_items',
  'distinct_skus',
  'distinct_warehouses',
  'latest_balance_date',
  'latest_updated_at',
]);

const inputSchema = z.object({
  query: z.object({
    filters: z.object({
      company_id: z.array(z.coerce.number().int().min(1)).min(1),
      sku: z.array(z.string()).optional(),
      source: z.array(z.string()).optional(),
      status: z.array(z.string()).optional(),
      seller_id: z.array(z.coerce.number().int().min(1)).optional(),
      inventory_id: z.array(z.coerce.number().int().min(1)).optional(),
      warehouse_id: z.array(z.coerce.number().int().min(1)).optional(),
      warehouse_name: z.array(z.string()).optional(),
      snapshot_date: z.string().optional(),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
    }),
    aggregation: z.object({
      group_by: z.array(groupBySchema).optional().default([]),
      time: z.object({
        periodicity: z.enum(['total', 'day', 'month', 'year']).optional().default('total'),
      }).optional().default({ periodicity: 'total' as const }),
    }).optional().default({ group_by: [], time: { periodicity: 'total' as const } }),
    sort: z.object({
      field: sortFieldSchema.optional().default('balance_quantity'),
      direction: z.enum(['asc', 'desc']).optional().default('desc'),
    }).optional().default({ field: 'balance_quantity' as const, direction: 'desc' as const }),
    limit: z.coerce.number().int().min(1).max(10000).optional().default(100),
  }),
});

type InputType = z.infer<typeof inputSchema>;

type GroupByField = z.infer<typeof groupBySchema>;

type DimensionConfig = { expression: string; alias: string };

const dimensionMap: Record<GroupByField, DimensionConfig> = {
  company: { expression: 'ab.company_id', alias: 'company_id' },
  date: { expression: 'CAST(ab.balance_date AS VARCHAR)', alias: 'balance_date' },
  source: { expression: 'ab.source', alias: 'source' },
  status: { expression: 'ab.status', alias: 'status' },
  seller_id: { expression: 'ab.seller_id', alias: 'seller_id' },
  inventory_id: { expression: 'ab.inventory_id', alias: 'inventory_id' },
  sku: { expression: 'ab.sku', alias: 'sku' },
  warehouse: { expression: 'ab.warehouse_name', alias: 'warehouse_name' },
  warehouse_id: { expression: 'ab.warehouse_id', alias: 'warehouse_id' },
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
    'p.periodicity',
    `CASE
      WHEN p.periodicity = 'day' THEN CAST(ab.balance_date AS VARCHAR)
      WHEN p.periodicity = 'month' THEN FORMAT('%d-%02d', YEAR(ab.balance_date), MONTH(ab.balance_date))
      WHEN p.periodicity = 'year' THEN CAST(YEAR(ab.balance_date) AS VARCHAR)
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

async function executeAnalyze3plInventory(params: InputType, context: ToolExecutionContext) {
  const filters = params.query.filters;
  const aggregation = params.query.aggregation ?? { group_by: [], time: { periodicity: 'total' as const } };
  const groupBy = aggregation.group_by ?? [];
  const periodicity = aggregation.time?.periodicity ?? 'total';
  const sort = params.query.sort ?? { field: 'balance_quantity' as const, direction: 'desc' as const };
  const limit = params.query.limit ?? 100;

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
  const sortDirection = sort.direction ?? 'desc';
  const orderByClause = `ORDER BY ${sort.field ?? 'balance_quantity'} ${sortDirection.toUpperCase()}`;
  const template = await loadTextFile(path.join(__dirname, 'query.sql'));
  const renderedQuery = renderSqlTemplate(template, {
    catalog: config.athena.catalog,
    company_ids_array: sqlBigintArrayExpr(allowedCompanyIds),
    skus_array: sqlVarcharArrayExpr(cleanStringValues(filters.sku)),
    sources_array: sqlVarcharArrayExpr(cleanStringValues(filters.source, true)),
    statuses_array: sqlVarcharArrayExpr(cleanStringValues(filters.status, true)),
    seller_ids_array: sqlBigintArrayExpr(filters.seller_id ?? []),
    inventory_ids_array: sqlBigintArrayExpr(filters.inventory_id ?? []),
    warehouse_ids_array: sqlBigintArrayExpr(filters.warehouse_id ?? []),
    warehouse_names_array: sqlVarcharArrayExpr(cleanStringValues(filters.warehouse_name)),
    warehouse_names_lower_array: sqlVarcharArrayExpr(cleanStringValues(filters.warehouse_name, true)),
    date_from_sql: sqlNullableDateLiteral(filters.date_from),
    date_to_sql: sqlNullableDateLiteral(filters.date_to),
    snapshot_date_sql: sqlNullableDateLiteral(filters.snapshot_date),
    periodicity_sql: sqlStringLiteral(periodicity),
    group_by_fields_sql: sqlStringLiteral(clauses.uniqueGroupBy.join(',')),
    sort_field_sql: sqlStringLiteral(sort.field ?? 'balance_quantity'),
    sort_direction_sql: sqlStringLiteral(sortDirection),
    group_by_select_clause: clauses.groupBySelectClause,
    group_by_clause: clauses.groupByClause,
    select_dimensions: clauses.selectDimensionsClause,
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
        date_selection: filters.snapshot_date ? 'exact_snapshot_date' : filters.date_from || filters.date_to ? 'date_range' : 'latest_available_date',
      },
      aggregation: { group_by: clauses.uniqueGroupBy, periodicity },
      sort: { field: sort.field ?? 'balance_quantity', direction: sortDirection },
      row_count: rows.length,
      limit,
    },
  };
}

export function registerInventoryValuationAnalyze3plInventoryTool(registry: ToolRegistry): void {
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
    name: specJson?.name ?? 'inventory_valuation_analyze_3pl_inventory',
    description: specJson?.description ?? 'Analyze actual inventory balances from third-party and manual audit sources.',
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
      return executeAnalyze3plInventory(parsed, context);
    },
  });
}