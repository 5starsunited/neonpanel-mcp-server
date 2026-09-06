import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runClickHouseQuery } from '../../../../../clients/clickhouse';
import { neonPanelRequest } from '../../../../../clients/neonpanel-api';
import type { ToolRegistry, ToolSpecJson } from '../../../../types';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';

type CompaniesWithPermissionResponse = {
  companies?: Array<{ company_id?: number; companyId?: number; id?: number }>;
};

function sqlEscapeString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
function sqlStringLiteral(value: string): string {
  return `'${sqlEscapeString(value)}'`;
}
function chStringArrayExpr(values: string[]): string {
  if (values.length === 0) return 'CAST([] AS Array(String))';
  return `[${values.map(sqlStringLiteral).join(',')}]`;
}

// Country code -> [marketplace_name, marketplace_id], so callers can filter by 'US' etc.
// Transfers post on the home marketplace, so MCF twins are not needed here.
const COUNTRY_MARKETPLACES: Record<string, [string, string]> = {
  US: ['Amazon.com', 'ATVPDKIKX0DER'],
  CA: ['Amazon.ca', 'A2EUQ1WTGCTBG2'],
  MX: ['Amazon.com.mx', 'A1AM78C64UM0Y8'],
  BR: ['Amazon.com.br', 'A2Q3Y263D00KWC'],
  UK: ['Amazon.co.uk', 'A1F83G8C2ARO7P'],
  GB: ['Amazon.co.uk', 'A1F83G8C2ARO7P'],
  DE: ['Amazon.de', 'A1PA6795UKMFR9'],
  FR: ['Amazon.fr', 'A13V1IB3VIYZZH'],
  IT: ['Amazon.it', 'APJ6JRA9NG5V4'],
  ES: ['Amazon.es', 'A1RKKUPIHCS9HS'],
  NL: ['Amazon.nl', 'A1805IZSGTT6HS'],
  SE: ['Amazon.se', 'A2NODRKZP88ZB9'],
  PL: ['Amazon.pl', 'A1C3SOZRARQ6R3'],
  BE: ['Amazon.com.be', 'AMEN7PMS3EDWL'],
  TR: ['Amazon.com.tr', 'A33AVAJ2PDY3EV'],
  EG: ['Amazon.eg', 'ARBP9OOSHTCHU'],
  SA: ['Amazon.sa', 'A17E79C6D8DWNP'],
  AE: ['Amazon.ae', 'A2VIGQ35RCS4UG'],
  IN: ['Amazon.in', 'A21TJRUUN4KGV'],
  SG: ['Amazon.sg', 'A19VAU5U5O7RUS'],
  JP: ['Amazon.co.jp', 'A1VC38T7YXB528'],
  AU: ['Amazon.com.au', 'A39IBJ37TRP1C6'],
};

function expandMarketplaces(values: string[]): string[] {
  const out = new Set<string>();
  for (const v of values) {
    out.add(v);
    const mapped = COUNTRY_MARKETPLACES[v.toUpperCase()];
    if (mapped) {
      out.add(mapped[0]);
      out.add(mapped[1]);
    }
  }
  return [...out];
}

const querySchema = z
  .object({
    filters: z
      .object({
        company_id: z.coerce.number().int().min(1),
        report_months: z.array(z.string().regex(/^\d{4}-\d{2}$/)).optional(),
        start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        marketplaces: z.array(z.string().min(1)).optional(),
        directions: z.array(z.string().min(1)).optional(),
      })
      .strict(),
    sort_direction: z.enum(['asc', 'desc']).default('desc').optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100).optional(),
  })
  .strict();

type QueryInput = z.infer<typeof querySchema>;

const inputSchema = z
  .object({
    query: querySchema.optional(),
    filters: z.unknown().optional(),
    sort_direction: z.unknown().optional(),
    limit: z.unknown().optional(),
  })
  .strict();

export function registerFinancialsListFinancialTransactionTransfersTool(registry: ToolRegistry) {
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
    name: 'financials_list_financial_transaction_transfers',
    description:
      'Lists individual Amazon payouts and transfers from current-generation ClickHouse financial transactions: disbursements, failed disbursements, and account-level reserve holds/releases.',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const query = querySchema.parse(
        parsed.query ?? {
          filters: parsed.filters,
          sort_direction: parsed.sort_direction,
          limit: parsed.limit,
        },
      ) as QueryInput;

      const permissions = ['view:quicksight_group.finance-new'];

      const allPermittedCompanyIds = new Set<number>();
      for (const permission of permissions) {
        try {
          const permissionResponse = await neonPanelRequest<CompaniesWithPermissionResponse>({
            token: context.userToken,
            path: `/api/v1/permissions/${encodeURIComponent(permission)}/companies`,
          });
          (permissionResponse.companies ?? []).forEach((c) => {
            const id = c?.company_id ?? c?.companyId ?? c?.id;
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
      const marketplaces = expandMarketplaces(
        (query.filters.marketplaces ?? []).map((s) => s.trim()).filter(Boolean),
      );
      const directions = (query.filters.directions ?? []).map((s) => s.trim()).filter(Boolean);
      const chDateOrNull = (d?: string) =>
        d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `toDate('${d}')` : 'CAST(NULL AS Nullable(Date))';
      const limitTopN = query.limit ?? 100;
      const sortDirection = (query.sort_direction ?? 'desc').toUpperCase();

      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        company_id: companyId,
        report_months_array: chStringArrayExpr(reportMonths),
        marketplaces_array: chStringArrayExpr(marketplaces),
        directions_array: chStringArrayExpr(directions),
        start_date: chDateOrNull(query.filters.start_date),
        end_date: chDateOrNull(query.filters.end_date),
        sort_direction: sortDirection,
        limit_top_n: Number(limitTopN),
      });

      const result = await runClickHouseQuery({ query: rendered });

      return {
        items: result.rows ?? [],
        model_notes: [
          'Sign convention: payouts to the bank account are NEGATIVE (money leaving the Amazon balance); failed disbursements returning funds are POSITIVE; reserve holds are negative and releases positive.',
          'direction comes from the classification map (summary_class = Transfers): "Transfers to bank account", "Account level reserves", etc.',
          'Amounts are in the row currency -- do not sum across different currencies.',
          'settlement_id links a payout to its settlement statement (financials_list_amazon_statements).',
        ],
      };
    },
  });
}
