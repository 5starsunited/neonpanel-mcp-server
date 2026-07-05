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
  companies?: Array<{ company_id?: number; companyId?: number; id?: number }>;
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

// How the classification engine applies these rules -- returned with every response so an AI
// client can reason about (and explain) the mapping without reading source code.
const CLASSIFICATION_RULES = [
  'Every financial transaction line carries a service key (match_key): the verbatim Amazon breakdownType leaf, a composite "<type>:<description>" for context-dependent leaves (Base:*, BaseTax:*, Promo:* inside ServiceFee, Tax:* inside Adjustment, FBADisposalFee:legacy before 2026-06-19), or "TXN:<transactionType>[:<description>]" for transactions without breakdowns.',
  'A line matches a rule on (match_key, sign, fulfillment): sign is POS when the line amount >= 0 and NEG when < 0 -- the class is usually constant per service while the SUBCLASS flips with sign (charge vs refund).',
  'Fulfillment-specific rules (fulfillment = AFN or MFN) take precedence over the "*" wildcard -- e.g. Commission NEG resolves to "FBA selling fees" (AFN), "Seller fulfilled selling fees" (MFN), or "Selling fees" (*) as fallback.',
  'Lines with no matching rule report under summary_class "Unclassified" with subclass "Unmapped: <match_key>" -- money is never dropped; new Amazon fee types surface visibly until a mapping row is added (a data change, never a code change).',
  'class_order / subclass_order define the display order used by Amazon-statement-style reports: 1=Income, 2=Expenses, 3=Tax, 4=Transfers.',
  'This taxonomy reproduces the Amazon Seller Central "Monthly Unified Summary" statement lines and was reconciled line-by-line against a real statement (Jun-2026): all class totals tie exactly.',
];

const querySchema = z
  .object({
    filters: z
      .object({
        search: z.string().min(1).optional(),
        summary_classes: z.array(z.string().min(1)).optional(),
      })
      .strict()
      .optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(500).optional(),
  })
  .strict();

type QueryInput = z.infer<typeof querySchema>;

const inputSchema = z
  .object({
    query: querySchema.optional(),
    filters: z.unknown().optional(),
    limit: z.unknown().optional(),
  })
  .strict();

export function registerFinancialsListFinancialTransactionClassMapTool(registry: ToolRegistry) {
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
    name: 'financials_list_financial_transaction_class_map',
    description:
      'Explains how financial-transaction SERVICES map to summary classes: returns the full classification rulebook (neonpanel_iceberg.financial_transaction_class_map) -- one rule per (service key, sign, fulfillment) -> summary_class / summary_subclass -- plus a plain-language description of how the engine resolves rules (sign flips subclass, AFN/MFN beats "*", unmapped -> Unclassified). Use financials_list_financial_transaction_services to see which services actually occur in a company\'s data.',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const query = querySchema.parse(
        parsed.query ?? { filters: parsed.filters, limit: parsed.limit },
      ) as QueryInput;

      // The class map is org-level configuration (no tenant data), but access still requires
      // membership in at least one finance/bookkeeping-permitted company.
      const permissions = [
        'view:quicksight_group.bookkeeping',
        'view:quicksight_group.audit_and_comliance_new',
        'view:quicksight_group.finance-new',
      ];
      let hasAnyPermission = false;
      for (const permission of permissions) {
        try {
          const permissionResponse = await neonPanelRequest<CompaniesWithPermissionResponse>({
            token: context.userToken,
            path: `/api/v1/permissions/${encodeURIComponent(permission)}/companies`,
          });
          if ((permissionResponse.companies ?? []).length > 0) {
            hasAnyPermission = true;
            break;
          }
        } catch {
          // Continue if one permission check fails.
        }
      }
      if (!hasAnyPermission) {
        return { items: [] };
      }

      const search = query.filters?.search;
      const summaryClasses = (query.filters?.summary_classes ?? []).map((s) => s.trim()).filter(Boolean);
      const limitTopN = query.limit ?? 500;

      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        catalog: config.athena.catalog,
        search: search ? sqlStringLiteral(search) : 'CAST(NULL AS VARCHAR)',
        summary_classes_array: sqlVarcharArrayExpr(summaryClasses),
        limit_top_n: Number(limitTopN),
      });

      const athenaResult = await runAthenaQuery({
        query: rendered,
        database: 'neonpanel_iceberg',
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows: limitTopN,
      });

      return {
        classification_rules: CLASSIFICATION_RULES,
        items: athenaResult.rows ?? [],
      };
    },
  });
}
