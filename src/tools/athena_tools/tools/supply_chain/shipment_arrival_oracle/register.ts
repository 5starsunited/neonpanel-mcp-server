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
    uuid?: string;
    name?: string;
    short_name?: string;
  }>;
};

const inputSchema = z
  .object({
    query: z
      .object({
        filters: z
          .object({
            company_id: z.coerce.number().int().min(1),
            shipment_status: z.array(z.enum(['REGULAR', 'FBA INBOUND', 'AWD INBOUND'])).optional(),
            destination_warehouse_name: z.string().optional(),
            original_warehouse_name: z.string().optional(),
            delay_threshold_days: z.coerce.number().int().min(0).optional(),
            min_days_in_transit: z.coerce.number().int().min(1).optional(),
            origin_country_code: z.array(z.string()).optional(),
            destination_country_code: z.array(z.string()).optional(),
            include_received: z.boolean().default(false).optional(),
          })
          .strict(),
        sort: z
          .object({
            field: z
              .enum(['delay_days', 'days_in_transit', 'tracked_eta', 'p80_eta', 'date_shipped', 'shipment_name'])
              .default('delay_days')
              .optional(),
            direction: z.enum(['asc', 'desc']).default('desc').optional(),
          })
          .strict()
          .optional(),
        limit: z.coerce.number().int().min(1).max(500).default(50).optional(),
      })
      .strict(),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;

function toSqlStringList(items: string[]): string {
  return items.map((s) => `'${s.replace(/'/g, "''")}'`).join(', ');
}

export function registerShipmentArrivalOracle(registry: ToolRegistry): void {
  const toolDir = __dirname;
  const specPath = path.join(toolDir, 'tool.json');
  const queryPath = path.join(toolDir, 'query.sql');

  let specJson: ToolSpecJson;
  try {
    const specText = fs.readFileSync(specPath, 'utf-8');
    specJson = JSON.parse(specText) as ToolSpecJson;
  } catch (err) {
    throw new Error(
      `[shipment_arrival_oracle] Failed to load tool.json: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  registry.register({
    name: specJson.name,
    description: specJson.description,
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args: unknown, context: ToolExecutionContext) => {
      const input = inputSchema.parse(args);
      const companyId = input.query.filters.company_id;

      // Verify user has permission for this company - needs at least ONE of these permissions
      const permissions = [
        'view:quicksight_group.inventory_management_new',
        'view:quicksight_group.finance-new',
      ];

      const allPermittedCompanyIds = new Set<number>();
      for (const permission of permissions) {
        try {
          const companiesResponse = await neonPanelRequest<CompaniesWithPermissionResponse>({
            token: context.userToken,
            path: `/api/v1/permissions/${encodeURIComponent(permission)}/companies`,
          });

          const companies = companiesResponse.companies || [];
          companies.forEach((c: { company_id?: number; companyId?: number; id?: number }) => {
            const id = c.company_id ?? c.companyId ?? c.id;
            if (typeof id === 'number' && id > 0) {
              allPermittedCompanyIds.add(id);
            }
          });
        } catch (err) {
          // Continue if one permission check fails
        }
      }

      const hasPermission = allPermittedCompanyIds.has(companyId);

      if (!hasPermission) {
        return {
          content: [
            {
              type: 'text',
              text: `Permission denied: You don't have access to company_id=${companyId}. Requires view:quicksight_group.inventory_management_new OR view:quicksight_group.finance-new permission.`,
            },
          ],
        };
      }

      // Build template data
      const filters = input.query.filters;
      const templateData: Record<string, string | number> = {
        company_id: companyId,
      };

      // Shipment status filter
      if (filters.shipment_status && filters.shipment_status.length > 0) {
        templateData.shipment_status_filter = toSqlStringList(filters.shipment_status);
      }

      // Warehouse filters (partial match)
      if (filters.destination_warehouse_name) {
        templateData.destination_warehouse_filter = 1;
        templateData.destination_warehouse_name = filters.destination_warehouse_name;
      }

      if (filters.original_warehouse_name) {
        templateData.original_warehouse_filter = 1;
        templateData.original_warehouse_name = filters.original_warehouse_name;
      }

      // Country filters
      if (filters.origin_country_code && filters.origin_country_code.length > 0) {
        templateData.origin_country_filter = toSqlStringList(filters.origin_country_code);
      }

      if (filters.destination_country_code && filters.destination_country_code.length > 0) {
        templateData.destination_country_filter = toSqlStringList(filters.destination_country_code);
      }

      // Delay threshold filter
      if (filters.delay_threshold_days !== undefined) {
        templateData.delay_threshold_filter = 1;
        templateData.delay_threshold_days = filters.delay_threshold_days;
      }

      // Min days in transit filter
      if (filters.min_days_in_transit !== undefined) {
        templateData.min_days_in_transit_filter = 1;
        templateData.min_days_in_transit = filters.min_days_in_transit;
      }

      // Exclude received shipments by default (in-transit only)
      if (!filters.include_received) {
        templateData.exclude_received = 1;
      }

      // Sort clause
      const sortField = input.query.sort?.field || 'delay_days';
      const sortDirection = input.query.sort?.direction || 'desc';
      
      // Map sort fields to SQL columns
      const sortColumnMap: Record<string, string> = {
        delay_days: 'delay_days',
        days_in_transit: 'days_in_transit',
        tracked_eta: 's.tracked_eta',
        p80_eta: 's.p80_eta',
        date_shipped: 's.date_shipped',
        shipment_name: 's.shipment_name',
      };

      const sortColumn = sortColumnMap[sortField] || 'delay_days';
      templateData.sort_clause = `${sortColumn} ${sortDirection.toUpperCase()} NULLS LAST`;

      // Limit
      templateData.limit = input.query.limit || 50;

      // Render SQL
      const queryTemplate = await loadTextFile(queryPath);
      const sql = renderSqlTemplate(queryTemplate, templateData);

      // Execute query
      const result = await runAthenaQuery({
        query: sql,
        database: config.athena.database,
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows: templateData.limit as number,
      });

      const rows = result.rows || [];

      // Format response
      const summary = {
        total_shipments: rows.length,
        in_transit_count: rows.filter((r: any) => !r.arrived_at).length,
        delayed_count: rows.filter((r: any) => r.delay_days && Number(r.delay_days) > 0).length,
        ghost_shipment_count: rows.filter(
          (r: any) => r.arrived_at && r.total_items_received === 0 && r.signals?.includes('Ghost'),
        ).length,
      };

      return {
        summary,
        shipments: rows.map((row: any) => ({
          shipment_id: row.shipment_id,
          shipment_name: row.shipment_name,
          ref_number: row.ref_number,
          shipment_status: row.shipment_status,
          route: {
            origin: row.original_warehouse_name,
            origin_country: row.origin_country_code,
            destination: row.destination_warehouse_name,
            destination_country: row.destination_country_code,
          },
          timing: {
            date_shipped: row.date_shipped,
            days_in_transit: row.days_in_transit,
            tracked_eta: row.tracked_eta,
            first_tracked_eta: row.first_tracked_eta,
          },
          statistical_etas: {
            p50_eta: row.p50_eta,
            p80_eta: row.p80_eta,
            p95_eta: row.p95_eta,
            delay_days: row.delay_days,
          },
          status: {
            signals: row.signals,
            arrived_at: row.arrived_at,
            total_items_received: row.total_items_received,
          },
          tracking: row.shipment_tracking_details
            ? JSON.parse(row.shipment_tracking_details as string)
            : null,
        })),
      };
    },
  });
}