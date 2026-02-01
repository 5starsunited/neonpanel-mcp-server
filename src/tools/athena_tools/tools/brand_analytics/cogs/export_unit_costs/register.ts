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
      start_date: z.string().optional().describe('Start date (YYYY-MM-DD)'),
      end_date: z.string().optional().describe('End date (YYYY-MM-DD)'),
    }).required({ company_id: true }),
    sort: z.object({
      field: z.enum(['year_month', 'sku', 'marketplace', 'landed_cost']).optional(),
      direction: z.enum(['asc', 'desc']).optional(),
    }).optional(),
    limit: z.number().int().min(1).max(50000).optional().describe('Maximum rows (default: 10000)'),
  }).required({ filters: true }),
}).required({ query: true });

type Input = z.infer<typeof inputSchema>;

interface MonthlyUnitCost {
  company_id: number;
  marketplace: string;
  country: string;
  marketplace_currency: string;
  sku: string;
  year: number;
  month: number;
  year_month: string;
  purchase_price: number;
  logistics_cost: number;
  landed_cost: number;
  last_updated: string;
}

export function registerCogsExportUnitCostsTool(registry: ToolRegistry) {
  let specJson: ToolSpecJson;

  try {
    const specPath = path.join(__dirname, 'tool.json');
    specJson = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
  } catch (err) {
    console.error(`Failed to read tool spec at ${path.join(__dirname, 'tool.json')}:`, err);
    throw new Error(`Failed to load tool spec: ${err}`);
  }

  return registry.register({
    name: 'cogs_export_unit_costs',
    description: 'Export monthly unit costs (purchase price, logistics, landed cost) per SKU for uploading to Sellerboard or other profitability tools',
    inputSchema,
    outputSchema: specJson.outputSchema as Record<string, unknown>,
    specJson,
    execute: async (input: Input) => {
      const { filters, sort, limit } = input.query;

      // Build template data
      const templateData: any = {
        company_id_list: filters.company_id.join(', '),
        has_sku: !!filters.sku && filters.sku.length > 0,
        has_marketplace: !!filters.marketplace && filters.marketplace.length > 0,
        has_country: !!filters.country && filters.country.length > 0,
        has_sort: !!sort?.field,
        has_limit: !!limit,
        sku_list: '',
        marketplace_list: '',
        country_list: '',
        start_date: '',
        end_date: '',
        sort_field: 'year_month',
        sort_direction: 'DESC',
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

      if (filters.start_date) {
        templateData.start_date = `DATE '${filters.start_date}'`;
      } else {
        templateData.start_date = "CURRENT_DATE - INTERVAL '12' MONTH";
      }

      if (filters.end_date) {
        templateData.end_date = `DATE '${filters.end_date}'`;
      } else {
        templateData.end_date = 'CURRENT_DATE';
      }

      if (sort?.field) {
        // Map field names to SQL column names
        const fieldMap: Record<string, string> = {
          year_month: 'year_month',
          sku: 'sku',
          marketplace: 'marketplace',
          landed_cost: 'landed_cost',
        };
        templateData.sort_field = fieldMap[sort.field] || 'year_month';
        templateData.sort_direction = sort.direction?.toUpperCase() || 'DESC';
      }

      if (limit) {
        templateData.limit = limit;
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
        maxRows: limit || 10000,
      });

      const resultRows = athenaResult.rows ?? [];

      return {
        items: resultRows,
        meta: {
          query: {
            filters,
            sort,
            limit: limit || 10000,
          },
          row_count: resultRows.length,
          limit: limit || 10000,
        },
      };
    },
  });
}
