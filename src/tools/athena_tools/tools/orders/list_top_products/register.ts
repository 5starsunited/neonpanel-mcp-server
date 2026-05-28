import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runAthenaQuery } from '../../../../../clients/athena';
import { config } from '../../../../../config';
import type { ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';
import { applySelectFields } from '../select-fields';
import { fetchPermittedCompanyIds, sqlBigintArrayExpr, sqlVarcharArrayExpr, sqlDateExpr } from '../_shared';

const VALID_SORT_FIELDS = new Set(['gross_revenue', 'orders', 'units_ordered']);

const inputSchema = z
  .object({
    query: z
      .object({
        filters: z
          .object({
            company_ids: z.array(z.coerce.number().int().min(1)).min(1),
            asins: z.array(z.string()).max(50).optional(),
            skus: z.array(z.string()).max(50).optional(),
            marketplace_ids: z.array(z.string()).optional(),
            order_statuses: z.array(z.string()).optional(),
          })
          .strict(),
        aggregation: z
          .object({
            time: z
              .object({
                start_date: z.string().optional(),
                end_date: z.string().optional(),
                periods_back: z.coerce.number().int().min(1).max(24).default(3).optional(),
              })
              .optional(),
          })
          .optional(),
        sort: z
          .object({
            field: z.string().optional(),
            direction: z.enum(['asc', 'desc']).default('desc').optional(),
          })
          .optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
      })
      .strict(),
    tool_specific: z
      .object({
        min_orders: z.coerce.number().int().min(0).default(0).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export function registerOrdersListTopProductsTool(registry: ToolRegistry) {
  const toolJsonPath = path.join(__dirname, 'tool.json');
  const sqlPath = path.join(__dirname, 'query.sql');

  let specJson: ToolSpecJson | undefined;
  try {
    if (fs.existsSync(toolJsonPath)) {
      specJson = JSON.parse(fs.readFileSync(toolJsonPath, 'utf8')) as ToolSpecJson;
    }
  } catch { specJson = undefined; }

  registry.register({
    name: 'orders_list_top_products',
    description:
      'Ranks products (ASIN+SKU) by revenue, orders, or units from sp_api_iceberg.orders_v2026. Uses item-level proceeds for accurate revenue.',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const { query, tool_specific } = inputSchema.parse(args);

      const permittedIds = await fetchPermittedCompanyIds(context.userToken);
      const allowedIds = (query.filters.company_ids as number[]).filter((id) =>
        permittedIds.includes(id),
      );
      if (allowedIds.length === 0) return { items: [] };

      const time = query.aggregation?.time;
      const periodsBack = time?.periods_back ?? 3;
      const limitTopN = query.limit ?? 50;
      const sortField = VALID_SORT_FIELDS.has(query.sort?.field ?? '')
        ? query.sort!.field!
        : 'gross_revenue';
      const sortDirection = (query.sort?.direction ?? 'desc').toUpperCase();
      const minOrders = tool_specific?.min_orders ?? 0;

      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        catalog: config.athena.catalog,
        company_ids_array: sqlBigintArrayExpr(allowedIds),
        asins_array: sqlVarcharArrayExpr((query.filters.asins ?? []).map((s) => s.trim())),
        skus_array: sqlVarcharArrayExpr((query.filters.skus ?? []).map((s) => s.trim())),
        marketplaces_array: sqlVarcharArrayExpr(query.filters.marketplace_ids ?? []),
        order_statuses_array: sqlVarcharArrayExpr(query.filters.order_statuses ?? []),
        start_date_sql: sqlDateExpr(time?.start_date),
        end_date_sql: sqlDateExpr(time?.end_date),
        periods_back: Number(periodsBack),
        sort_column: sortField,
        sort_direction: sortDirection,
        min_orders: Number(minOrders),
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
