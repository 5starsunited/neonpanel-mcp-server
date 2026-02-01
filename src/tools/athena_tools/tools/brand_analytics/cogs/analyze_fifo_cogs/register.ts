import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runAthenaQuery } from '../../../../../../clients/athena';
import { neonPanelRequest } from '../../../../../../clients/neonpanel-api';
import { config } from '../../../../../../config';
import type { ToolExecutionContext, ToolRegistry, ToolSpecJson } from '../../../../../types';
import { loadTextFile } from '../../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../../runtime/render-sql';

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
      document_id: z.array(z.number().int()).optional(),
      document_ref_number: z.array(z.string()).optional(),
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
        'io_batch_id',
        'io_batch_name',
        'io_batch_ref_number',
        'ao_batch_id',
        'ao_batch_name',
        'ao_batch_ref_number',
        'vendor',
        'document_id',
        'document_ref_number',
      ])).optional().default([]),
      time: z.object({
        periodicity: z.enum(['month', 'year', 'total']).optional().default('total'),
        start_date: z.string().optional(),
        end_date: z.string().optional(),
      }).optional(),
    }).optional(),
    sort: z.object({
      field: z.enum([
        'cogs_amount',
        'units_sold',
        'units_with_cost',
        'units_missing_cost',
        'cogs_quality_pct',
        'estimated_lost_cogs',
        'transactions_count',
        'avg_unit_cogs',
        'purchase_price_amount',
        'time_period',
      ]).optional().default('cogs_amount'),
      direction: z.enum(['asc', 'desc']).optional().default('desc'),
    }).optional(),
    limit: z.number().int().min(1).max(10000).optional().default(100),
  }).required({ filters: true }),
}).required({ query: true });

type CogsAnalyzeInput = z.infer<typeof inputSchema>;

type CompaniesWithPermissionResponse = {
  companies?: Array<{
    company_id?: number;
    companyId?: number;
    id?: number;
  }>;
};

function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlVarcharArrayExpr(values: string[]): string {
  if (values.length === 0) return 'CAST(ARRAY[] AS ARRAY(VARCHAR))';
  return `CAST(ARRAY[${values.map(sqlStringLiteral).join(',')}] AS ARRAY(VARCHAR))`;
}

function sqlBigintArrayExpr(values: number[]): string {
  if (values.length === 0) return 'CAST(ARRAY[] AS ARRAY(BIGINT))';
  return `CAST(ARRAY[${values.map((n) => String(Math.trunc(n))).join(',')}] AS ARRAY(BIGINT))`;
}

