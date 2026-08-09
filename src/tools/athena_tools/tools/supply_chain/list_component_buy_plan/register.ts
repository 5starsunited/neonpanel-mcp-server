import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runClickHouseQuery } from '../../../../../clients/clickhouse';
import type { ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';
import { canReadSupplyChainCompany, sqlStringArray } from '../bom-planning';

const inputSchema = z
  .object({
    company_id: z.coerce.number().int().min(1),
    component_skus: z.array(z.string().min(1)).max(100).optional(),
    stock_record: z.enum(['all', 'present', 'missing']).default('all').optional(),
    requirement_basis: z.enum(['actual', 'plan']).default('actual').optional(),
    min_net_requirement_units: z.coerce.number().min(0).default(0).optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(100).optional(),
  })
  .strict();

export function registerSupplyChainListComponentBuyPlanTool(registry: ToolRegistry): void {
  const specJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'tool.json'), 'utf8')) as ToolSpecJson;

  registry.register({
    name: specJson.name,
    description: specJson.description,
    isConsequential: false,
    inputSchema,
    outputSchema: specJson.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const input = inputSchema.parse(args);
      if (!(await canReadSupplyChainCompany(context, input.company_id))) {
        return { items: [], meta: { warnings: ['No authorized company found for company_id.'] } };
      }

      const template = await loadTextFile(path.join(__dirname, 'query.sql'));
      const query = renderSqlTemplate(template, {
        company_id: input.company_id,
        component_skus_array: sqlStringArray(input.component_skus ?? []),
        stock_record: input.stock_record ?? 'all',
        requirement_basis: input.requirement_basis ?? 'actual',
        min_net_requirement: input.min_net_requirement_units ?? 0,
        limit: input.limit ?? 100,
      });
      const result = await runClickHouseQuery({ query });
      const missingStockRecords = result.rows.filter((row) => Number(row.has_inventory_item) === 0).length;

      return {
        items: result.rows,
        meta: {
          warnings:
            missingStockRecords > 0
              ? [`${missingStockRecords} component(s) have demand but no active inventory stock record.`]
              : [],
          grain: 'company x component product',
          source: 'etl.inventory_planning_component_plan',
          requirement_basis: input.requirement_basis ?? 'actual',
        },
      };
    },
  });
}