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

const inputSchema = z
  .object({
    company_id: z.coerce.number().int().min(1),
    tool: z.enum(['sqp', 'scp', 'global']).optional(),
    include_defaults: z.boolean().default(true).optional(),
  })
  .strict();

async function isAuthorizedForCompany(companyId: number, context: ToolExecutionContext): Promise<boolean> {
  const permissions = [
    'view:quicksight_group.sales_and_marketing_new',
    'view:quicksight_group.marketing',
  ];
  for (const permission of permissions) {
    try {
      const resp = await neonPanelRequest<CompaniesWithPermissionResponse>({
        token: context.userToken,
        path: `/api/v1/permissions/${encodeURIComponent(permission)}/companies`,
      });
      const ids = (resp.companies ?? [])
        .map((c) => c.company_id ?? c.companyId ?? c.id)
        .filter((id): id is number => typeof id === 'number' && Number.isFinite(id) && id > 0);
      if (ids.includes(companyId)) return true;
    } catch {
      // continue
    }
  }
  return false;
}

export function registerBrandAnalyticsListRygThresholdsTool(registry: ToolRegistry) {
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
    name: specJson?.name ?? 'brand_analytics_list_ryg_thresholds',
    description:
      specJson?.description ??
      'Lists RYG signal thresholds (defaults + company overrides) for Brand Analytics tools.',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);

      const authorized = await isAuthorizedForCompany(parsed.company_id, context);
      if (!authorized) {
        return { items: [], error: 'Not authorized for this company.' };
      }

      const catalog = config.athena.catalog;
      const includeDefaults = parsed.include_defaults !== false;

      const toolFilter = parsed.tool
        ? `tool = '${parsed.tool}'`
        : 'TRUE';

      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        catalog,
        company_id_sql: String(parsed.company_id),
        include_defaults: includeDefaults ? 'TRUE' : 'FALSE',
        tool_filter_sql: toolFilter,
      });

      const athenaResult = await runAthenaQuery({
        query: rendered,
        database: 'brand_analytics_iceberg',
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows: 200,
      });

      return { items: athenaResult.rows ?? [] };
    },
  });
}
