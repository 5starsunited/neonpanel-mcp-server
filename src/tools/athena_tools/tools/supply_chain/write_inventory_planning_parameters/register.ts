import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { neonPanelRequest } from '../../../../../clients/neonpanel-api';
import type { ToolRegistry, ToolSpecJson } from '../../../../types';
import { resolveCompanyUuid } from '../planning-rest';

const restockDataSchema = z
  .object({
    daily_sales_target: z.coerce.number().optional(),
    unit_vendor_price: z.coerce.number().optional(),
    unit_landed_cost: z.coerce.number().optional(),
    estimated_daily_sales: z.coerce.number().optional(),
    estimated_price: z.coerce.number().optional(),
    lead_time_days: z.coerce.number().int().optional(),
    safety_stock_days: z.coerce.number().int().optional(),
    fba_lead_time_days: z.coerce.number().int().optional(),
    fba_safety_stock_days: z.coerce.number().int().optional(),
    target_fba_fee: z.coerce.number().optional(),
    target_price: z.coerce.number().optional(),
    target_referral_percentage: z.coerce.number().optional(),
    daily_unit_sales_target: z.coerce.number().optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'At least one restock_data field must be provided.',
  });

const writeSchema = z
  .object({
    inventory_id: z.coerce.number().int().min(1),
    restock_data: restockDataSchema,
  })
  .strict();

const inputSchema = z
  .object({
    company_id: z.coerce.number().int().min(1).optional(),
    companyUuid: z.string().min(1).optional(),
    dry_run: z.boolean().default(true).optional(),
    writes: z.array(writeSchema).min(1).max(50),
  })
  .strict()
  .refine((value) => value.company_id || value.companyUuid, {
    message: 'Provide company_id or companyUuid.',
  });

export function registerSupplyChainWriteInventoryPlanningParametersTool(registry: ToolRegistry) {
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
    name: specJson?.name ?? 'supply_chain_write_inventory_planning_parameters',
    description: specJson?.description ?? 'Write item-level inventory planning parameters.',
    isConsequential: true,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const dryRun = parsed.dry_run !== false;
      const companyUuid = await resolveCompanyUuid(parsed, context.userToken);
      const operations = parsed.writes.map((write) => ({
        method: 'PUT',
        path: `/api/v1/companies/${companyUuid}/inventory-items/${write.inventory_id}`,
        body: { restock_data: write.restock_data },
      }));

      if (dryRun) {
        return {
          dry_run: true,
          writes_count: parsed.writes.length,
          operations,
        };
      }

      const results = [];
      for (const write of parsed.writes) {
        const result = await neonPanelRequest({
          token: context.userToken,
          path: `/api/v1/companies/${encodeURIComponent(companyUuid)}/inventory-items/${encodeURIComponent(String(write.inventory_id))}`,
          method: 'PUT',
          body: { restock_data: write.restock_data },
        });
        results.push({ inventory_id: write.inventory_id, result });
      }

      return {
        success: true,
        updated_count: results.length,
        results,
      };
    },
  });
}
