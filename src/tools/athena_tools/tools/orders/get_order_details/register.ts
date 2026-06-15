import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runAthenaQuery } from '../../../../../clients/athena';
import { config } from '../../../../../config';
import type { ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';
import { applySelectFields } from '../select-fields';
import { fetchPermittedCompanyIds, sqlStringLiteral } from '../_shared';

const inputSchema = z
  .object({
    company_id: z.coerce.number().int().min(1),
    order_id: z.string().min(1),
  })
  .strict();

export function registerOrdersGetOrderDetailsTool(registry: ToolRegistry) {
  const toolJsonPath = path.join(__dirname, 'tool.json');
  const sqlPath = path.join(__dirname, 'query.sql');

  let specJson: ToolSpecJson | undefined;
  try {
    if (fs.existsSync(toolJsonPath)) {
      specJson = JSON.parse(fs.readFileSync(toolJsonPath, 'utf8')) as ToolSpecJson;
    }
  } catch { specJson = undefined; }

  registry.register({
    name: 'customer_orders_get_amazon_customer_order_details',
    description:
      'Fetches full details for a single Amazon order from sp_api_iceberg.orders_v2026, including all order items expanded into individual rows.',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const { company_id, order_id } = inputSchema.parse(args);

      const permittedIds = await fetchPermittedCompanyIds(context.userToken);
      if (!permittedIds.includes(company_id)) return { items: [] };

      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        catalog: config.athena.catalog,
        company_id_str: sqlStringLiteral(String(company_id)),
        order_id_str: sqlStringLiteral(order_id),
      });

      const result = await runAthenaQuery({
        query: rendered,
        database: 'sp_api_iceberg',
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows: 200,
      });

      return applySelectFields(result.rows ?? [], undefined);
    },
  });
}
