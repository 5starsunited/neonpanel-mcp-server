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

function sqlNullableStringExpr(value: string | null | undefined): string {
  if (value === null || value === undefined) return 'CAST(NULL AS VARCHAR)';
  const trimmed = String(value).trim();
  if (trimmed.length === 0) return 'CAST(NULL AS VARCHAR)';
  return sqlStringLiteral(trimmed);
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const sharedQuerySchema = z
  .object({
    filters: z
      .object({
        company: z.string().optional(),
        company_id: z.coerce.number().int().min(1).optional(),
        brand: z.array(z.string()).optional(),
        marketplace: z.array(z.string()).optional(),
        sales_channel: z.array(z.string()).optional(),
        country_code: z.array(z.string()).optional(),
        currency: z.array(z.string()).optional(),
        product_family: z.array(z.string()).optional(),
        parent_asin: z.array(z.string()).optional(),
        asin: z.array(z.string()).optional(),
        sku: z.array(z.string()).optional(),
        revenue_abcd_class: z.array(z.enum(['A', 'B', 'C', 'D'])).optional(),
        pareto_abc_class: z.array(z.enum(['A', 'B', 'C'])).optional(),
        tags: z.array(z.string()).optional(),
      })
      .catchall(z.unknown())
      .optional(),
    aggregation: z
      .object({
        group_by: z
          .array(z.enum(['company', 'brand', 'marketplace', 'product_family', 'parent_asin', 'asin']))
          .optional(),
      })
      .optional(),
    sort: z
      .object({
        field: z.string().optional(),
        direction: z.enum(['asc', 'desc']).default('desc').optional(),
        nulls: z.enum(['first', 'last']).default('last').optional(),
      })
      .optional(),
    select_fields: z.array(z.string()).optional(),
    limit: z.coerce.number().int().min(1).default(50).optional(),
    cursor: z.string().optional(),
  })
  .strict();

const toolSpecificSchema = z
  .object({
    scenario_uuid: z.string().optional(),
    calc_period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    horizon_months: z.coerce.number().int().min(1).max(24).default(12),
    include_plan_series: z.boolean().default(true),
    include_sales_history_signals: z.boolean().default(true),
    include_actuals: z.boolean().default(false),
    debug: z.boolean().default(false),
  })
  .strict();

const inputSchema = z
  .object({
    query: sharedQuerySchema,
    tool_specific: z.unknown().optional(),
  })
  .strict();

const fallbackOutputSchema = { type: 'object', additionalProperties: true } as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeCompanyIdFilters(filters: any): { companyId?: number; error?: string } {
  if (!filters) return {};

  const companyId = filters.company_id ? Number(filters.company_id) : undefined;
  if (companyId && Number.isFinite(companyId) && companyId > 0) {
    return { companyId: Math.trunc(companyId) };
  }

  if (typeof filters.company === 'string' && filters.company.trim().length > 0) {
    const raw = filters.company.trim();
    if (!/^\d+$/.test(raw)) {
      return {
        error:
          'query.filters.company must be a numeric string (company_id). Do not pass a company name. Call account_list_companies and use query.filters.company_id.',
      };
    }
    return { companyId: Math.trunc(Number(raw)) };
  }

  return {};
}

async function getAllowedCompanyIds(requestedCompanyId: number | undefined, context: ToolExecutionContext) {
  const permission = 'view:quicksight_group.sales_and_marketing_new';
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

  const requestedCompanyIds = requestedCompanyId ? [requestedCompanyId] : permittedCompanyIds;
  const allowedCompanyIds = requestedCompanyIds.filter((id) => permittedCompanyIds.includes(id));

  return { permittedCompanyIds, allowedCompanyIds };
}

// ---------------------------------------------------------------------------
// Group-by dimension helpers for aggregated mode
// ---------------------------------------------------------------------------

type DimColumn = { baseExpr: string; alias: string };

/**
 * Build the list of SQL dimensions for the GROUP BY / SELECT clauses.
 * company_id + company_name are always included for authorization and readability.
 */
function buildGroupByDimensions(groupBy: string[]): DimColumn[] {
  const dims: DimColumn[] = [
    { baseExpr: 't.company_id', alias: 'company_id' },
    { baseExpr: 't.company_name', alias: 'company_name' },
  ];

  for (const key of groupBy) {
    switch (key) {
      case 'company':
        break; // already included above
      case 'brand':
        dims.push({ baseExpr: "COALESCE(t.brand, '__UNKNOWN__')", alias: 'brand' });
        break;
      case 'product_family':
        dims.push({ baseExpr: "COALESCE(t.product_family, '__UNKNOWN__')", alias: 'product_family' });
        break;
      case 'parent_asin':
        dims.push({ baseExpr: "COALESCE(t.parent_asin, '__UNKNOWN__')", alias: 'parent_asin' });
        break;
      case 'marketplace':
        dims.push({ baseExpr: "COALESCE(t.country_code, '__UNKNOWN__')", alias: 'country_code' });
        dims.push({ baseExpr: "COALESCE(t.country, '__UNKNOWN__')", alias: 'country' });
        break;
      case 'asin':
        dims.push({ baseExpr: "COALESCE(t.child_asin, '__UNKNOWN__')", alias: 'child_asin' });
        break;
    }
  }

  return dims;
}

/** Generate the SQL fragment template variables consumed by query_grouped.sql. */
function buildGroupTemplateVars(dims: DimColumn[]): Record<string, string> {
  return {
    group_select_base: dims.map((d) => `${d.baseExpr} AS ${d.alias}`).join(',\n    '),
    group_by_clause_base: dims.map((d) => d.baseExpr).join(', '),
    group_select_raw: dims.map((d) => d.alias).join(', '),
    group_by_clause_raw: dims.map((d) => d.alias).join(', '),
    group_plan_join_condition: dims.map((d) => `gp.${d.alias} = g.${d.alias}`).join(' AND '),
    group_actuals_join_condition: dims.map((d) => `ga.${d.alias} = g.${d.alias}`).join(' AND '),
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerForecastingGetSalesForecastDetailsTool(registry: ToolRegistry) {
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
    name: 'forecasting_get_sales_forecast_details',
    description: 'Get forecast plan details per item. By default returns the latest forecast run; optionally pin to a specific run via scenario_uuid + calc_period (query envelope).',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? fallbackOutputSchema,
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const query = parsed.query;
      const filters = (query.filters ?? {}) as any;
      const toolSpecific = toolSpecificSchema.parse((parsed.tool_specific ?? {}) as unknown);

      const warnings: string[] = [];

      // ---- Company ID resolution ----
      const { companyId, error } = normalizeCompanyIdFilters(filters);
      if (error) {
        return {
          items: [],
          meta: { warnings, error, applied_sort: query.sort ?? null, selected_fields: query.select_fields ?? null },
        };
      }

      // ---- Unsupported-filter warnings ----
      if (filters.tags && Array.isArray(filters.tags) && filters.tags.length > 0) {
        warnings.push('Unsupported filter ignored: query.filters.tags (no tags column in snapshot).');
      }
      if (filters.pareto_abc_class && Array.isArray(filters.pareto_abc_class) && filters.pareto_abc_class.length > 0) {
        warnings.push('Unsupported filter ignored: query.filters.pareto_abc_class (not supported by this tool yet).');
      }
      if (query.cursor) {
        warnings.push('Pagination cursor is not supported yet; ignoring query.cursor.');
      }
      if (query.sort?.field) {
        warnings.push('Server-side sorting is not implemented yet; using default sort (recent sales desc).');
      }

      // ---- Determine aggregation mode from query.aggregation.group_by ----
      const validGroupByKeys = new Set(['company', 'brand', 'marketplace', 'product_family', 'parent_asin', 'asin']);
      const groupBy = [...new Set((query.aggregation?.group_by ?? []).filter((g) => validGroupByKeys.has(g)))];
      const isAggregated = groupBy.length > 0;

      // Zod enum already validates group_by values; no need for runtime unknown-key filtering.

      // ---- Authorization ----
      const { permittedCompanyIds, allowedCompanyIds } = await getAllowedCompanyIds(companyId, context);
      if (permittedCompanyIds.length === 0 || allowedCompanyIds.length === 0) {
        return {
          items: [],
          meta: {
            warnings,
            error: 'No permitted companies for this token (or requested company_id is not permitted).',
          },
        };
      }

      // ---- Athena config ----
      const catalog = config.athena.catalog;
      const database = config.athena.database;
      const table = config.athena.tables.inventoryPlanningSnapshot;
      const forecastingDatabase = config.athena.tables.forecastingDatabase;
      const salesForecastTable = config.athena.tables.salesForecast;

      const limit = Math.min(2000, query.limit ?? 50);
      const skuList = Array.isArray(filters.sku)
        ? filters.sku.map((s: any) => String(s).trim()).filter((s: string) => s.length > 0)
        : [];
      const hasSkuFilter = skuList.length > 0;
      const limitTopN = hasSkuFilter ? Math.max(limit, Math.max(10, skuList.length)) : limit;
      const maxRows = hasSkuFilter ? Math.max(50, limit * 5) : limit;

      // Common template variables shared by both detail and grouped SQL paths.
      const commonTemplateVars: Record<string, string | number> = {
        catalog,
        database,
        table,
        forecasting_database: forecastingDatabase,
        sales_forecast_table: salesForecastTable,

        limit_top_n: Number(limitTopN),
        horizon_months: Number(toolSpecific.horizon_months ?? 12),
        include_plan_series_sql: toolSpecific.include_plan_series ? 'TRUE' : 'FALSE',
        include_actuals_sql: toolSpecific.include_actuals ? 'TRUE' : 'FALSE',

        run_scenario_uuid_sql: sqlNullableStringExpr(toolSpecific.scenario_uuid),
        run_calc_period_sql: sqlNullableStringExpr(toolSpecific.calc_period),

        company_ids_array: sqlCompanyIdArrayExpr(allowedCompanyIds),
        skus_array: sqlVarcharArrayExpr(skuList),
        skus_lower_array: sqlVarcharArrayExpr(skuList.map((s: string) => s.toLowerCase())),
        asins_array: sqlVarcharArrayExpr((filters.asin ?? []).map(String)),
        parent_asins_array: sqlVarcharArrayExpr((filters.parent_asin ?? []).map(String)),
        brands_array: sqlVarcharArrayExpr((filters.brand ?? []).map(String)),
        product_families_array: sqlVarcharArrayExpr((filters.product_family ?? []).map(String)),
        marketplaces_array: sqlVarcharArrayExpr((filters.marketplace ?? []).map((m: any) => String(m).trim().toLowerCase())),
        sales_channels_array: sqlVarcharArrayExpr((filters.sales_channel ?? []).map((s: any) => String(s).trim().toLowerCase())),
        country_codes_array: sqlVarcharArrayExpr((filters.country_code ?? []).map((c: any) => String(c).trim().toLowerCase())),
        revenue_abcd_classes_array: sqlVarcharArrayExpr((filters.revenue_abcd_class ?? []).map(String)),
      };

      // ================================================================
      // AGGREGATED path: group_by was specified
      // ================================================================
      if (isAggregated) {
        const dims = buildGroupByDimensions(groupBy);
        const groupVars = buildGroupTemplateVars(dims);

        const sqlPath = path.join(__dirname, 'query_grouped.sql');
        const template = await loadTextFile(sqlPath);
        const rendered = renderSqlTemplate(template, { ...commonTemplateVars, ...groupVars });

        const athenaResult = await runAthenaQuery({
          query: rendered,
          database,
          workGroup: config.athena.workgroup,
          outputLocation: config.athena.outputLocation,
          maxRows,
        });

        const items = (athenaResult.rows ?? []).map((row) => row as Record<string, unknown>);

        // Defensive: enforce company_id filter client-side.
        const filtered = companyId
          ? items.filter((it) => String((it as any).company_id) === String(companyId))
          : items;

        return {
          items: filtered,
          meta: {
            warnings,
            group_by: groupBy,
            applied_sort: query.sort ?? null,
            selected_fields: query.select_fields ?? null,
          },
        };
      }

      // ================================================================
      // DETAIL (SKU-level) path: no group_by
      // ================================================================
      const sqlPath = path.join(__dirname, 'query.sql');
      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        ...commonTemplateVars,
        include_sales_history_signals_sql: toolSpecific.include_sales_history_signals ? 'TRUE' : 'FALSE',
      });

      const athenaResult = await runAthenaQuery({
        query: rendered,
        database,
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows,
      });

      const items = (athenaResult.rows ?? []).map((row) => row as Record<string, unknown>);

      // If no rows returned for a single-SKU request, run a lightweight debug probe.
      if (items.length === 0 && skuList.length === 1) {
        const requestedSku = skuList[0];
        const debugSql = `
WITH latest_snapshot AS (
  SELECT pil.year, pil.month, pil.day
  FROM "${catalog}"."${database}"."${table}" pil
  WHERE pil.company_id = ${companyId}
  ORDER BY CAST(pil.year AS INTEGER) DESC, CAST(pil.month AS INTEGER) DESC, CAST(pil.day AS INTEGER) DESC
  LIMIT 1
)
SELECT
  pil.company_id,
  pil.inventory_id,
  COALESCE(pil.sku, pil.merchant_sku, fp.sku) AS coalesced_sku,
  lower(COALESCE(pil.sku, pil.merchant_sku, fp.sku)) AS coalesced_sku_lower,
  ${sqlStringLiteral(requestedSku)} AS requested_sku,
  lower(${sqlStringLiteral(requestedSku)}) AS requested_sku_lower,
  contains(array[${sqlStringLiteral(requestedSku)}], COALESCE(pil.sku, pil.merchant_sku, fp.sku)) AS match_exact,
  contains(array[lower(${sqlStringLiteral(requestedSku)})], lower(COALESCE(pil.sku, pil.merchant_sku, fp.sku))) AS match_lower,
  pil.sku AS raw_sku,
  pil.merchant_sku AS raw_merchant_sku,
  fp.sku AS fp_sku,
  pil.child_asin,
  pil.parent_asin,
  pil.country_code,
  pil.year,
  pil.month,
  pil.day
FROM "${catalog}"."${database}"."${table}" pil
LEFT JOIN "${catalog}"."${forecastingDatabase}"."${salesForecastTable}" fp
  ON fp.company_id = pil.company_id
  AND fp.inventory_id = pil.inventory_id
CROSS JOIN latest_snapshot s
WHERE pil.company_id = ${companyId}
  AND pil.year = s.year AND pil.month = s.month AND pil.day = s.day
  AND (
    lower(COALESCE(pil.sku, pil.merchant_sku, fp.sku)) = lower(${sqlStringLiteral(requestedSku)})
    OR COALESCE(pil.sku, pil.merchant_sku, fp.sku) = ${sqlStringLiteral(requestedSku)}
  )
LIMIT 25;`;

        const debugResult = await runAthenaQuery({
          query: debugSql,
          database,
          workGroup: config.athena.workgroup,
          outputLocation: config.athena.outputLocation,
          maxRows: 25,
        });

        // Retry main query with a slightly higher limit to avoid over-pruning.
        const retryRendered = renderSqlTemplate(template, {
          ...commonTemplateVars,
          limit_top_n: Math.min(10, Math.max(3, Number(limit))),
          include_sales_history_signals_sql: toolSpecific.include_sales_history_signals ? 'TRUE' : 'FALSE',
        });

        const retryResult = await runAthenaQuery({
          query: retryRendered,
          database,
          workGroup: config.athena.workgroup,
          outputLocation: config.athena.outputLocation,
          maxRows: Math.min(50, Math.max(10, limit * 5)),
        });

        const retryItems = (retryResult.rows ?? []).map((row) => row as Record<string, unknown>);

        if (retryItems.length > 0) {
          const filtered = companyId
            ? retryItems.filter((it) => String((it as any).company_id) === String(companyId))
            : retryItems;
          return {
            items: filtered,
            meta: {
              warnings: [...warnings, 'Returned via retry with higher limit_top_n. Debug probe attached.'],
              applied_sort: query.sort ?? null,
              selected_fields: query.select_fields ?? null,
              debug_probe: debugResult.rows ?? [],
            },
          };
        }

        return {
          items: [],
          meta: {
            warnings: [...warnings, 'No rows matched; debug probe attached.'],
            applied_sort: query.sort ?? null,
            selected_fields: query.select_fields ?? null,
            debug_probe: debugResult.rows ?? [],
          },
        };
      }

      // Defensive: enforce company_id filter client-side.
      if (companyId) {
        return {
          items: items.filter((it) => String((it as any).company_id) === String(companyId)),
          meta: {
            warnings,
            applied_sort: query.sort ?? null,
            selected_fields: query.select_fields ?? null,
          },
        };
      }

      return {
        items,
        meta: {
          warnings,
          applied_sort: query.sort ?? null,
          selected_fields: query.select_fields ?? null,
        },
      };
    },
  });
}
