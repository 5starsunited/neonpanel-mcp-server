import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runAthenaQuery } from '../../../../../clients/athena';
import { neonPanelRequest } from '../../../../../clients/neonpanel-api';
import { config } from '../../../../../config';
import type { ToolExecutionContext, ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';

// Zod schema matching tool.json
const inputSchema = z.object({
  query: z.object({
    filters: z.object({
      company_id: z.array(z.number().int().min(1)).min(1),
      sku: z.array(z.string()).optional(),
      brand: z.array(z.string()).optional(),
      product_family: z.array(z.string()).optional(),
      child_asin: z.array(z.string()).optional(),
      parent_asin: z.array(z.string()).optional(),
      marketplace: z.array(z.string()).optional(),
      country: z.array(z.string()).optional(),
      marketplace_currency: z.array(z.string()).optional(),
      revenue_abcd_class: z.array(z.enum(['A', 'B', 'C', 'D'])).optional(),
      pareto_abc_class: z.array(z.enum(['A', 'B', 'C'])).optional(),
      inventory_id: z.array(z.number().int()).optional(),
      vendor: z.array(z.string()).optional(),
      origin_warehouse: z.array(z.string()).optional(),
      destination_warehouse: z.array(z.string()).optional(),
    }).required({ company_id: true }),
    aggregation: z.object({
      group_by: z.array(z.enum([
        'sku',
        'brand',
        'product_family',
        'child_asin',
        'parent_asin',
        'marketplace',
        'country',
        'marketplace_currency',
        'revenue_abcd_class',
        'pareto_abc_class',
        'inventory_id',
        'source_batch_id',
        'batch_id',
        'batch',
        'batch_ref_number',
        'vendor',
        'origin_warehouse',
        'destination_warehouse',
      ])).optional().default([]),
      time: z.object({
        periodicity: z.enum(['total', 'month', 'year']).optional().default('total'),
        snapshot_date: z.string().optional(),
      }).optional().default({ periodicity: 'total' as const }),
    }).optional().default({ group_by: [], time: { periodicity: 'total' as const } }),
    sort: z.object({
      field: z.enum([
        'balance_amount',
        'balance_quantity',
        'batches_count',
        'avg_unit_cost',
        'time_period',
      ]).optional().default('balance_amount'),
      direction: z.enum(['asc', 'desc']).optional().default('desc'),
    }).optional().default({ field: 'balance_amount' as const, direction: 'desc' as const }),
    limit: z.number().int().min(1).max(10000).optional().default(100),
  }),
});

type InputType = z.infer<typeof inputSchema>;

interface CompaniesWithPermissionResponse {
  companies?: Array<{ company_id?: number; companyId?: number; id?: number } | null>;
}

function sqlStringLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function sqlVarcharArrayExpr(values: string[]): string {
  if (values.length === 0) return 'ARRAY[]';
  return `ARRAY[${values.map(sqlStringLiteral).join(', ')}]`;
}

function sqlBigintArrayExpr(values: number[]): string {
  if (values.length === 0) return 'ARRAY[]';
  return `ARRAY[${values.map(String).join(', ')}]`;
}

async function executeInventoryValuationAnalyzeInventoryValue(params: InputType, context: ToolExecutionContext) {
  const filters = params.query.filters;
  const aggregation = params.query.aggregation ?? { group_by: [], time: { periodicity: 'total' as const } };
  const time = aggregation.time ?? { periodicity: 'total' as const };
  const groupBy = aggregation.group_by ?? [];
  const periodicity = time.periodicity ?? 'total';
  const sort = params.query.sort ?? { field: 'balance_amount' as const, direction: 'desc' as const };
  const limit = params.query.limit ?? 100;

  // Permission check
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

  const requestedCompanyIds = filters.company_id;
  const allowedCompanyIds = requestedCompanyIds.filter((id) => permittedCompanyIds.includes(id));

  if (allowedCompanyIds.length === 0) {
    return {
      items: [],
      meta: {
        query: { company_ids: requestedCompanyIds, message: 'No permitted companies in request' },
        row_count: 0,
        limit,
      },
    };
  }

  // Build GROUP BY clause and SELECT dimensions
  const groupByFields: string[] = [];
  const selectDimensions: string[] = [];
  const groupBySelectFields: string[] = [];
  
  // ALWAYS add p.periodicity to GROUP BY (it's always selected in SQL)
  groupByFields.push('p.periodicity');
  
  // ALWAYS add time period CASE expression to GROUP BY (it's always selected as time_period in SQL)
  groupByFields.push(`CASE 
    WHEN p.periodicity = 'month' THEN FORMAT('%d-%02d', YEAR(lb.document_date), MONTH(lb.document_date))
    WHEN p.periodicity = 'year' THEN CAST(YEAR(lb.document_date) AS VARCHAR)
    ELSE NULL
  END`);
  
  // Add dimension fields
  const dimensionMap: Record<string, string> = {
    sku: 'lb.sku',
    brand: 'lb.brand',
    product_family: 'lb.product_family',
    child_asin: 'lb.child_asin',
    parent_asin: 'lb.parent_asin',
    marketplace: 'lb.marketplace',
    country: 'lb.country',
    marketplace_currency: 'lb.marketplace_currency',
    revenue_abcd_class: 'lb.revenue_abcd_class',
    pareto_abc_class: 'lb.pareto_abc_class',
    inventory_id: 'lb.inventory_id',
    source_batch_id: 'lb.source_batch_id',
    batch_id: 'lb.batch_id',
    batch: 'lb.batch',
    batch_ref_number: 'lb.batch_ref_number',
    vendor: 'lb.vendor',
    origin_warehouse: 'lb.origin_warehouse',
    destination_warehouse: 'lb.destination_warehouse',
  };
  
  // Smart auto-inclusion: add batch detail fields when grouping by batch_id
  const groupBySet = new Set(groupBy);
  
// Auto-include batch details if grouping by batch_id
  if (groupBySet.has('batch_id') && !groupBySet.has('batch')) {
    groupBy.push('batch');
    groupBySet.add('batch');
  }
  if (groupBySet.has('batch_id') && !groupBySet.has('batch_ref_number')) {
    groupBy.push('batch_ref_number');
    groupBySet.add('batch_ref_number');
  }
  
  for (const dim of groupBy) {
    if (dimensionMap[dim]) {
      groupByFields.push(dimensionMap[dim]);
      groupBySelectFields.push(`${dimensionMap[dim]} AS ${dim}`);
      selectDimensions.push(`ai.${dim}`);
    }
  }

  // Build GROUP BY SELECT clause (for aggregated_inventory CTE)
  const groupBySelectClause = groupBySelectFields.length > 0
    ? groupBySelectFields.join(',\n    ') + ','
    : '';

  // Build GROUP BY clause (list all grouped fields)
  // p.periodicity is always first, followed by time expression (if not total), then dimensions
  const groupByClause = groupByFields.join(', ');

  // Build SELECT dimensions clause (for final SELECT)
  const selectDimensionsClause = selectDimensions.length > 0
    ? selectDimensions.join(',\n  ') + ','
    : '';

  // Build ORDER BY clause
  const sortField = sort.field ?? 'balance_amount';
  const sortDirection = sort.direction ?? 'desc';
  const orderByClause = `ORDER BY ${sortField} ${sortDirection.toUpperCase()}`;

  // Load SQL template
  const template = await loadTextFile(path.join(__dirname, 'query.sql'));

  // Render SQL with parameters
  const query = renderSqlTemplate(template, {
    company_ids_array: sqlBigintArrayExpr(allowedCompanyIds),
    skus_array: sqlVarcharArrayExpr(filters.sku ?? []),
    brands_array: sqlVarcharArrayExpr(filters.brand ?? []),
    product_families_array: sqlVarcharArrayExpr(filters.product_family ?? []),
    child_asins_array: sqlVarcharArrayExpr(filters.child_asin ?? []),
    parent_asins_array: sqlVarcharArrayExpr(filters.parent_asin ?? []),
    marketplaces_array: sqlVarcharArrayExpr(filters.marketplace ?? []),
    countries_array: sqlVarcharArrayExpr(filters.country ?? []),
    marketplace_currencies_array: sqlVarcharArrayExpr(filters.marketplace_currency ?? []),
    revenue_abcd_classes_array: sqlVarcharArrayExpr(filters.revenue_abcd_class ?? []),
    pareto_abc_classes_array: sqlVarcharArrayExpr(filters.pareto_abc_class ?? []),
    inventory_ids_array: sqlBigintArrayExpr(filters.inventory_id ?? []),
    vendors_array: sqlVarcharArrayExpr(filters.vendor ?? []),
    origin_warehouses_array: sqlVarcharArrayExpr(filters.origin_warehouse ?? []),
    destination_warehouses_array: sqlVarcharArrayExpr(filters.destination_warehouse ?? []),
    snapshot_date: time.snapshot_date ? sqlStringLiteral(time.snapshot_date) : 'NULL',
    periodicity_sql: sqlStringLiteral(periodicity),
    group_by_fields: sqlStringLiteral(groupBy.join(',')),
    group_by_select_clause: groupBySelectClause,
    group_by_clause: groupByClause,
    select_dimensions: selectDimensionsClause,
    order_by_clause: orderByClause,
    sort_field_sql: sqlStringLiteral(sortField),
    sort_direction_sql: sqlStringLiteral(sortDirection),
    limit_rows: limit.toString(),
  });

  // Execute Athena query
  const result = await runAthenaQuery({
    query,
    database: config.athena.database,
    workGroup: config.athena.workgroup,
    outputLocation: config.athena.outputLocation,
    maxRows: limit,
  });

  const resultRows = result.rows ?? [];

  return {
    items: resultRows,
    meta: {
      query: {
        company_ids: allowedCompanyIds,
        dimensions: filters,
        snapshot_date: time.snapshot_date ?? 'latest',
      },
      aggregation: {
        group_by: groupBy,
        periodicity,
      },
      sort: {
        field: sortField,
        direction: sortDirection,
      },
      row_count: resultRows.length,
      limit,
    },
  };
}

export function registerInventoryValuationAnalyzeInventoryValueTool(registry: ToolRegistry): void {
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
    name: specJson?.name ?? 'inventory_valuation_analyze_inventory_value',
    description: specJson?.description ?? 'Analyze inventory value using FIFO batch balances.',
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
      return executeInventoryValuationAnalyzeInventoryValue(parsed, context);
    },
  });
}
