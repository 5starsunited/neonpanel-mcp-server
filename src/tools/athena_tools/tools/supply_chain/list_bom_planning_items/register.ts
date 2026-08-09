import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runClickHouseQuery } from '../../../../../clients/clickhouse';
import type { ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';
import { canReadSupplyChainCompany, sqlStringArray, sqlUInt64Array } from '../bom-planning';

const inputSchema = z
  .object({
    company_id: z.coerce.number().int().min(1),
    skus: z.array(z.string().min(1)).max(100).optional(),
    inventory_ids: z.array(z.coerce.number().int().min(1)).max(100).optional(),
    marketplaces: z.array(z.string().min(1)).max(20).optional(),
    planning_source: z.array(z.enum(['ASSEMBLE', 'PURCHASE'])).optional(),
    components_only: z.boolean().default(false).optional(),
    min_assembly_shortfall_units: z.coerce.number().min(0).optional(),
    sort_by: z
      .enum(['assembly_shortfall_units_actual', 'days_of_cover_incl_components', 'sku'])
      .default('assembly_shortfall_units_actual')
      .optional(),
    sort_direction: z.enum(['asc', 'desc']).default('desc').optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(100).optional(),
  })
  .strict();

export function registerSupplyChainListBomPlanningItemsTool(registry: ToolRegistry): void {
  const toolJsonPath = path.join(__dirname, 'tool.json');
  const specJson = JSON.parse(fs.readFileSync(toolJsonPath, 'utf8')) as ToolSpecJson;

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
        skus_array: sqlStringArray(input.skus ?? []),
        inventory_ids_array: sqlUInt64Array(input.inventory_ids ?? []),
        marketplaces_array: sqlStringArray(input.marketplaces ?? []),
        planning_sources_array: sqlStringArray(input.planning_source ?? []),
        components_only: input.components_only ? 'TRUE' : 'FALSE',
        min_shortfall: input.min_assembly_shortfall_units ?? 0,
        apply_min_shortfall: input.min_assembly_shortfall_units === undefined ? 'FALSE' : 'TRUE',
        sort_by: input.sort_by ?? 'assembly_shortfall_units_actual',
        sort_direction: input.sort_direction ?? 'desc',
        limit: input.limit ?? 100,
      });
      const result = await runClickHouseQuery({ query });

      return {
        items: result.rows,
        meta: {
          warnings: [],
          grain: 'company x marketplace x inventory item',
          source: 'etl.inventory_planning_bom',
        },
      };
    },
  });
}