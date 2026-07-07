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
  companies?: Array<{ company_id?: number; companyId?: number; id?: number }>;
};

function sqlEscape(v: string): string {
  return v.replace(/'/g, "''");
}
function sqlString(v: string): string {
  return `'${sqlEscape(v)}'`;
}
function sqlNullableString(v: string | null | undefined): string {
  return v == null || v === '' ? 'NULL' : sqlString(v);
}
function sqlNullableInt(v: number | null | undefined): string {
  return v == null ? 'NULL' : `BIGINT '${Math.trunc(v)}'`;
}
function sqlNullableDouble(v: number | null | undefined): string {
  return v == null ? 'NULL' : `CAST(${v} AS DOUBLE)`;
}

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

function buildCompetitorsArraySql(competitors: Array<z.infer<typeof competitorSchema>> | undefined): string {
  if (!competitors || competitors.length === 0) {
    return 'CAST(NULL AS ARRAY<ROW(asin VARCHAR, brand VARCHAR, impressions BIGINT, clicks BIGINT, click_rate DOUBLE, price_median DOUBLE, rank INTEGER)>)';
  }
  const rows = competitors
    .map((c) => {
      return (
        `CAST(ROW(${sqlString(c.asin)}, ${sqlNullableString(c.brand ?? null)}, ` +
        `${sqlNullableInt(c.impressions ?? null)}, ${sqlNullableInt(c.clicks ?? null)}, ` +
        `${sqlNullableDouble(c.click_rate ?? null)}, ${sqlNullableDouble(c.price_median ?? null)}, ` +
        `${c.rank == null ? 'NULL' : `INTEGER '${c.rank}'`})` +
        ` AS ROW(asin VARCHAR, brand VARCHAR, impressions BIGINT, clicks BIGINT, click_rate DOUBLE, price_median DOUBLE, rank INTEGER))`
      );
    })
    .join(',\n    ');
  return `ARRAY[\n    ${rows}\n  ]`;
}

export function registerBrandAnalyticsUploadSqpQueryDetailsTool(registry: ToolRegistry) {
  const toolJsonPath = path.join(__dirname, 'tool.json');
  const insertSqlPath = path.join(__dirname, 'insert.sql');
  const deleteSlotSqlPath = path.join(__dirname, 'delete_slot.sql');

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
      const catalog = config.athena.catalog;
      const userId = context.subject ?? 'unknown';

      const authorized = await isAuthorizedForCompany(companyId, context);
      if (!authorized) {
        return { dry_run: dryRun, written: 0, error: 'Not authorized for this company.' };
      }

      if (ex.period_start > ex.period_end) {
        return { dry_run: dryRun, written: 0, error: 'period_start must be <= period_end.' };
      }

      if (dryRun) {
        return {
          dry_run: true,
          written: 0,
          message: `Dry run: would upsert Search Query Details for company_id=${companyId}, keyword='${ex.keyword}', period ${ex.period_start}..${ex.period_end}.`,
        };
      }

      // Step 1: delete existing slot for upsert.
      const deleteTemplate = await loadTextFile(deleteSlotSqlPath);
      const deleteSql = renderSqlTemplate(deleteTemplate, {
        catalog,
        company_id: companyId,
        marketplace_literal: sqlString(ex.marketplace),
        keyword_literal_lower: sqlString(ex.keyword.toLowerCase()),
        period_start_literal: sqlString(ex.period_start),
      });
      await runAthenaQuery({
        query: deleteSql,
        database: 'brand_analytics_iceberg',
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows: 0,
      });

      // Step 2: insert fresh row.
      const rawJson = JSON.stringify(ex);
      const insertTemplate = await loadTextFile(insertSqlPath);
      const insertSql = renderSqlTemplate(insertTemplate, {
        catalog,
        company_id: companyId,
        marketplace_literal: sqlString(ex.marketplace),
        keyword_literal: sqlString(ex.keyword),
        period_start_literal: sqlString(ex.period_start),
        period_end_literal: sqlString(ex.period_end),
        total_impressions_sql: sqlNullableInt(ex.total_impressions ?? null),
        total_clicks_sql: sqlNullableInt(ex.total_clicks ?? null),
        total_click_rate_sql: sqlNullableDouble(ex.total_click_rate ?? null),
        competitors_array_sql: buildCompetitorsArraySql(ex.competitors),
        uploaded_by_literal: sqlString(userId),
        source_screenshot_sql: sqlNullableString(ex.source_screenshot_s3_uri ?? null),
        raw_extracted_json_literal: sqlString(rawJson),
      });
      await runAthenaQuery({
        query: insertSql,
        database: 'brand_analytics_iceberg',
        workGroup: config.athena.workgroup,
        outputLocation: config.athena.outputLocation,
        maxRows: 0,
      });

      return {
        dry_run: false,
        written: 1,
        message: `Search Query Details persisted for company_id=${companyId}, keyword='${ex.keyword}', period ${ex.period_start}..${ex.period_end}.`,
      };
    },
  });
}
