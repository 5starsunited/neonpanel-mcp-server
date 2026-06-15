import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runAthenaQuery } from '../../../../../clients/athena';
import { config } from '../../../../../config';
import type { ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';
import { applySelectFields } from '../select-fields';
import {
  fetchPermittedCompanyIds,
  sqlBigintArrayExpr,
  sqlVarcharArrayExpr,
} from '../_shared';

// Hours offset from UTC for local bucketing. Default -8 matches the NeonPanel
// report's LA (Pacific) setting; pass -7 for PDT or 0 for UTC.
const DEFAULT_UTC_OFFSET_HOURS = -8;

// Maps the group_by dimension to the SQL expression used in the `enriched` CTE.
const GROUP_DIM_EXPR: Record<string, string> = {
  inventory_id: 'CAST(e.inventory_id AS VARCHAR)',
  sku: 'e.sku',
  asin: 'e.asin',
  product_family: 'e.product_family',
  brand: 'e.brand',
  company_id: 'CAST(e.company_id AS VARCHAR)',
};

const inputSchema = z
  .object({
    query: z
      .object({
        filters: z
          .object({
            company_ids: z.array(z.coerce.number().int().min(1)).min(1),
            marketplace_ids: z.array(z.string()).optional(),
            order_statuses: z.array(z.string()).optional(),
            fulfillment_channels: z.array(z.string()).optional(),
            seller_ids: z.array(z.string()).optional(),
            asins: z.array(z.string()).optional(),
            skus: z.array(z.string()).optional(),
            brands: z.array(z.string()).optional(),
            product_families: z.array(z.string()).optional(),
          })
          .strict(),
        aggregation: z
          .object({
            granularity: z.enum(['hour', 'day', 'week', 'month']).default('day').optional(),
            group_by: z
              .enum(['inventory_id', 'sku', 'asin', 'product_family', 'brand', 'company_id'])
              .default('sku')
              .optional(),
            comparison_offsets_days: z
              .array(z.coerce.number().int().min(1).max(1095))
              .min(1)
              .max(6)
              .optional(),
            utc_offset_hours: z.coerce.number().int().min(-14).max(14).optional(),
          })
          .optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100).optional(),
      })
      .strict(),
  })
  .strict();

/** Builds the per-window pivot columns inside `agg` (offset 0 = current). */
function buildMetricPivotColumns(offsets: number[]): string {
  const cols: string[] = [];
  for (const off of [0, ...offsets]) {
    const label = off === 0 ? 'current' : `prev_${off}d`;
    cols.push(
      `SUM(CASE WHEN offset_days = ${off} THEN units END) AS ${label}_units_sold`,
      `ROUND(SUM(CASE WHEN offset_days = ${off} THEN sales_amount END), 2) AS ${label}_sales`,
      `ROUND(SUM(CASE WHEN offset_days = ${off} THEN sales_amount_main END), 2) AS ${label}_sales_main`,
      `ROUND(SUM(CASE WHEN offset_days = ${off} THEN sales_amount END) / NULLIF(SUM(CASE WHEN offset_days = ${off} THEN units END), 0), 4) AS ${label}_avg_price`,
    );
  }
  return cols.join(',\n    ');
}

/** Builds the final projection: current metrics + each comparison + % deltas vs current. */
function buildSelectColumns(offsets: number[]): string {
  const cols: string[] = [
    'current_units_sold',
    'current_sales',
    'current_sales_main',
    'current_avg_price',
  ];
  for (const off of offsets) {
    const p = `prev_${off}d`;
    cols.push(
      `${p}_units_sold`,
      `${p}_sales`,
      `${p}_sales_main`,
      `${p}_avg_price`,
      `ROUND(100.0 * (current_units_sold - ${p}_units_sold) / NULLIF(${p}_units_sold, 0), 1) AS units_pct_vs_${off}d`,
      `ROUND(100.0 * (current_sales - ${p}_sales) / NULLIF(${p}_sales, 0), 1) AS sales_pct_vs_${off}d`,
      `ROUND(100.0 * (current_avg_price - ${p}_avg_price) / NULLIF(${p}_avg_price, 0), 1) AS price_pct_vs_${off}d`,
    );
  }
  return cols.join(',\n  ');
}

export function registerOrdersCompareSalesVelocityTool(registry: ToolRegistry) {
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
    name: 'customer_orders_compare_amazon_sales_velocity',
    description:
      'Compares period-to-date Amazon sales velocity (units_sold, sales, avg price) for the current grain bucket (hour/day/week/month) against the same elapsed window shifted back by day offsets (default yesterday / 7d / 30d / 365d). Grouped by inventory_id, sku, asin, product_family, brand, or company_id.',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const { query } = inputSchema.parse(args);

      const permittedIds = await fetchPermittedCompanyIds(context.userToken);
      const allowedIds = (query.filters.company_ids as number[]).filter((id) =>
        permittedIds.includes(id),
      );
      if (allowedIds.length === 0) return { items: [] };

      const agg = query.aggregation;
      const granularity = agg?.granularity ?? 'day';
      const groupBy = agg?.group_by ?? 'sku';
      const utcOffsetHours = agg?.utc_offset_hours ?? DEFAULT_UTC_OFFSET_HOURS;
      // De-duplicate + sort offsets for stable, predictable column ordering.
      const offsets = Array.from(
        new Set((agg?.comparison_offsets_days ?? [1, 7, 30, 365]).map((n) => Math.trunc(n))),
      ).sort((a, b) => a - b);
      const limitTopN = query.limit ?? 100;

      // Prune partitions to cover the oldest comparison window (+2 month buffer).
      const maxOffset = offsets[offsets.length - 1] ?? 1;
      const pruneMonthsBack = Math.ceil(maxOffset / 30) + 2;

      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        catalog: config.athena.catalog,
        company_ids_array: sqlBigintArrayExpr(allowedIds),
        marketplaces_array: sqlVarcharArrayExpr(query.filters.marketplace_ids ?? []),
        order_statuses_array: sqlVarcharArrayExpr(query.filters.order_statuses ?? []),
        fulfillment_channels_array: sqlVarcharArrayExpr(query.filters.fulfillment_channels ?? []),
        seller_ids_array: sqlVarcharArrayExpr(query.filters.seller_ids ?? []),
        skus_array: sqlVarcharArrayExpr(query.filters.skus ?? []),
        asins_array: sqlVarcharArrayExpr(query.filters.asins ?? []),
        brands_array: sqlVarcharArrayExpr(query.filters.brands ?? []),
        product_families_array: sqlVarcharArrayExpr(query.filters.product_families ?? []),
        offsets_array: sqlBigintArrayExpr(offsets),
        utc_offset_hours: Number(utcOffsetHours),
        granularity,
        group_by: groupBy,
        group_dim_expr: GROUP_DIM_EXPR[groupBy],
        prune_months_back: pruneMonthsBack,
        metric_pivot_columns: buildMetricPivotColumns(offsets),
        select_columns: buildSelectColumns(offsets),
        limit_top_n: Number(limitTopN),
      });

      const result = await runAthenaQuery({
        query: rendered,
        database: 'sp_api_iceberg',
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows: limitTopN,
      });

      return applySelectFields(result.rows ?? [], undefined);
    },
  });
}
