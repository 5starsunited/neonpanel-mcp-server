import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { startGlueJobRun } from '../../../../../clients/glue';
import { neonPanelRequest } from '../../../../../clients/neonpanel-api';
import type { ToolExecutionContext, ToolRegistry, ToolSpecJson } from '../../../../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GLUE_JOB_NAME = 'fc-prod-sales_forecast-job';

const HARDCODED_ARGS: Record<string, string> = {
  '--OUTPUT_DATASET_NAME': 'sales_forecast',
  '--ATHENA_DATABASE': 'fc_forecasting_prod',
  '--ATHENA_WORKGROUP': 'neonpanel-prod',
  '--ATHENA_OUTPUT': 's3://neonpanel-forecasting-data-22dg4jfuu5nf/forecasting/athena-results/',
  '--ICEBERG_CATALOG': 'glue_catalog',
  '--ICEBERG_BUCKET_COUNT': '64',
  '--ICEBERG_TARGET_FILE_SIZE_MB': '256',
  '--ICEBERG_SORT_GLOBAL': 'true',
  '--datalake-formats': 'iceberg',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CompaniesWithPermissionResponse = {
  companies?: Array<{
    company_id?: number;
    companyId?: number;
    id?: number;
  }>;
};

// ---------------------------------------------------------------------------
// Zod
// ---------------------------------------------------------------------------

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const inputSchema = z
  .object({
    company_id: z.coerce.number().int().min(1),
    calc_period: z
      .string()
      .regex(/^\d{4}-\d{2}$/, 'calc_period must be YYYY-MM'),
    scenario_uuids: z
      .array(z.string().regex(uuidPattern, 'Each scenario_uuid must be a valid UUID'))
      .min(1)
      .max(10),
    inventory_id: z.coerce.number().int().min(1).optional(),
    horizon: z.coerce.number().int().min(1).max(48).default(24).optional(),
  })
  .strict();

const fallbackOutputSchema = { type: 'object', additionalProperties: true } as const;

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerForecastingRunSalesForecastJobTool(registry: ToolRegistry) {
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
    name: 'forecasting_run_sales_forecast_job',
    description:
      'Trigger the sales-forecast Glue ETL job that re-computes forecasts and writes results to the Iceberg table. The job is idempotent (deletes then appends by calc_period + scenario_uuid + company_id).\n\nIMPORTANT: Before calling this tool, use get_forecasting_settings for the company to obtain the correct scenario_uuid(s).\n\nAfter starting the job, use forecasting_check_sales_forecast_job_status to monitor its progress. Jobs typically take 3-5 minutes to complete — do NOT check status earlier than 3 minutes after starting.',
    isConsequential: true,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? fallbackOutputSchema,
    specJson,
    execute: async (args, context) => {
      const parsed = inputSchema.parse(args);

      // ---- Authorization: require the forecasting permission ----
      const permission = 'view:quicksight_group.sales_and_marketing_new';
      const permissionResponse = await neonPanelRequest<CompaniesWithPermissionResponse>({
        token: context.userToken,
        path: `/api/v1/permissions/${encodeURIComponent(permission)}/companies`,
      });

      const permittedCompanyIds = (permissionResponse.companies ?? [])
        .map((c) => c.company_id ?? c.companyId ?? c.id)
        .filter((id): id is number => typeof id === 'number' && Number.isFinite(id) && id > 0);

      if (permittedCompanyIds.length === 0) {
        return {
          job_run_id: '',
          job_name: GLUE_JOB_NAME,
          state: 'DENIED',
          warnings: ['No permitted companies for this token. Cannot start forecast job.'],
        };
      }

      if (!permittedCompanyIds.includes(parsed.company_id)) {
        return {
          job_run_id: '',
          job_name: GLUE_JOB_NAME,
          state: 'DENIED',
          warnings: [`company_id ${parsed.company_id} is not permitted for this token.`],
        };
      }

      // ---- Build Glue job arguments ----
      const horizon = parsed.horizon ?? 24;
      const inventoryIdArg = parsed.inventory_id ? String(parsed.inventory_id) : 'ALL';

      const glueArgs: Record<string, string> = {
        ...HARDCODED_ARGS,
        '--COMPANY_ID': String(parsed.company_id),
        '--INVENTORY_ID': inventoryIdArg,
        '--CALC_PERIOD': parsed.calc_period,
        '--HORIZON': String(horizon),
        '--SCENARIO_UUIDS': parsed.scenario_uuids.join(','),
      };

      // ---- Start job ----
      const result = await startGlueJobRun({
        jobName: GLUE_JOB_NAME,
        arguments: glueArgs,
      });

      return {
        job_run_id: result.jobRunId,
        job_name: result.jobName,
        state: result.state,
        arguments_sent: glueArgs,
        next_step: 'Use forecasting_check_sales_forecast_job_status with this job_run_id to monitor progress. Wait at least 3 minutes before checking.',
      };
    },
  });
}
