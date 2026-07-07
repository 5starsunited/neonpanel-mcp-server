import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runAthenaQuery } from '../../../../../clients/athena';
import { neonPanelRequest } from '../../../../../clients/neonpanel-api';
import { config } from '../../../../../config';
import type { ToolExecutionContext, ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';

interface CompaniesWithPermissionResponse {
  companies?: Array<{ company_id?: number; companyId?: number; id?: number; name?: string }>;
}

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
    execute: async (input: Input, context: ToolExecutionContext) => {
      const { filters, limit } = input.query;

      // Permission check - user needs at least ONE of these permissions
      const permissions = [
        'view:quicksight_group.inventory_management_new',
        'view:quicksight_group.finance-new',
        'view:quicksight_group.bookkeeping',
        'view:quicksight_group.audit_and_comliance_new',
      ];

      const allPermittedCompanyIds = new Set<number>();
      for (const permission of permissions) {
        try {
          const permissionResponse = await neonPanelRequest<CompaniesWithPermissionResponse>({
            token: context.userToken,
            path: `/api/v1/permissions/${encodeURIComponent(permission)}/companies`,
          });

          const permittedCompanies = (permissionResponse.companies ?? []).filter(
            (c): c is { company_id?: number; companyId?: number; id?: number } =>
              c !== null && typeof c === 'object',
          );

          permittedCompanies.forEach((c) => {
            const id = c.company_id ?? c.companyId ?? c.id;
            if (typeof id === 'number' && Number.isFinite(id) && id > 0) {
              allPermittedCompanyIds.add(id);
            }
          });
        } catch (err) {
          // Continue if one permission check fails
        }
      }

      const permittedCompanyIds = Array.from(allPermittedCompanyIds);
      const requestedCompanyIds = filters.company_id;
      const allowedCompanyIds = requestedCompanyIds.filter((id) => permittedCompanyIds.includes(id));

      if (allowedCompanyIds.length === 0) {
        return {
          items: [],
          meta: {
            error: 'No permitted companies or access denied. Requires view:quicksight_group.inventory_management_new OR view:quicksight_group.finance-new permission',
            row_count: 0,
            limit: limit || 5,
          },
        };
      }

      // Build template data with complete SQL expressions
      const templateData: any = {
        company_id_list: filters.company_id.join(', '),
        limit: limit || 5,
        start_date: '',
        end_date: '',
        sku_filter: '',
        marketplace_filter: '',
        country_filter: '',
      };

      // Build filter expressions (1=1 when no filter, condition when filter provided)
      if (filters.sku && filters.sku.length > 0) {
        const skuList = filters.sku.map(s => `'${s.replace(/'/g, "''")}'`).join(', ');
        templateData.sku_filter = `ft.sku IN (${skuList})`;
      } else {
        templateData.sku_filter = '1=1';
      }

      if (filters.marketplace && filters.marketplace.length > 0) {
        const marketplaceList = filters.marketplace.map(m => `'${m.replace(/'/g, "''")}'`).join(', ');
        templateData.marketplace_filter = `ft.marketplace IN (${marketplaceList})`;
      } else {
        templateData.marketplace_filter = '1=1';
      }

      if (filters.country && filters.country.length > 0) {
        const countryList = filters.country.map(c => `'${c.replace(/'/g, "''")}'`).join(', ');
        templateData.country_filter = `ft.market_country_code IN (${countryList})`;
      } else {
        templateData.country_filter = '1=1';
      }

      // Set date range defaults: last 30 days if not provided
      if (filters.start_date) {
        templateData.start_date = `DATE '${filters.start_date}'`;
      } else {
        templateData.start_date = "CURRENT_DATE - INTERVAL '30' DAY";
      }

      if (filters.end_date) {
        templateData.end_date = `DATE '${filters.end_date}'`;
      } else {
        templateData.end_date = 'CURRENT_DATE';
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
