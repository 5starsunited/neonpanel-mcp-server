import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runAthenaQuery } from '../../../../../clients/athena';
import { neonPanelRequest } from '../../../../../clients/neonpanel-api';
import { config } from '../../../../../config';
import type { ToolExecutionContext, ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';

type CompaniesWithPermissionResponse = {
  companies?: Array<{
    company_id?: number;
    companyId?: number;
    id?: number;
  }>;
};

const inputSchema = z.object({
  query: z.object({
    filters: z.object({
      company_id: z.array(z.number().int().positive()).min(1).describe('Company IDs. Required for tenant isolation and partition pruning.'),
      start_date: z.string().describe('Start date inclusive, format YYYY-MM-DD.'),
      end_date: z.string().describe('End date inclusive, format YYYY-MM-DD.'),
      inventory_id: z.array(z.number().int().positive()).optional().describe('Optional inventory item IDs.'),
      sku: z.array(z.string()).optional().describe('Optional SKUs.'),
      marketplace: z.array(z.string()).optional().describe('Optional marketplace names, e.g. Amazon.com.'),
      warehouse: z.array(z.string()).optional().describe('Optional warehouse names. Matches origin_warehouse, destination_warehouse, or shipment_destination.'),
      origin_warehouse: z.array(z.string()).optional().describe('Optional origin warehouse names.'),
      destination_warehouse: z.array(z.string()).optional().describe('Optional destination warehouse names.'),
      io_batch_id: z.array(z.number().int().positive()).optional().describe('Optional IO/source batch IDs.'),
      batch_id: z.array(z.number().int().positive()).optional().describe('Optional final batch document IDs.'),
      document_id: z.array(z.number().int().positive()).optional().describe('Optional document IDs for the transaction document.'),
      document_type: z.array(z.string()).optional().describe('Optional document types, e.g. Invoice, Shipment, Transfer.'),
      document_ref_number: z.array(z.string()).optional().describe('Optional transaction document reference numbers.'),
      transaction_id: z.array(z.number().int().positive()).optional().describe('Optional FIFO transaction IDs.'),
    }).required({ company_id: true, start_date: true, end_date: true }),
    sort: z.object({
      field: z.enum(['document_date', 'transaction_updated_at', 'transaction_id', 'sku', 'quantity', 'transaction_amount']).optional().default('document_date'),
      direction: z.enum(['asc', 'desc']).optional().default('desc'),
    }).optional(),
    limit: z.number().int().min(1).max(10000).optional().default(100),
  }).required({ filters: true }),
}).required({ query: true });

type Input = z.infer<typeof inputSchema>;

function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlVarcharArrayExpr(values: string[] | undefined): string {
  if (!values || values.length === 0) return 'CAST(ARRAY[] AS ARRAY(VARCHAR))';
  return `CAST(ARRAY[${values.map(sqlStringLiteral).join(',')}] AS ARRAY(VARCHAR))`;
}

function sqlBigintArrayExpr(values: number[] | undefined): string {
  if (!values || values.length === 0) return 'CAST(ARRAY[] AS ARRAY(BIGINT))';
  return `CAST(ARRAY[${values.map((n) => String(Math.trunc(n))).join(',')}] AS ARRAY(BIGINT))`;
}

async function getAllowedCompanyIds(inputCompanyIds: number[], context: ToolExecutionContext): Promise<number[]> {
  const permissions = ['view:quicksight_group.finance-new'];

  const allPermittedCompanyIds = new Set<number>();
  for (const permission of permissions) {
    try {
      const permissionResponse = await neonPanelRequest<CompaniesWithPermissionResponse>({
        token: context.userToken,
        path: `/api/v1/permissions/${encodeURIComponent(permission)}/companies`,
      });

      for (const company of permissionResponse.companies ?? []) {
        const id = company.company_id ?? company.companyId ?? company.id;
        if (typeof id === 'number' && Number.isFinite(id) && id > 0) {
          allPermittedCompanyIds.add(id);
        }
      }
    } catch {
      // Keep trying other permissions; one working permission is enough.
    }
  }

  return inputCompanyIds.filter((id) => allPermittedCompanyIds.has(id));
}

export function registerCogsListFifoTransactionsTool(registry: ToolRegistry): void {
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
    name: specJson?.name ?? 'cogs_list_fifo_transactions',
    description: specJson?.description ?? 'List raw FIFO transactions from fifo_transactions_snapshot with period, inventory, warehouse, batch, document, SKU, marketplace, and company filters.',
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
      const input: Input = inputSchema.parse(rawInput);
      const { filters } = input.query;
      const sort = input.query.sort ?? { field: 'document_date' as const, direction: 'desc' as const };
      const limit = input.query.limit ?? 100;
      const allowedCompanyIds = await getAllowedCompanyIds(filters.company_id, context);

      if (allowedCompanyIds.length === 0) {
        return {
          items: [],
          meta: {
            error: 'No permitted companies or access denied. Requires inventory management, finance, bookkeeping, or audit permission.',
            row_count: 0,
            limit,
          },
        };
      }

      const sortFieldMap: Record<NonNullable<typeof sort.field>, string> = {
        document_date: 'document_date',
        transaction_updated_at: 'transaction_updated_at',
        transaction_id: 'transaction_id',
        sku: 'sku',
        quantity: 'quantity',
        transaction_amount: 'transaction_amount',
      };

      const sqlTemplate = await loadTextFile(path.join(__dirname, 'query.sql'));
      const query = renderSqlTemplate(sqlTemplate, {
        company_ids_array: sqlBigintArrayExpr(allowedCompanyIds),
        start_date: sqlStringLiteral(filters.start_date),
        end_date: sqlStringLiteral(filters.end_date),
        inventory_ids_array: sqlBigintArrayExpr(filters.inventory_id),
        skus_array: sqlVarcharArrayExpr(filters.sku),
        marketplaces_array: sqlVarcharArrayExpr(filters.marketplace),
        warehouses_array: sqlVarcharArrayExpr(filters.warehouse),
        origin_warehouses_array: sqlVarcharArrayExpr(filters.origin_warehouse),
        destination_warehouses_array: sqlVarcharArrayExpr(filters.destination_warehouse),
        io_batch_ids_array: sqlBigintArrayExpr(filters.io_batch_id),
        batch_ids_array: sqlBigintArrayExpr(filters.batch_id),
        document_ids_array: sqlBigintArrayExpr(filters.document_id),
        document_types_array: sqlVarcharArrayExpr(filters.document_type),
        document_ref_numbers_array: sqlVarcharArrayExpr(filters.document_ref_number),
        transaction_ids_array: sqlBigintArrayExpr(filters.transaction_id),
        sort_field: sortFieldMap[sort.field ?? 'document_date'],
        sort_direction: (sort.direction ?? 'desc').toUpperCase(),
        limit_rows: String(limit),
      });

      const athenaResult = await runAthenaQuery({
        query,
        database: config.athena.database,
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows: limit,
      });

      const rows = athenaResult.rows ?? [];
      return {
        items: rows,
        meta: {
          query: {
            filters: {
              ...filters,
              company_id: allowedCompanyIds,
            },
            sort,
            limit,
          },
          row_count: rows.length,
          limit,
        },
      };
    },
  });
}