async function executeCogsAnalyzeFifoCogs(
  params: CogsAnalyzeInput,
  context: ToolExecutionContext,
): Promise<{ items: unknown[]; meta: Record<string, unknown> }> {
  // Permission gate
  const permission = 'view:quicksight_group.business_planning_new';
  const permissionResponse = await neonPanelRequest<CompaniesWithPermissionResponse>({
    token: context.userToken,
    path: `/api/v1/permissions/${encodeURIComponent(permission)}/companies`,
  });

  const permittedCompanies = (permissionResponse.companies ?? []).filter(
    (c): c is { company_id?: number; companyId?: number; id?: number } =>
      c !== null && typeof c === 'object',
  );

  const permittedCompanyIds = permittedCompanies
    .map((c) => c.company_id ?? c.companyId ?? c.id)
    .filter((id): id is number => typeof id === 'number' && Number.isFinite(id) && id > 0);

  const requestedCompanyIds = params.query.filters.company_id;
  const allowedCompanyIds = requestedCompanyIds.filter((id) => permittedCompanyIds.includes(id));

  if (permittedCompanyIds.length === 0 || allowedCompanyIds.length === 0) {
    return { items: [], meta: { error: 'No permitted companies or access denied' } };
  }

  // Extract parameters
  const filters = params.query.filters;
  const aggregation = params.query.aggregation ?? { group_by: [], time: { periodicity: 'total' as const } };
  const groupBy = aggregation.group_by ?? [];
  const time = aggregation.time ?? { periodicity: 'total' as const };
  const periodicity = time.periodicity ?? 'total';
  const sort = params.query.sort ?? { field: 'cogs_amount' as const, direction: 'desc' as const };
  const limit = params.query.limit ?? 100;

  // Build GROUP BY clause and SELECT dimensions
  const groupByFields: string[] = [];
  const selectDimensions: string[] = [];
  const groupBySelectFields: string[] = [];
  
  // ALWAYS add p.periodicity to GROUP BY (it's always selected in SQL)
  groupByFields.push('p.periodicity');
  
  // ALWAYS add time period CASE expression to GROUP BY (it's always selected as time_period)
  groupByFields.push(`CASE 
    WHEN p.periodicity = 'month' THEN FORMAT('%d-%02d', YEAR(bt.document_date), MONTH(bt.document_date))
    WHEN p.periodicity = 'year' THEN CAST(YEAR(bt.document_date) AS VARCHAR)
    ELSE NULL
  END`);
  
  // Add dimension fields
  const dimensionMap: Record<string, string> = {
    sku: 'bt.sku',
    brand: 'bt.brand',
    product_family: 'bt.product_family',
    child_asin: 'bt.child_asin',
    parent_asin: 'bt.parent_asin',
    marketplace: 'bt.marketplace',
    country: 'bt.country',
    marketplace_currency: 'bt.marketplace_currency',
    revenue_abcd_class: 'bt.revenue_abcd_class',
    pareto_abc_class: 'bt.pareto_abc_class',
    inventory_id: 'bt.inventory_id',
    io_batch_id: 'bt.io_batch_id',
    io_batch_name: 'bt.io_batch_name',
    io_batch_ref_number: 'bt.io_batch_ref_number',
    ao_batch_id: 'bt.ao_batch_id',
    ao_batch_name: 'bt.ao_batch_name',
    ao_batch_ref_number: 'bt.ao_batch_ref_number',
    vendor: 'bt.vendor',
    document_id: 'bt.document_id',
    document_ref_number: 'bt.document_ref_number',
  };
  
  for (const dim of groupBy) {
    if (dimensionMap[dim]) {
      groupByFields.push(dimensionMap[dim]);
      groupBySelectFields.push(`${dimensionMap[dim]} AS ${dim}`);
      selectDimensions.push(`ac.${dim}`);
    }
  }

  // SMART BATCH DETAIL AUTO-INCLUSION
  // If user groups by batch ID, automatically include batch name/ref for context
  const groupBySet = new Set(groupBy);

  // Auto-include IO batch details if grouping by io_batch_id
  if (groupBySet.has('io_batch_id') && !groupBySet.has('io_batch_name')) {
    groupByFields.push('bt.io_batch_name');
    groupBySelectFields.push('bt.io_batch_name AS io_batch_name');
    selectDimensions.push('ac.io_batch_name');
  }
  if (groupBySet.has('io_batch_id') && !groupBySet.has('io_batch_ref_number')) {
    groupByFields.push('bt.io_batch_ref_number');
    groupBySelectFields.push('bt.io_batch_ref_number AS io_batch_ref_number');
    selectDimensions.push('ac.io_batch_ref_number');
  }

  // Auto-include AO batch details if grouping by ao_batch_id
  if (groupBySet.has('ao_batch_id') && !groupBySet.has('ao_batch_name')) {
    groupByFields.push('bt.ao_batch_name');
    groupBySelectFields.push('bt.ao_batch_name AS ao_batch_name');
    selectDimensions.push('ac.ao_batch_name');
  }
  if (groupBySet.has('ao_batch_id') && !groupBySet.has('ao_batch_ref_number')) {
    groupByFields.push('bt.ao_batch_ref_number');
    groupBySelectFields.push('bt.ao_batch_ref_number AS ao_batch_ref_number');
    selectDimensions.push('ac.ao_batch_ref_number');
  }

  // Build GROUP BY SELECT clause (for aggregated_cogs CTE)
  const groupBySelectClause = groupBySelectFields.length > 0
    ? groupBySelectFields.join(',\n    ') + ','
    : '';

  // Build GROUP BY clause (list all grouped fields)
  // p.periodicity and time CASE expression are always first, followed by dimensions
  const groupByClause = groupByFields.join(', ');

  // Build ORDER BY clause
  const sortField = sort.field ?? 'cogs_amount';
  const sortDirection = sort.direction ?? 'desc';
  const orderByClause = `ORDER BY ${sortField} ${sortDirection.toUpperCase()}`;

  // Build final SELECT dimensions
  const selectDimensionsClause = selectDimensions.length > 0
    ? selectDimensions.join(',\n  ') + ','
    : '';

  // Load SQL template
  const sqlPath = path.join(__dirname, 'query.sql');
  const template = await loadTextFile(sqlPath);
  
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
    document_ids_array: sqlBigintArrayExpr(filters.document_id ?? []),
    document_ref_numbers_array: sqlVarcharArrayExpr(filters.document_ref_number ?? []),
    start_date: time.start_date ? sqlStringLiteral(time.start_date) : 'NULL',
    end_date: time.end_date ? sqlStringLiteral(time.end_date) : 'NULL',
    periodicity_sql: sqlStringLiteral(periodicity),
    group_by_fields: sqlStringLiteral(groupBy.join(',')),
    group_by_select_clause: groupBySelectClause,
    group_by_clause: groupByClause,
    select_dimensions: selectDimensionsClause,
    order_by_clause: orderByClause,
    sort_field_sql: sqlStringLiteral(sortField),
    sort_direction_sql: sqlStringLiteral(sortDirection),
    limit_rows: String(limit),
  });

  // Execute Athena query
  const athenaResult = await runAthenaQuery({
    query,
    database: config.athena.database,
    workGroup: config.athena.workgroup,
    outputLocation: config.athena.outputLocation,
    maxRows: limit,
  });

  const resultRows = athenaResult.rows ?? [];

  return {
    items: resultRows,
    meta: {
      applied_filters: {
        company_ids: allowedCompanyIds,
        dimensions: filters,
        time_range: time.start_date || time.end_date ? { start_date: time.start_date, end_date: time.end_date } : null,
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

export function registerCogsAnalyzeFifoCogsTool(registry: ToolRegistry): void {
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
    name: specJson?.name ?? 'brand_analytics_analyze_fifo_cogs',
    description: specJson?.description ?? 'Analyze FIFO COGS with flexible grouping and quality metrics.',
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
      return executeCogsAnalyzeFifoCogs(parsed, context);
    },
  });
}
