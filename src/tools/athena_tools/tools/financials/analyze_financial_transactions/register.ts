import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runAthenaQuery } from '../../../../../clients/athena';
import { neonPanelRequest } from '../../../../../clients/neonpanel-api';
import { config } from '../../../../../config';
import type { ToolRegistry, ToolSpecJson } from '../../../../types';
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

const SORTABLE_FIELDS = [
  'class_order',
  'subclass_order',
  'summary_class',
  'summary_subclass',
  'debits',
  'credits',
  'net_amount',
  'line_count',
] as const;

const querySchema = z
  .object({
    filters: z
      .object({
        company_id: z.coerce.number().int().min(1),
        report_months: z.array(z.string().regex(/^\d{4}-\d{2}$/)).optional(),
        summary_classes: z.array(z.string()).optional(),
        summary_subclasses: z.array(z.string()).optional(),
      })
      .strict(),
    sort: z
      .object({
        field: z.enum(SORTABLE_FIELDS).default('class_order').optional(),
        direction: z.enum(['asc', 'desc']).default('asc').optional(),
      })
      .optional(),
    limit: z.coerce.number().int().min(1).max(500).default(200).optional(),
  })
  .strict();

type QueryInput = z.infer<typeof querySchema>;

const inputSchema = z
  .object({
    query: querySchema.optional(),
    filters: z.unknown().optional(),
    sort: z.unknown().optional(),
    limit: z.unknown().optional(),
  })
  .strict();

export function registerFinancialsAnalyzeFinancialTransactionsTool(registry: ToolRegistry) {
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
    name: 'financials_analyze_financial_transactions',
    description:
      'Analyzes Amazon monthly financial transactions into the same summary_class / summary_subclass structure used by monthly payment summary reports. Use this to reconcile a payment/summary report against financial_transactions instead of Amazon statement settlement data.',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const query = querySchema.parse(
        parsed.query ?? {
          filters: parsed.filters,
          sort: parsed.sort,
          limit: parsed.limit,
        },
      ) as QueryInput;

      const permissions = [
        'view:quicksight_group.bookkeeping',
        'view:quicksight_group.audit_and_comliance_new',
        'view:quicksight_group.finance-new',
      ];

      const allPermittedCompanyIds = new Set<number>();
      for (const permission of permissions) {
        try {
          const permissionResponse = await neonPanelRequest<CompaniesWithPermissionResponse>({
            token: context.userToken,
            path: `/api/v1/permissions/${encodeURIComponent(permission)}/companies`,
          });

          const permittedCompanies = (permissionResponse.companies ?? []).filter(
            (c): c is { company_id?: number; companyId?: number; id?: number } =>
              c !== null && typeof c === 'object',
          );

          permittedCompanies.forEach((c) => {
            const id = c.company_id ?? c.companyId ?? c.id;
            if (typeof id === 'number' && Number.isFinite(id) && id > 0) {
              allPermittedCompanyIds.add(id);
            }
          });
        } catch {
          // Continue if one permission check fails.
        }
      }

      const companyId = Math.trunc(query.filters.company_id);
      if (!allPermittedCompanyIds.has(companyId)) {
        return { items: [] };
      }

      const reportMonths = (query.filters.report_months ?? []).map((s) => s.trim()).filter(Boolean);
      const summaryClasses = (query.filters.summary_classes ?? []).map((s) => s.trim()).filter(Boolean);
      const summarySubclasses = (query.filters.summary_subclasses ?? []).map((s) => s.trim()).filter(Boolean);
      const limitTopN = query.limit ?? 200;
      const sortField = query.sort?.field ?? 'class_order';
      const sortDirection = query.sort?.direction ?? 'asc';

      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        catalog: config.athena.catalog,
        company_id: companyId,
        report_months_array: sqlVarcharArrayExpr(reportMonths),
        summary_classes_array: sqlVarcharArrayExpr(summaryClasses),
        summary_subclasses_array: sqlVarcharArrayExpr(summarySubclasses),
        limit_top_n: Number(limitTopN),
        sort_column: sortField,
        sort_direction: sortDirection.toUpperCase(),
      });

      const athenaResult = await runAthenaQuery({
        query: rendered,
        database: 'neonpanel_iceberg',
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows: limitTopN,
      });

      return { items: athenaResult.rows ?? [] };
    },
  });
}