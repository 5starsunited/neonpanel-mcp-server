import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runAthenaQuery } from '../../../../../../clients/athena';
import { config } from '../../../../../../config';
import type { ToolRegistry, ToolSpecJson } from '../../../../../types';
import { loadTextFile } from '../../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../../runtime/render-sql';

const inputSchema = z.object({
  query: z.object({
    filters: z.object({
      company_id: z.array(z.number().int().positive()).min(1).describe('Company IDs (required for partition pruning)'),
      sku: z.array(z.string()).optional().describe('Filter by specific SKUs'),
      marketplace: z.array(z.string()).optional().describe('Filter by marketplace'),
      country: z.array(z.string()).optional().describe('Filter by country code'),
      transaction_direction: z.enum(['inbound', 'outbound']).optional().describe('Filter by transaction direction'),
      start_date: z.string().optional().describe('Start date (YYYY-MM-DD)'),
      end_date: z.string().optional().describe('End date (YYYY-MM-DD)'),
    }).required({ company_id: true }),
    limit: z.number().int().min(1).max(1000).optional().describe('Maximum rows (default: 5)'),
  }).required({ filters: true }),
}).required({ query: true });

type Input = z.infer<typeof inputSchema>;

interface LostBatchTransaction {
  transaction_id: number;
  company_id: number;
  sku: string;
  marketplace: string;
  country: string;
  marketplace_currency: string;
  document_date: string;
  transaction_direction: string;
  quantity: number;
  item_purchase_price: number;
  item_logistics_cost: number;
  item_landed_cost: number;
  lost_amount_total: number;
  destination_warehouse: string | null;
  origin_warehouse: string | null;
}

export function registerCogsListLostBatchesTool(registry: ToolRegistry) {
  let specJson: ToolSpecJson;

  try {
    const specPath = path.join(__dirname, 'tool.json');
    specJson = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
  } catch (err) {
    console.error(`Failed to read tool spec at ${path.join(__dirname, 'tool.json')}:`, err);
    throw new Error(`Failed to load tool spec: ${err}`);
  }

  return registry.register({
    name: 'cogs_list_lost_batches',
    description: 'List transactions where batch tracking failed (batch is NULL). Shows lost cost tracking sorted by amount.',
    inputSchema,
    outputSchema: specJson.outputSchema as Record<string, unknown>,
    specJson,
    execute: async (input: Input) => {
      const { filters, limit } = input.query;

      // Build template data
      const templateData: any = {
        company_id_list: filters.company_id.join(', '),
        has_sku: !!filters.sku && filters.sku.length > 0,
        has_marketplace: !!filters.marketplace && filters.marketplace.length > 0,
        has_country: !!filters.country && filters.country.length > 0,
        has_transaction_direction: !!filters.transaction_direction,
        limit: limit || 5,
      };

      // Add filter values with SQL quoting
      if (filters.sku && filters.sku.length > 0) {
        templateData.sku_list = filters.sku.map(s => `'${s.replace(/'/g, "''")}'`).join(', ');
      }

      if (filters.marketplace && filters.marketplace.length > 0) {
        templateData.marketplace_list = filters.marketplace.map(m => `'${m.replace(/'/g, "''")}'`).join(', ');
      }

      if (filters.country && filters.country.length > 0) {
        templateData.country_list = filters.country.map(c => `'${c.replace(/'/g, "''")}'`).join(', ');
      }

      if (filters.transaction_direction) {
        templateData.transaction_direction = filters.transaction_direction;
      }

      if (filters.start_date) {
        templateData.start_date = filters.start_date;
      }

      if (filters.end_date) {
        templateData.end_date = filters.end_date;
      }

      // Load and render SQL template
      const sqlTemplatePath = path.join(__dirname, 'query.sql');
      const sqlTemplate = await loadTextFile(sqlTemplatePath);
      const query = renderSqlTemplate(sqlTemplate, templateData);

      // Execute query
      const athenaResult = await runAthenaQuery({
        query,
        database: config.athena.database,
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows: limit || 5,
      });

      const resultRows = athenaResult.rows ?? [];

      return {
        items: resultRows,
        meta: {
          query: {
            filters,
            limit: limit || 5,
          },
          row_count: resultRows.length,
          limit: limit || 5,
        },
      };
    },
  });
}
