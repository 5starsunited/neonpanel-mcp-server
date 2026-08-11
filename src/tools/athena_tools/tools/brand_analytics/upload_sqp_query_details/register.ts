import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { neonPanelRequest } from '../../../../../clients/neonpanel-api';
import type { ToolExecutionContext, ToolRegistry, ToolSpecJson } from '../../../../types';
import { insertBrandAnalyticsState, nowVersion, resolveMarketplaceIds } from '../_clickhouse';

type CompaniesWithPermissionResponse = {
  companies?: Array<{ company_id?: number; companyId?: number; id?: number }>;
};

const STATE_TABLE = 'analytics.ba_sqp_query_details_uploads';
const STATE_COLUMNS = [
  'company_id',
  'marketplace_id',
  'keyword',
  'period_start',
  'period_end',
  'total_impressions',
  'total_clicks',
  'total_click_rate',
  'competitors_json',
  'uploaded_by',
  'uploaded_at',
  'source_screenshot_s3_uri',
  'raw_extracted_json',
  'is_active',
  'version',
];

const competitorSchema = z.object({
  asin: z.string().min(8).max(20),
  brand: z.string().max(200).nullable().optional(),
  impressions: z.number().int().min(0).nullable().optional(),
  clicks: z.number().int().min(0).nullable().optional(),
  click_rate: z.number().min(0).max(1).nullable().optional(),
  price_median: z.number().min(0).nullable().optional(),
  rank: z.number().int().min(1).max(100).nullable().optional(),
});

const extractionSchema = z.object({
  marketplace: z.string().min(1).max(10),
  keyword: z.string().min(1).max(200),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  total_impressions: z.number().int().min(0).nullable().optional(),
  total_clicks: z.number().int().min(0).nullable().optional(),
  total_click_rate: z.number().min(0).max(1).nullable().optional(),
  competitors: z.array(competitorSchema).max(10).optional(),
  source_screenshot_s3_uri: z.string().max(500).nullable().optional(),
});

const inputSchema = z
  .object({
    company_id: z.coerce.number().int().min(1),
    reason: z.string().min(5),
    dry_run: z.boolean().default(true).optional(),
    extraction: extractionSchema,
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

export function registerBrandAnalyticsUploadSqpQueryDetailsTool(registry: ToolRegistry) {
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
    name: specJson?.name ?? 'brand_analytics_upload_sqp_query_details',
    description:
      specJson?.description ??
      'Persists Search Query Details extracted from a Seller Central screenshot.',
    isConsequential: true,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? { type: 'object', additionalProperties: true },
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);
      const companyId = parsed.company_id;
      const dryRun = parsed.dry_run !== false;
      const ex = parsed.extraction;
      const userId = context.subject ?? 'unknown';

      const authorized = await isAuthorizedForCompany(companyId, context);
      if (!authorized) {
        return { dry_run: dryRun, written: 0, error: 'Not authorized for this company.' };
      }

      if (ex.period_start > ex.period_end) {
        return { dry_run: dryRun, written: 0, error: 'period_start must be <= period_end.' };
      }

      // Callers supply a country code; uploads are keyed on the canonical Amazon
      // marketplace id so they stay joinable to the SQP contract.
      const marketplaceIds = await resolveMarketplaceIds([ex.marketplace]);
      const marketplaceId = marketplaceIds.get(ex.marketplace.trim().toLowerCase());
      if (!marketplaceId) {
        return { dry_run: dryRun, written: 0, error: `Unknown marketplace: ${ex.marketplace}.` };
      }

      if (dryRun) {
        return {
          dry_run: true,
          written: 0,
          message: `Dry run: would upsert Search Query Details for company_id=${companyId}, keyword='${ex.keyword}', period ${ex.period_start}..${ex.period_end}.`,
        };
      }

      // The table is a SharedReplacingMergeTree keyed on
      // (company_id, marketplace_id, lower(keyword), period_start), so inserting
      // a newer version is the upsert - no delete step is needed.
      const version = nowVersion();
      await insertBrandAnalyticsState({
        table: STATE_TABLE,
        columns: STATE_COLUMNS,
        rows: [
          {
            company_id: companyId,
            marketplace_id: marketplaceId,
            keyword: ex.keyword,
            period_start: ex.period_start,
            period_end: ex.period_end,
            total_impressions: ex.total_impressions ?? null,
            total_clicks: ex.total_clicks ?? null,
            total_click_rate: ex.total_click_rate ?? null,
            competitors_json: JSON.stringify(ex.competitors ?? []),
            uploaded_by: userId,
            uploaded_at: version,
            source_screenshot_s3_uri: ex.source_screenshot_s3_uri ?? '',
            raw_extracted_json: JSON.stringify(ex),
            is_active: 1,
            version,
          },
        ],
      });

      return {
        dry_run: false,
        written: 1,
        message: `Search Query Details persisted for company_id=${companyId}, keyword='${ex.keyword}', period ${ex.period_start}..${ex.period_end}.`,
      };
    },
  });
}
