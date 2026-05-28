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

const inputSchema = z
  .object({
    query: z
      .object({
        filters: z
          .object({
            company_ids: z.array(z.coerce.number().int().min(1)).min(1),
            order_ids: z.array(z.string()).max(100).optional(),
            marketplace_ids: z.array(z.string()).optional(),
            order_statuses: z.array(z.string()).optional(),
            fulfillment_channels: z.array(z.string()).optional(),
            seller_ids: z.array(z.string()).optional(),
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
        limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
      })
      .strict(),
  })
  .strict();

export function registerOrdersListOrdersTool(registry: ToolRegistry) {
  const toolJsonPath = path.join(__dirname, 'tool.json');
  const sqlPath = path.join(__dirname, 'query.sql');

  let specJson: ToolSpecJson | undefined;
  try {
    if (fs.existsSync(toolJsonPath)) {
      specJson = JSON.parse(fs.readFileSync(toolJsonPath, 'utf8')) as ToolSpecJson;
    }
  } catch { specJson = undefined; }

  registry.register({
    name: 'orders_list_orders',
    description:
      'Lists placed orders from sp_api_iceberg.orders_v2026. One row per order with fulfillment status, marketplace, order total, and item count. Supports lookup by order_id.',
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

      const time = query.aggregation?.time;
      const periodsBack = time?.periods_back ?? 3;
      const limitTopN = query.limit ?? 50;

      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        catalog: config.athena.catalog,
        company_ids_array: sqlBigintArrayExpr(allowedIds),
        order_ids_array: sqlVarcharArrayExpr(query.filters.order_ids ?? []),
        marketplaces_array: sqlVarcharArrayExpr(query.filters.marketplace_ids ?? []),
        order_statuses_array: sqlVarcharArrayExpr(query.filters.order_statuses ?? []),
        fulfillment_channels_array: sqlVarcharArrayExpr(query.filters.fulfillment_channels ?? []),
        seller_ids_array: sqlVarcharArrayExpr(query.filters.seller_ids ?? []),
        start_date_sql: sqlDateExpr(time?.start_date),
        end_date_sql: sqlDateExpr(time?.end_date),
        periods_back: Number(periodsBack),
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
