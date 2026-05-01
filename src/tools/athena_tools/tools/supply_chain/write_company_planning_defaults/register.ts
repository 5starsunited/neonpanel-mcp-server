import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { neonPanelRequest } from '../../../../../clients/neonpanel-api';
import type { ToolRegistry, ToolSpecJson } from '../../../../types';
import { resolveCompanyUuid } from '../planning-rest';

const planningDefaultsSchema = z.object({
  status: z.enum(['active', 'trial', 'inactive']).optional(),
  default_seasonality: z.string().optional(),
  default_scenario_id: z.coerce.number().int().nullable().optional(),
  default_lead_time_days: z.coerce.number().int().nullable().optional(),
  default_safety_stock_days: z.coerce.number().int().nullable().optional(),
  default_fba_lead_time: z.coerce.number().int().nullable().optional(),
  default_fba_safety_stock: z.coerce.number().int().nullable().optional(),
  default_planned_po_frequency: z.coerce.number().int().optional(),
  default_fba_replenishment_frequency: z.coerce.number().int().optional(),
  default_safety_stock_multiplicator_class_a: z.coerce.number().optional(),
  default_safety_stock_multiplicator_class_b: z.coerce.number().optional(),
  default_safety_stock_multiplicator_class_c: z.coerce.number().optional(),
  default_safety_stock_multiplicator_class_d: z.coerce.number().optional(),
  default_revenue_class_a: z.coerce.number().optional(),
  default_revenue_class_b: z.coerce.number().optional(),
  default_revenue_class_c: z.coerce.number().optional(),
  default_pareto_class_a: z.coerce.number().optional(),
  default_pareto_class_b: z.coerce.number().optional(),
  default_pareto_class_c: z.coerce.number().optional(),
});

const inputSchema = planningDefaultsSchema
  .extend({
    company_id: z.coerce.number().int().min(1).optional(),
    companyUuid: z.string().min(1).optional(),
    dry_run: z.boolean().default(true).optional(),
  })
  .strict()
  .refine((value) => value.company_id || value.companyUuid, {
    message: 'Provide company_id or companyUuid.',
  })
  .refine((value) => {
    const { company_id: _companyId, companyUuid: _companyUuid, dry_run: _dryRun, ...settings } = value;
    return Object.values(settings).some((field) => field !== undefined);
  }, {
    message: 'At least one company planning default must be provided.',
  });

export function registerSupplyChainWriteCompanyPlanningDefaultsTool(registry: ToolRegistry) {
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
    name: specJson?.name ?? 'supply_chain_write_company_planning_defaults',
    description: specJson?.description ?? 'Write company-level inventory planning defaults.',
    isConsequential: true,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const dryRun = parsed.dry_run !== false;
      const companyUuid = await resolveCompanyUuid(parsed, context.userToken);
      const { company_id: _companyId, companyUuid: _companyUuid, dry_run: _dryRun, ...settings } = parsed;
      const operation = {
        method: 'PUT',
        path: `/api/v1/companies/${companyUuid}/settings/forecasts`,
        body: settings,
      };

      if (dryRun) {
        return {
          dry_run: true,
          operation,
        };
      }

      const result = await neonPanelRequest({
        token: context.userToken,
        path: `/api/v1/companies/${encodeURIComponent(companyUuid)}/settings/forecasts`,
        method: 'PUT',
        body: settings,
      });

      return {
        success: true,
        result,
      };
    },
  });
}
