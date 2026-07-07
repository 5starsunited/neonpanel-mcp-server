import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runClickHouseQuery } from '../../../../../clients/clickhouse';
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
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function sqlStringLiteral(value: string): string {
  return `'${sqlEscapeString(value)}'`;
}

// ClickHouse array literal; empty arrays need an explicit type.
function chStringArrayExpr(values: string[]): string {
  if (values.length === 0) return 'CAST([] AS Array(String))';
  return `[${values.map(sqlStringLiteral).join(',')}]`;
}

// Country/marketplace expansion identical to the Athena tool (see that register.ts
// for the full commentary, incl. the MCF twin-marketplace rule).
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

const MCF_MARKETPLACES: Record<string, [string, string]> = {
  US: ['Non-Amazon US', 'A2ZV50J4W1RKNI'],
  CA: ['Non-Amazon CA', 'A1MQXOICRS2Z7M'],
  UK: ['Non-Amazon UK', 'AZMDEXL2RVFNN'],
  GB: ['Non-Amazon UK', 'AZMDEXL2RVFNN'],
  DE: ['Non-Amazon DE', 'A38D8NSA03LJTC'],
  FR: ['Non-Amazon FR', 'A1ZFFQZ3HTUKT9'],
  IT: ['Non-Amazon IT', 'A62U237T8HV6N'],
  ES: ['Non-Amazon ES', 'AFQLKURYRPEL8'],
  JP: ['Non-Amazon JP', 'A1VN0HAN483KP2'],
};

const COUNTRY_BY_MARKETPLACE: Record<string, string> = Object.fromEntries(
  Object.entries(COUNTRY_MARKETPLACES).flatMap(([cc, [name, id]]) => [
    [name.toLowerCase(), cc],
    [id, cc],
  ]),
);

function expandMarketplaces(values: string[]): string[] {
  const out = new Set<string>();
  for (const v of values) {
    out.add(v);
    const cc = COUNTRY_MARKETPLACES[v.toUpperCase()] ? v.toUpperCase() : COUNTRY_BY_MARKETPLACE[v.toLowerCase()] ?? COUNTRY_BY_MARKETPLACE[v];
    const mapped = COUNTRY_MARKETPLACES[cc ?? ''];
    if (mapped) {
      out.add(mapped[0]);
      out.add(mapped[1]);
    }
    const mcf = MCF_MARKETPLACES[cc ?? ''];
    if (mcf) {
      out.add(mcf[0]);
      out.add(mcf[1]);
    }
  }
  return [...out];
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
        marketplaces: z.array(z.string().min(1)).optional(),
        marketplace_codes: z.array(z.string().min(1)).optional(),
        start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        consolidation_currency: z.string().regex(/^[A-Za-z]{3}$/).optional(),
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

export function registerFinancialsAnalyzeFinancialTransactionsChTool(registry: ToolRegistry) {
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
    name: 'financials_analyze_financial_transactions_ch',
    description:
      'ClickHouse PILOT twin of financials_analyze_financial_transactions: same analysis (SP-API financial transactions summarized into summary_class / summary_subclass), same filters and output shape, but served from the ClickHouse warehouse instead of Athena (sub-second vs multi-second). DATA FRESHNESS: reads a one-time snapshot loaded 2026-07-06 (transactions through 2026-07-04); use the non-_ch tool when the analysis needs data newer than that. Intended for A/B evaluation of the ClickHouse migration.',
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
      const marketplaces = expandMarketplaces(
        ([...(query.filters.marketplaces ?? []), ...(query.filters.marketplace_codes ?? [])] as string[])
          .map((s) => s.trim())
          .filter(Boolean),
      );
      const summaryClasses = (query.filters.summary_classes ?? []).map((s) => s.trim()).filter(Boolean);
      const summarySubclasses = (query.filters.summary_subclasses ?? []).map((s) => s.trim()).filter(Boolean);
      const chDateOrNull = (d?: string) =>
        d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `toDate('${d}')` : 'CAST(NULL AS Nullable(Date))';
      const consolidationCurrency = query.filters.consolidation_currency?.toUpperCase();
      const limitTopN = query.limit ?? 200;
      const sortField = query.sort?.field ?? 'class_order';
      const sortDirection = query.sort?.direction ?? 'asc';

      const template = await loadTextFile(sqlPath);
      const rendered = renderSqlTemplate(template, {
        database: config.clickhouse.database,
        company_id: companyId,
        report_months_array: chStringArrayExpr(reportMonths),
        marketplaces_array: chStringArrayExpr(marketplaces),
        start_date: chDateOrNull(query.filters.start_date),
        end_date: chDateOrNull(query.filters.end_date),
        consolidation_currency: consolidationCurrency
          ? `CAST(${sqlStringLiteral(consolidationCurrency)} AS Nullable(String))`
          : 'CAST(NULL AS Nullable(String))',
        summary_classes_array: chStringArrayExpr(summaryClasses),
        summary_subclasses_array: chStringArrayExpr(summarySubclasses),
        limit_top_n: Number(limitTopN),
        sort_column: sortField,
        sort_direction: sortDirection.toUpperCase(),
      });

      const result = await runClickHouseQuery({ query: rendered });

      return { items: result.rows ?? [] };
    },
  });
}
