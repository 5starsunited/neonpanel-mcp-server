import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runAthenaQuery } from '../../../../clients/athena';
import { neonPanelRequest } from '../../../../clients/neonpanel-api';
import { config } from '../../../../config';
import type { ToolExecutionContext, ToolRegistry, ToolSpecJson } from '../../../types';
import { loadTextFile } from '../../runtime/load-assets';
import { renderSqlTemplate } from '../../runtime/render-sql';

type CompaniesWithPermissionResponse = {
  companies?: Array<{
    company_id?: number;
    companyId?: number;
    id?: number;
  }>;
};

function sqlEscapeString(value: string): string {
  return value.replace(/'/g, "''");
}

function sqlStringLiteral(value: string): string {
  return `'${sqlEscapeString(value)}'`;
}

function sqlVarcharArrayExpr(values: string[]): string {
  if (values.length === 0) return 'CAST(ARRAY[] AS ARRAY(VARCHAR))';
  return `CAST(ARRAY[${values.map(sqlStringLiteral).join(',')}] AS ARRAY(VARCHAR))`;
}

function sqlCompanyIdArrayExpr(values: number[]): string {
  if (values.length === 0) return 'CAST(ARRAY[] AS ARRAY(BIGINT))';
  return `CAST(ARRAY[${values.map((n) => String(Math.trunc(n))).join(',')}] AS ARRAY(BIGINT))`;
}

function sqlBooleanLiteral(value: boolean): string {
  return value ? 'TRUE' : 'FALSE';
}

function sqlIntegerLiteral(value: number): string {
  return String(Math.trunc(value));
}

function sqlDoubleLiteral(value: number): string {
  return String(value);
}

function sqlStringLiteralExpr(value: string | null | undefined): string {
  if (!value) return 'CAST(NULL AS VARCHAR)';
  return sqlStringLiteral(value);
}

const sharedQuerySchema = z
  .object({
    filters: z
      .object({
        company: z.string().optional(),
        company_id: z.coerce.number().int().min(1).optional(),
        brand: z.array(z.string()).optional(),
        marketplace: z.array(z.string()).optional(),
        product_family: z.array(z.string()).optional(),
        parent_asin: z.array(z.string()).optional(),
        asin: z.array(z.string()).optional(),
        sku: z.array(z.string()).optional(),
        revenue_abcd_class: z.array(z.enum(['A', 'B', 'C', 'D'])).optional(),
        tags: z.array(z.string()).optional(),
      })
      .catchall(z.unknown())
      .optional(),
    sort: z
      .object({
        field: z.string().optional(),
        direction: z.enum(['asc', 'desc']).default('asc').optional(),
        nulls: z.enum(['first', 'last']).default('last').optional(),
      })
      .optional(),
    select_fields: z.array(z.string()).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(50).optional(),
    cursor: z.string().optional(),
  })
  .strict();

const toolSpecificSchema = z
  .object({
    min_days_of_supply: z.coerce.number().int().min(1).max(90).default(28).optional(),
    velocity_weighting: z
      .object({
        weight_30d: z.coerce.number().min(0).max(1).default(0.5).optional(),
        weight_7d: z.coerce.number().min(0).max(1).default(0.3).optional(),
        weight_3d: z.coerce.number().min(0).max(1).default(0.2).optional(),
      })
      .optional(),
    velocity_weighting_mode: z.enum(['balanced', 'conservative', 'aggressive']).optional(),
    include_warehouse_stock: z.boolean().default(true).optional(),
    include_inbound_details: z.boolean().default(true).optional(),
    p80_arrival_buffer_days: z.coerce.number().int().min(0).max(30).default(0).optional(),
    stockout_risk_filter: z.array(z.enum(['high', 'moderate', 'low', 'ok'])).optional(),
    supply_buffer_risk_filter: z.array(z.enum(['high', 'moderate', 'low', 'ok'])).optional(),
  })
  .strict();

const inputSchema = z
  .object({
    query: sharedQuerySchema,
    tool_specific: z.unknown().optional(),
  })
  .strict();

const fallbackOutputSchema = { type: 'object', additionalProperties: true } as const;

async function resolveCompanyIds(
  companyInput: string | number | undefined,
  context: ToolExecutionContext,
): Promise<number[]> {
  let companyIds: number[] = [];

  // Direct company_id if provided
  if (typeof companyInput === 'number' && companyInput > 0) {
    companyIds.push(companyInput);
  } else if (typeof companyInput === 'string') {
    const parsed = parseInt(companyInput, 10);
    if (!isNaN(parsed) && parsed > 0) {
      companyIds.push(parsed);
    }
  }

  // Fallback: fetch from NeonPanel API
  if (companyIds.length === 0) {
    try {
      const permission = 'view:quicksight_group.business_planning_new';
      const response = await neonPanelRequest<CompaniesWithPermissionResponse>({
        token: context.userToken,
        path: `/api/v1/permissions/${encodeURIComponent(permission)}/companies`,
      });
      const companies = response.companies ?? [];
      companyIds = companies
        .map((c) => c.company_id ?? c.companyId ?? c.id)
        .filter((id): id is number => typeof id === 'number' && id > 0);
    } catch {
      // If API fails, default to empty (will cause SQL to return no results)
      companyIds = [];
    }
  }

  return companyIds;
}

function enrichWithRecommendations(rows: any[]): any[] {
  return rows.map((row) => {
    const warehouse_options: any[] = [];
    const po_rec = {
      recommended_po_qty: 100, // TODO: compute based on risk tier + velocity
      rationale: 'Restore supply to minimum threshold',
      urgency:
        row.stockout_risk_tier === 'high' || row.supply_buffer_risk_tier === 'high'
          ? 'immediate'
          : row.stockout_risk_tier === 'moderate' || row.supply_buffer_risk_tier === 'moderate'
            ? 'urgent'
            : 'soon',
      lead_time_estimate_days: 7, // TODO: fetch from supplier data
    };

    return {
      ...row,
      warehouse_replenishment_options: warehouse_options,
      purchase_order_recommendation: po_rec,
    };
  });
}

export function registerSupplyChainListStockReplenishmentRiskItemsTool(registry: ToolRegistry) {
  const toolJsonPath = path.join(__dirname, 'tool.json');

  let specJson: ToolSpecJson | undefined;
  try {
    if (fs.existsSync(toolJsonPath)) {
      specJson = JSON.parse(fs.readFileSync(toolJsonPath, 'utf8')) as ToolSpecJson;
    }
  } catch {
    specJson = undefined;
  }

  registry.register({
    name: 'supply_chain_list_stock_replenishment_risk_items',
    description: 'List items at risk of stockout or insufficient days-of-supply with replenishment recommendations',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? fallbackOutputSchema,
    specJson,
    execute: async (args: unknown, context: ToolExecutionContext): Promise<any> => {
      try {
        // Parse and validate input
        const parsed = inputSchema.parse(args);
        const toolSpecific = toolSpecificSchema.parse(parsed.tool_specific ?? {});
        const query = parsed.query;

        // Resolve company IDs
        const companyIds = await resolveCompanyIds(query.filters?.company_id ?? query.filters?.company, context);
        if (companyIds.length === 0) {
          return {
            items: [],
            meta: {
              warnings: ['No authorized companies found'],
              risk_distribution: {},
            },
          };
        }

        // Load SQL template
        const sqlPath = path.join(__dirname, 'query.sql');
        const sqlTemplate = await loadTextFile(sqlPath);

        // Render template with parameters
        const renderedSql = renderSqlTemplate(sqlTemplate, {
          company_ids_array: sqlCompanyIdArrayExpr(companyIds),
          skus_array: sqlVarcharArrayExpr(query.filters?.sku ?? []),
          inventory_ids_array: sqlVarcharArrayExpr((query.filters?.inventory_id as any) ?? []),
          asins_array: sqlVarcharArrayExpr(query.filters?.asin ?? []),
          parent_asins_array: sqlVarcharArrayExpr(query.filters?.parent_asin ?? []),
          brands_array: sqlVarcharArrayExpr(query.filters?.brand ?? []),
          product_families_array: sqlVarcharArrayExpr(query.filters?.product_family ?? []),
          countries_array: sqlVarcharArrayExpr(query.filters?.marketplace ?? []),
          revenue_abcd_classes_array: sqlVarcharArrayExpr(query.filters?.revenue_abcd_class ?? []),

          min_days_of_supply: sqlIntegerLiteral(toolSpecific.min_days_of_supply ?? 28),
          p80_arrival_buffer_days: sqlIntegerLiteral(toolSpecific.p80_arrival_buffer_days ?? 0),
          include_warehouse_stock: sqlBooleanLiteral(toolSpecific.include_warehouse_stock ?? true),
          include_inbound_details: sqlBooleanLiteral(toolSpecific.include_inbound_details ?? true),
          velocity_weighting_mode: sqlStringLiteral(toolSpecific.velocity_weighting_mode ?? 'balanced'),
          weight_30d: sqlDoubleLiteral(toolSpecific.velocity_weighting?.weight_30d ?? 0.5),
          weight_7d: sqlDoubleLiteral(toolSpecific.velocity_weighting?.weight_7d ?? 0.3),
          weight_3d: sqlDoubleLiteral(toolSpecific.velocity_weighting?.weight_3d ?? 0.2),
          stockout_risk_filter_array: sqlVarcharArrayExpr(toolSpecific.stockout_risk_filter ?? []),
          supply_buffer_risk_filter_array: sqlVarcharArrayExpr(toolSpecific.supply_buffer_risk_filter ?? []),

          limit_top_n: sqlIntegerLiteral(query.limit ?? 50),
          sort_field: sqlStringLiteralExpr(query.sort?.field ?? null),
          sort_direction: sqlStringLiteralExpr(query.sort?.direction ?? 'asc'),

          catalog: config.athena.catalog,
          database: config.athena.database,
        });

        // Execute query
        const results = await runAthenaQuery({
          query: renderedSql,
          database: config.athena.database,
          workGroup: config.athena.workgroup,
          outputLocation: config.athena.outputLocation,
          maxRows: query.limit ?? 50,
        });

        if (!results?.rows || results.rows.length === 0) {
          return {
            items: [],
            meta: {
              applied_sort: query.sort ?? { field: 'stockout_risk_tier', direction: 'asc' },
              selected_fields: query.select_fields,
              included_fields: [
                'inventory_id',
                'sku',
                'country_code',
                'current_fba_stock',
                'warehouse_stock',
                'sales_velocity_30d',
                'inbound_units',
                'days_of_supply_p50',
                'days_of_supply_p80',
                'days_of_supply_p95',
                'stockout_risk_tier',
                'supply_buffer_risk_tier',
                'recommendation',
              ],
              risk_distribution: { stockout_risk: {}, supply_buffer_risk: {} },
              warnings: [],
            },
          };
        }

        // Enrich with recommendations
        const enriched = enrichWithRecommendations(results.rows);

        // Compute risk distribution
        const risk_dist = {
          stockout_risk: { high: 0, moderate: 0, low: 0, ok: 0 },
          supply_buffer_risk: { high: 0, moderate: 0, low: 0, ok: 0 },
        };
        for (const row of enriched) {
          const stockout_tier = row.stockout_risk_tier as string | undefined;
          const buffer_tier = row.supply_buffer_risk_tier as string | undefined;
          if (stockout_tier && stockout_tier in risk_dist.stockout_risk) {
            risk_dist.stockout_risk[stockout_tier as keyof typeof risk_dist.stockout_risk]++;
          }
          if (buffer_tier && buffer_tier in risk_dist.supply_buffer_risk) {
            risk_dist.supply_buffer_risk[buffer_tier as keyof typeof risk_dist.supply_buffer_risk]++;
          }
        }

        return {
          items: enriched,
          meta: {
            applied_sort: query.sort ?? { field: 'stockout_risk_tier', direction: 'asc' },
            selected_fields: query.select_fields,
            included_fields: [
              'inventory_id',
              'sku',
              'child_asin',
              'parent_asin',
              'brand',
              'product_family',
              'product_name',
              'country_code',
              'current_fba_stock',
              'warehouse_stock',
              'total_available_stock',
              'sales_velocity_30d',
              'sales_velocity_7d',
              'sales_velocity_3d',
              'weighted_velocity',
              'inbound_units',
              'inbound_p50_days',
              'inbound_p80_days',
              'inbound_p95_days',
              'inbound_shipment_count',
              'days_of_supply_p50',
              'days_of_supply_p80',
              'days_of_supply_p95',
              'stockout_risk_tier',
              'supply_buffer_risk_tier',
              'stockout_critical_velocity',
              'supply_buffer_critical_velocity',
              'warehouse_replenishment_options',
              'purchase_order_recommendation',
            ],
            risk_distribution: risk_dist,
            warnings: [],
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          items: [],
          meta: {
            warnings: [message],
            risk_distribution: { stockout_risk: {}, supply_buffer_risk: {} },
            error: message,
          },
        };
      }
    },
  });
}
