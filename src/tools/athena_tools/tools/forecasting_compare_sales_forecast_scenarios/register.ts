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

function sqlNullableStringExpr(value: string | null | undefined): string {
  if (value === null || value === undefined) return 'CAST(NULL AS VARCHAR)';
  const trimmed = String(value).trim();
  if (trimmed.length === 0) return 'CAST(NULL AS VARCHAR)';
  return sqlStringLiteral(trimmed);
}

function sqlNullableTimestampExpr(iso: string | null | undefined): string {
  if (!iso) return 'CAST(NULL AS TIMESTAMP)';
  const trimmed = iso.trim();
  if (trimmed.length === 0) return 'CAST(NULL AS TIMESTAMP)';
  // Athena: from_iso8601_timestamp accepts RFC3339/ISO8601.
  return `from_iso8601_timestamp(${sqlStringLiteral(trimmed)})`;
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

const querySchema = z
  .object({
    filters: z
      .object({
        company: z.string().optional(),
        company_id: z.coerce.number().int().min(1).optional(),

        inventory_ids: z.array(z.coerce.number().int().min(1)).min(1).max(10).optional(),
        sku: z.array(z.string()).min(1).max(10).optional(),
        marketplace: z.array(z.string()).min(1).max(1).optional(),
        country_code: z.array(z.string()).min(1).max(1).optional(),

        parent_asin: z.array(z.string()).min(1).max(10).optional(),
        product_family: z.array(z.string()).min(1).max(5).optional(),
        asin: z.array(z.string()).max(5).optional(),
      })
      .catchall(z.unknown()),
    limit: z.coerce.number().int().min(1).max(500).default(200).optional(),
  })
  .strict();

const toolSpecificSchema = z
  .object({
    compare: z
      .object({
        mode: z.enum(['scenarios', 'runs', 'scenarios_and_runs']).default('scenarios').optional(),

        aggregate: z.enum(['none', 'parent_asin', 'product_family', 'all']).default('none').optional(),
        include_breakdown: z.boolean().default(false).optional(),

        scenario_ids: z.array(z.coerce.number().int().min(1)).optional(),
        scenario_uuids: z.array(z.string()).optional(),
        scenario_names: z.array(z.string()).optional(),

        run_selector: z
          .object({
            type: z.enum(['latest_n', 'date_range']).default('latest_n').optional(),
            n: z.coerce.number().int().min(1).max(10).default(3).optional(),
            updated_at_from: z.string().optional(),
            updated_at_to: z.string().optional(),
          })
          .default({ type: 'latest_n', n: 3 })
          .optional(),

        include_actuals: z.boolean().default(true).optional(),

        period: z
          .object({
            start: z.string().optional(),
            end: z.string().optional(),
          })
          .optional(),
      })
      .default({ mode: 'scenarios', include_actuals: true, run_selector: { type: 'latest_n', n: 3 } })
      .optional(),
  })
  .strict();

const inputSchema = z
  .object({
    query: querySchema,
    tool_specific: toolSpecificSchema.optional(),
  })
  .strict();

function normalizeCompanyId(filters: any): { companyId?: number; error?: string } {
  const companyId = filters.company_id ? Number(filters.company_id) : undefined;
  if (companyId && Number.isFinite(companyId) && companyId > 0) {
    return { companyId: Math.trunc(companyId) };
  }

  if (typeof filters.company === 'string' && filters.company.trim().length > 0) {
    const raw = filters.company.trim();
    if (!/^\d+$/.test(raw)) {
      return {
        error:
          'query.filters.company must be a numeric string (company_id). Do not pass a company name. Call neonpanel_listCompanies and use query.filters.company_id.',
      };
    }
    return { companyId: Math.trunc(Number(raw)) };
  }

  return {};
}

async function getAllowedCompanyIds(requestedCompanyId: number, context: ToolExecutionContext) {
  const permission = 'view:quicksight_group.business_planning_new';
  const permissionResponse = await neonPanelRequest<CompaniesWithPermissionResponse>({
    token: context.userToken,
    path: `/api/v1/permissions/${encodeURIComponent(permission)}/companies`,
  });

  const permittedCompanyIds = (permissionResponse.companies ?? [])
    .map((c) => c.company_id ?? c.companyId ?? c.id)
    .filter((id): id is number => typeof id === 'number' && Number.isFinite(id) && id > 0);

  const allowedCompanyIds = permittedCompanyIds.includes(requestedCompanyId) ? [requestedCompanyId] : [];
  return { permittedCompanyIds, allowedCompanyIds };
}

export function registerForecastingCompareSalesForecastScenariosTool(registry: ToolRegistry) {
  const toolJsonPath = path.join(__dirname, 'tool.json');
  const sqlPath = path.join(__dirname, 'query.sql');

  let specJson: ToolSpecJson | undefined;
  try {
    if (fs.existsSync(toolJsonPath)) {
      specJson = JSON.parse(fs.readFileSync(toolJsonPath, 'utf8')) as ToolSpecJson;
    }
  } catch {
    specJson = undefined;
  }

  registry.register({
    name: 'forecasting_compare_sales_forecast_scenarios',
    description:
      'Deep-dive comparison for a single item across forecast scenarios and/or run history; overlays actuals by default. Use country_code (e.g., US/UK/AU) for SKU-based lookups.',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const filters = (parsed.query.filters ?? {}) as any;
      const toolSpecific = parsed.tool_specific ?? {};
      const compare = toolSpecific.compare ?? {};

      const warnings: string[] = [];

      const { companyId, error } = normalizeCompanyId(filters);
      if (error) {
        return { rows: [], meta: { warnings, error } };
      }
      if (!companyId) {
        return {
          rows: [],
          meta: {
            warnings,
            error: 'query.filters.company_id is required for authorization (or query.filters.company as numeric string).',
          },
        };
      }

      const inventoryIds = Array.isArray(filters.inventory_ids)
        ? filters.inventory_ids
            .map((n: any) => Number(n))
            .filter((n: number) => Number.isFinite(n) && n > 0)
            .slice(0, 10)
        : [];

      const skuList = Array.isArray(filters.sku)
        ? filters.sku
            .map((s: any) => String(s).trim())
            .filter((s: string) => s.length > 0)
            .slice(0, 10)
        : [];

      const countryCodeRaw = Array.isArray(filters.country_code)
        ? String(filters.country_code[0] ?? '').trim()
        : Array.isArray(filters.marketplace)
          ? String(filters.marketplace[0] ?? '').trim()
          : '';

      const parentAsins = Array.isArray(filters.parent_asin)
        ? filters.parent_asin
            .map((s: any) => String(s).trim())
            .filter((s: string) => s.length > 0)
            .slice(0, 10)
        : [];

      const productFamilies = Array.isArray(filters.product_family)
        ? filters.product_family
            .map((s: any) => String(s).trim())
            .filter((s: string) => s.length > 0)
            .slice(0, 5)
        : [];

      const selectorFlags = {
        inventory: inventoryIds.length > 0,
        sku: skuList.length > 0,
        parent_asin: parentAsins.length > 0,
        product_family: productFamilies.length > 0,
      };

      const activeSelectors = Object.entries(selectorFlags)
        .filter(([, active]) => active)
        .map(([key]) => key);

      if (activeSelectors.length === 0) {
        return {
          rows: [],
          meta: {
            warnings,
            error:
              'Item selector required: inventory_ids OR (sku + country_code) OR parent_asin OR product_family must be provided.',
          },
        };
      }

      if (activeSelectors.length > 1) {
        return {
          rows: [],
          meta: {
            warnings,
            error: `Provide exactly one selector type. Found: ${activeSelectors.join(', ')}. Precedence is inventory_ids > sku > parent_asin > product_family.`,
          },
        };
      }

      if (selectorFlags.sku && countryCodeRaw.length === 0) {
        return {
          rows: [],
          meta: {
            warnings,
            error: 'query.filters.country_code (or marketplace) is required when selecting by sku.',
          },
        };
      }

      if (Array.isArray(compare.scenario_ids) && compare.scenario_ids.length > 0) {
        warnings.push('compare.scenario_ids is not supported yet; use compare.scenario_names.');
      }
      if (Array.isArray(compare.scenario_uuids) && compare.scenario_uuids.length > 0) {
        warnings.push('compare.scenario_uuids is not supported yet; use compare.scenario_names.');
      }

      const { permittedCompanyIds, allowedCompanyIds } = await getAllowedCompanyIds(companyId, context);
      if (permittedCompanyIds.length === 0 || allowedCompanyIds.length === 0) {
        return { rows: [], meta: { warnings, error: 'Not authorized for requested company_id.' } };
      }

      const limit = Math.min(500, parsed.query.limit ?? 200);
      const aggregateMode = String(compare.aggregate ?? 'none');
      const includeBreakdown = Boolean(compare.include_breakdown ?? false);
      const detailNeeded = aggregateMode === 'none' || includeBreakdown;
      const aggregateNeeded = aggregateMode !== 'none';
      const selectorCount = selectorFlags.inventory
        ? inventoryIds.length
        : selectorFlags.sku
          ? skuList.length
          : selectorFlags.parent_asin
            ? parentAsins.length
            : selectorFlags.product_family
              ? productFamilies.length
              : 0;
      const fallbackMaxItems = Math.min(limit, 20);
      const maxItems =
        selectorFlags.inventory || selectorFlags.sku
          ? Math.max(1, Math.min(selectorCount, 20))
          : Math.max(1, fallbackMaxItems);
      const rowsPerItemEstimate = aggregateNeeded && detailNeeded ? 400 : detailNeeded ? 250 : 150;
      const rowLimit = Math.min(5000, Math.max(limit, maxItems * rowsPerItemEstimate));
      const maxRows = aggregateNeeded && detailNeeded ? Math.min(6000, rowLimit * 2) : rowLimit;

      const template = await loadTextFile(sqlPath);
      const query = renderSqlTemplate(template, {
        catalog: config.athena.catalog,
        database: config.athena.database,
        table: config.athena.tables.inventoryPlanningSnapshot,

        forecast_catalog: config.athena.catalog,
        forecast_database: config.athena.tables.forecastingDatabase,
        forecast_table_sales_forecast: config.athena.tables.salesForecast,
        forecast_table_sales_history: config.athena.tables.salesHistory,

        company_ids_array: sqlCompanyIdArrayExpr(allowedCompanyIds),

        inventory_ids_array: sqlCompanyIdArrayExpr(inventoryIds),
        sku_array: sqlVarcharArrayExpr(skuList),
  sku_lower_array: sqlVarcharArrayExpr(skuList.map((s: string) => s.toLowerCase())),
  sku_normalized_array: sqlVarcharArrayExpr(skuList.map((s: string) => s.trim().toLowerCase())),
        marketplace_sql: countryCodeRaw.length > 0 ? sqlStringLiteral(countryCodeRaw) : 'CAST(NULL AS VARCHAR)',
  marketplace_lower_sql: countryCodeRaw.length > 0 ? sqlStringLiteral(countryCodeRaw.trim().toLowerCase()) : 'CAST(NULL AS VARCHAR)',
        parent_asins_array: sqlVarcharArrayExpr(parentAsins),
  parent_asins_lower_array: sqlVarcharArrayExpr(parentAsins.map((s: string) => s.toLowerCase())),
        product_families_array: sqlVarcharArrayExpr(productFamilies),
  product_families_lower_array: sqlVarcharArrayExpr(productFamilies.map((s: string) => s.toLowerCase())),

        apply_inventory_id_filter_sql: sqlBooleanLiteral(selectorFlags.inventory),
        apply_sku_filter_sql: sqlBooleanLiteral(selectorFlags.sku),
        apply_parent_asin_filter_sql: sqlBooleanLiteral(selectorFlags.parent_asin),
        apply_product_family_filter_sql: sqlBooleanLiteral(selectorFlags.product_family),

        scenario_names_array: sqlVarcharArrayExpr(
          (Array.isArray(compare.scenario_names) ? compare.scenario_names : [])
            .map((s: any) => String(s).trim())
            .filter((s: string) => s.length > 0),
        ),

        compare_mode_sql: sqlStringLiteral(String(compare.mode ?? 'scenarios')),

        aggregate_mode_sql: sqlStringLiteral(aggregateMode),
        include_breakdown_sql: sqlBooleanLiteral(includeBreakdown),
        detail_needed_sql: sqlBooleanLiteral(detailNeeded),
        aggregate_needed_sql: sqlBooleanLiteral(aggregateNeeded),

        limit_top_n: Number(rowLimit),

        run_selector_type_sql: sqlStringLiteral(String(compare.run_selector?.type ?? 'latest_n')),
        run_latest_n: Number(compare.run_selector?.n ?? 3),
        updated_at_from_sql: sqlNullableTimestampExpr(compare.run_selector?.updated_at_from ?? null),
        updated_at_to_sql: sqlNullableTimestampExpr(compare.run_selector?.updated_at_to ?? null),

        include_actuals_sql: sqlBooleanLiteral(Boolean(compare.include_actuals ?? true)),

        period_start_sql: sqlNullableStringExpr(compare.period?.start ?? null),
        period_end_sql: sqlNullableStringExpr(compare.period?.end ?? null),

        max_items: maxItems,
      });

      const athenaResult = await runAthenaQuery({
        query,
        database: config.athena.database,
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows,
      });

      const rowsRaw = (athenaResult.rows ?? []) as Array<Record<string, any>>;
      if (rowsRaw.length === 0) {
        return {
          items: [],
          aggregates: [],
          meta: {
            warnings,
            applied_compare: compare,
          },
        };
      }

      const detailRows = rowsRaw.filter((r) => r.row_type === 'detail');
      const aggregateRows = rowsRaw.filter((r) => r.row_type === 'aggregate');

      const itemsByKey = new Map<
        string,
        {
          item_ref: Record<string, any>;
          series: Map<
            string,
            {
              series_type: any;
              scenario_name: any;
              run_updated_at: any;
              currency: any;
              rows: Record<string, any>[];
            }
          >;
        }
      >();

      for (const r of detailRows) {
        const itemKey = [r.company_id, r.inventory_id, r.sku, r.marketplace].join('|');
        if (!itemsByKey.has(itemKey)) {
          itemsByKey.set(itemKey, {
            item_ref: {
              company_id: r.company_id,
              inventory_id: r.inventory_id,
              sku: r.sku,
              marketplace: r.marketplace,
              child_asin: r.child_asin,
              parent_asin: r.parent_asin,
              asin: r.asin,
              product_name: r.product_name,
              product_family: r.product_family,
              snapshot_date: r.snapshot_date,
            },
            series: new Map(),
          });
        }

        const itemEntry = itemsByKey.get(itemKey)!;
        const seriesKey = [r.series_type, r.scenario_name, r.run_updated_at, r.currency].join('|');
        if (!itemEntry.series.has(seriesKey)) {
          itemEntry.series.set(seriesKey, {
            series_type: r.series_type,
            scenario_name: r.scenario_name,
            run_updated_at: r.run_updated_at,
            currency: r.currency,
            rows: [],
          });
        }

        const seriesEntry = itemEntry.series.get(seriesKey)!;
        seriesEntry.rows.push({
          period: r.period,
          units_sold: r.units_sold,
          sales_amount: r.sales_amount,
          unit_price: r.unit_price,
          seasonality_index: r.seasonality_index,
        });
      }

      const aggregatesByKey = new Map<string, { group: Record<string, any>; rows: Record<string, any>[] }>();
      for (const r of aggregateRows) {
        const key = [r.group_product_family ?? '', r.group_parent_asin ?? ''].join('|');
        if (!aggregatesByKey.has(key)) {
          aggregatesByKey.set(key, {
            group: {
              product_family: r.group_product_family,
              parent_asin: r.group_parent_asin,
            },
            rows: [],
          });
        }

        const entry = aggregatesByKey.get(key)!;
        entry.rows.push({
          series_type: r.series_type,
          scenario_name: r.scenario_name,
          run_updated_at: r.run_updated_at,
          period: r.period,
          units_sold: r.units_sold,
          sales_amount: r.sales_amount,
          unit_price: r.unit_price,
          currency: r.currency,
          seasonality_index: r.seasonality_index,
        });
      }

      return {
        items: Array.from(itemsByKey.values()).map((entry) => ({
          item_ref: entry.item_ref,
          series: Array.from(entry.series.values()),
        })),
        aggregates: Array.from(aggregatesByKey.values()),
        meta: {
          warnings,
          applied_compare: compare,
        },
      };
    },
  });
}
