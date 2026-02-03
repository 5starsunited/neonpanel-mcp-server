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
            shipment_type: z.array(z.enum(['REGULAR', 'FBA INBOUND', 'AWD INBOUND'])).optional(),
            destination_warehouse_name: z.string().optional(),
            original_warehouse_name: z.string().optional(),
            delay_threshold_days: z.coerce.number().int().min(0).optional(),
            min_days_in_transit: z.coerce.number().int().min(1).optional(),
            origin_country_code: z.array(z.string()).optional(),
            destination_country_code: z.array(z.string()).optional(),
            include_received: z.boolean().default(false).optional(),
            include_terminal_status: z.boolean().default(false).optional(),
            // New filters
            signal: z.array(z.enum(['Ghost Shipment', 'Delayed', 'On Track', 'Early Arrival'])).optional(),
            shipped_after: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
            shipped_before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
            eta_before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
            // Search filters
            search: z.string().optional(),
            ref_number: z.string().optional(),
          })
          .strict(),
        sort: z
          .object({
            field: z
              .enum(['delay_days', 'days_in_transit', 'tracked_eta', 'p80_eta', 'date_shipped', 'shipment_name', 'urgency_score'])
              .default('delay_days')
              .optional(),
            direction: z.enum(['asc', 'desc']).default('desc').optional(),
          })
          .strict()
          .optional(),
        limit: z.coerce.number().int().min(1).max(500).default(50).optional(),
        // Route aggregation mode
        aggregate_by_route: z.boolean().default(false).optional(),
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
  const routesQueryPath = path.join(toolDir, 'query-routes.sql');

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

      // Build template data - ALWAYS define all variables with defaults (1=1 for no filter)
      const filters = input.query.filters;
      const isRouteMode = input.query.aggregate_by_route === true;
      
      const templateData: Record<string, string | number> = {
        company_id: companyId,
        shipment_type_filter: '1=1',
        shipment_status_filter: "s.shipment_status NOT IN ('CLOSED', 'CANCELLED', 'DELETED', 'ERROR')",
        destination_warehouse_filter: '1=1',
        original_warehouse_filter: '1=1',
        origin_country_filter: '1=1',
        destination_country_filter: '1=1',
        delay_threshold_filter: '1=1',
        min_days_in_transit_filter: '1=1',
        exclude_received_filter: '1=1',
        // New filter defaults
        signal_filter: '1=1',
        shipped_after_filter: '1=1',
        shipped_before_filter: '1=1',
        eta_before_filter: '1=1',
        // Search filter defaults
        search_filter: '1=1',
      };

      // Shipment type filter (logistics model: REGULAR, FBA INBOUND, AWD INBOUND)
      if (filters.shipment_type && filters.shipment_type.length > 0) {
        templateData.shipment_type_filter = `s.shipment_type IN (${toSqlStringList(filters.shipment_type)})`;
      }

      // Shipment status filter: by default excludes CLOSED, CANCELLED, DELETED, ERROR
      // Disabled when: searching (search/ref_number) or include_terminal_status=true
      if (filters.include_terminal_status || filters.search || filters.ref_number) {
        templateData.shipment_status_filter = '1=1';
      }

      // Warehouse filters (partial match)
      if (filters.destination_warehouse_name) {
        const escaped = filters.destination_warehouse_name.replace(/'/g, "''");
        templateData.destination_warehouse_filter = `LOWER(s.destination_warehouse_name) LIKE LOWER('%${escaped}%')`;
      }

      if (filters.original_warehouse_name) {
        const escaped = filters.original_warehouse_name.replace(/'/g, "''");
        templateData.original_warehouse_filter = `LOWER(s.original_warehouse_name) LIKE LOWER('%${escaped}%')`;
      }

      // Country filters
      if (filters.origin_country_code && filters.origin_country_code.length > 0) {
        templateData.origin_country_filter = `s.origin_country_code IN (${toSqlStringList(filters.origin_country_code)})`;
      }

      if (filters.destination_country_code && filters.destination_country_code.length > 0) {
        templateData.destination_country_filter = `s.destination_country_code IN (${toSqlStringList(filters.destination_country_code)})`;
      }

      // Delay threshold filter
      if (filters.delay_threshold_days !== undefined) {
        templateData.delay_threshold_filter = `(CASE WHEN s.tracked_eta IS NOT NULL AND s.p80_eta IS NOT NULL THEN DATE_DIFF('day', s.p80_eta, s.tracked_eta) ELSE NULL END >= ${filters.delay_threshold_days})`;
      }

      // Min days in transit filter
      if (filters.min_days_in_transit !== undefined) {
        templateData.min_days_in_transit_filter = `DATE_DIFF('day', CAST(s.date_shipped AS DATE), CURRENT_DATE) >= ${filters.min_days_in_transit}`;
      }

      // Exclude received shipments by default (in-transit only)
      if (!filters.include_received) {
        templateData.exclude_received_filter = 's.arrived_at IS NULL';
      }

      // Signal filter (NEW)
      if (filters.signal && filters.signal.length > 0) {
        // Build OR conditions for each signal type
        const signalConditions = filters.signal.map((sig) => {
          switch (sig) {
            case 'Ghost Shipment':
              return "(s.arrived_at IS NOT NULL AND (s.total_items_received IS NULL OR s.total_items_received = 0))";
            case 'Delayed':
              return "(s.tracked_eta IS NOT NULL AND s.p80_eta IS NOT NULL AND DATE_DIFF('day', s.p80_eta, s.tracked_eta) > 0)";
            case 'On Track':
              return "(s.arrived_at IS NULL AND (s.tracked_eta IS NULL OR s.p80_eta IS NULL OR DATE_DIFF('day', s.p80_eta, s.tracked_eta) <= 0))";
            case 'Early Arrival':
              return "(s.arrived_at IS NOT NULL AND s.p50_eta IS NOT NULL AND CAST(s.arrived_at AS DATE) < s.p50_eta)";
            default:
              return '1=1';
          }
        });
        templateData.signal_filter = `(${signalConditions.join(' OR ')})`;
      }

      // Search filter (NEW) - searches shipment_name and ref_number
      if (filters.search) {
        const escaped = filters.search.replace(/'/g, "''");
        templateData.search_filter = `(LOWER(s.shipment_name) LIKE LOWER('%${escaped}%') OR LOWER(s.ref_number) LIKE LOWER('%${escaped}%'))`;
      } else if (filters.ref_number) {
        // Exact match for ref_number if specified directly
        const escaped = filters.ref_number.replace(/'/g, "''");
        templateData.search_filter = `s.ref_number = '${escaped}'`;
      }

      // Date range filters (NEW)
      if (filters.shipped_after) {
        templateData.shipped_after_filter = `CAST(s.date_shipped AS DATE) >= DATE '${filters.shipped_after}'`;
      }

      if (filters.shipped_before) {
        templateData.shipped_before_filter = `CAST(s.date_shipped AS DATE) <= DATE '${filters.shipped_before}'`;
      }

      if (filters.eta_before) {
        templateData.eta_before_filter = `(s.tracked_eta IS NOT NULL AND s.tracked_eta <= DATE '${filters.eta_before}')`;
      }

      // Sort clause
      const sortField = input.query.sort?.field || 'delay_days';
      const sortDirection = input.query.sort?.direction || 'desc';
      
      // Map sort fields to SQL columns (different for route mode)
      const sortColumnMap: Record<string, string> = isRouteMode
        ? {
            delay_days: 'avg_delay_days',
            days_in_transit: 'avg_days_in_transit',
            tracked_eta: 'latest_p80_eta',
            p80_eta: 'latest_p80_eta',
            date_shipped: 'total_shipments',
            shipment_name: 'origin_warehouse',
            urgency_score: 'delayed_count',
          }
        : {
            delay_days: 'delay_days',
            days_in_transit: 'days_in_transit',
            tracked_eta: 's.tracked_eta',
            p80_eta: 's.p80_eta',
            date_shipped: 's.date_shipped',
            shipment_name: 's.shipment_name',
            urgency_score: 'urgency_score',
          };

      const sortColumn = sortColumnMap[sortField] || (isRouteMode ? 'avg_delay_days' : 'delay_days');
      templateData.sort_clause = `${sortColumn} ${sortDirection.toUpperCase()} NULLS LAST`;

      // Limit
      templateData.limit = input.query.limit || 50;

      // Choose query based on mode
      const selectedQueryPath = isRouteMode ? routesQueryPath : queryPath;
      const queryTemplate = await loadTextFile(selectedQueryPath);
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

      // Route aggregation mode returns different response structure
      if (isRouteMode) {
        return {
          mode: 'route_aggregation',
          summary: {
            total_routes: rows.length,
            total_shipments: rows.reduce((sum: number, r: any) => sum + (Number(r.total_shipments) || 0), 0),
            routes_with_delays: rows.filter((r: any) => Number(r.delayed_count) > 0).length,
            routes_with_ghost_shipments: rows.filter((r: any) => Number(r.ghost_shipment_count) > 0).length,
          },
          routes: rows.map((row: any) => ({
            origin_warehouse: row.origin_warehouse,
            destination_warehouse: row.destination_warehouse,
            origin_country: row.origin_country_code,
            destination_country: row.destination_country_code,
            shipment_counts: {
              total: Number(row.total_shipments) || 0,
              in_transit: Number(row.in_transit_count) || 0,
              completed: Number(row.completed_count) || 0,
            },
            transit_time_days: {
              avg: row.avg_days_in_transit ? Number(row.avg_days_in_transit).toFixed(1) : null,
              median: row.median_days_in_transit ? Number(row.median_days_in_transit) : null,
              max: row.max_days_in_transit ? Number(row.max_days_in_transit) : null,
            },
            performance: {
              avg_delay_days: row.avg_delay_days ? Number(row.avg_delay_days).toFixed(1) : null,
              reliability_pct: row.reliability_pct ? Number(row.reliability_pct).toFixed(1) : null,
              delayed_count: Number(row.delayed_count) || 0,
              ghost_shipment_count: Number(row.ghost_shipment_count) || 0,
            },
            historical_data: {
              latest_p50_eta: row.latest_p50_eta,
              latest_p80_eta: row.latest_p80_eta,
              latest_p95_eta: row.latest_p95_eta,
            },
          })),
        };
      }

      // Standard shipment-level response
      // Calculate summary with direct data analysis (not relying on signals column)
      const ghostShipments = rows.filter(
        (r: any) => r.arrived_at && (r.total_items_received === null || Number(r.total_items_received) === 0)
      );
      const delayedShipments = rows.filter((r: any) => r.delay_days && Number(r.delay_days) > 0);
      const severelyDelayed = rows.filter((r: any) => r.delay_days && Number(r.delay_days) > 7);
      const stuckInTransit = rows.filter((r: any) => r.days_in_transit && Number(r.days_in_transit) > 45);

      // Group by destination for summary
      const byDestination: Record<string, number> = {};
      rows.forEach((r: any) => {
        const dest = r.destination_warehouse_name || 'Unknown';
        byDestination[dest] = (byDestination[dest] || 0) + 1;
      });

      const summary = {
        total_shipments: rows.length,
        in_transit_count: rows.filter((r: any) => !r.arrived_at).length,
        delayed_count: delayedShipments.length,
        ghost_shipment_count: ghostShipments.length,
        // Enhanced summary
        action_required: {
          ghost_shipments: ghostShipments.length,
          severely_delayed: severelyDelayed.length,
          stuck_in_transit: stuckInTransit.length,
        },
        by_destination: byDestination,
      };

      return {
        summary,
        shipments: rows.map((row: any) => ({
          shipment_id: row.shipment_id,
          shipment_name: row.shipment_name,
          ref_number: row.ref_number,
          shipment_type: row.shipment_type,
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
            has_historical_data: row.has_historical_data === true || row.has_historical_data === 'true',
          },
          urgency_score: row.urgency_score ? Number(row.urgency_score) : 0,
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