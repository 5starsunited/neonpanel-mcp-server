import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { startGlueJobRun } from '../../../../../clients/glue';
import { neonPanelRequest } from '../../../../../clients/neonpanel-api';
import { runAthenaQuery } from '../../../../../clients/athena';
import { config } from '../../../../../config';
import { resolveCompanyUuid } from '../../../../neonpanel-common';
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

type ForecastingSettingsResponse = {
  default_scenario_id?: number | null;
};

type ResolvedScenario = {
  uuid: string;
  name?: string;
};

// ---------------------------------------------------------------------------
// Scenario resolution (Option C: resolve scenario_uuid server-side)
// ---------------------------------------------------------------------------

/**
 * Map a numeric sales_forecast_scenario_id to its scenario_uuid(s) for a
 * company, using the inventory planning snapshot (the only source that carries
 * both the id and the uuid). A scenario_id is expected to map to exactly one
 * uuid; if more are found the caller decides how to handle it.
 */
async function resolveScenarioUuidsById(
  companyId: number,
  scenarioId: number,
): Promise<ResolvedScenario[]> {
  const catalog = config.athena.catalog;
  const database = config.athena.database;
  const table = config.athena.tables.inventoryPlanningSnapshot;

  const query = `SELECT DISTINCT
  sales_forecast_scenario_uuid AS scenario_uuid,
  sales_forecast_scenario_name AS scenario_name
FROM "${catalog}"."${database}"."${table}"
WHERE company_id = ${Math.trunc(companyId)}
  AND sales_forecast_scenario_id = ${Math.trunc(scenarioId)}
  AND sales_forecast_scenario_uuid IS NOT NULL
LIMIT 10`;

  const res = await runAthenaQuery({
    query,
    database,
    workGroup: config.athena.workgroup,
    outputLocation: config.athena.outputLocation,
    maxRows: 10,
  });

  const seen = new Set<string>();
  const resolved: ResolvedScenario[] = [];
  for (const row of res.rows ?? []) {
    const uuid = (row.scenario_uuid ?? '').trim().toLowerCase();
    if (!uuidPattern.test(uuid) || seen.has(uuid)) continue;
    seen.add(uuid);
    resolved.push({ uuid, name: row.scenario_name ?? undefined });
  }
  return resolved;
}

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
      .max(10)
      .optional(),
    scenario_id: z.coerce.number().int().min(1).optional(),
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
      'Trigger the sales-forecast Glue ETL job that re-computes forecasts and writes results to the Iceberg table. The job is idempotent (deletes then appends by calc_period + scenario_uuid + company_id).\n\nSCENARIO SELECTION (precedence): (1) scenario_uuids if provided; else (2) scenario_id, resolved to its UUID server-side; else (3) the company\'s default_scenario_id from its forecasting settings, resolved server-side. In most cases just pass company_id + calc_period and let it use the company default. Use forecasting_get_company_settings to inspect the configured default_scenario_id, or forecasting_list_sales_forecasts to see scenario UUIDs from prior runs.\n\nAfter starting the job, use forecasting_check_sales_forecast_job_status to monitor its progress. Jobs typically take 3-5 minutes to complete — do NOT check status earlier than 3 minutes after starting.',
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

      // ---- Resolve which scenario(s) to run (Option C) ----
      // Precedence: explicit scenario_uuids > explicit scenario_id > company default.
      // scenario_id -> scenario_uuid is resolved server-side so a caller can never
      // silently run the wrong scenario by guessing a UUID.
      const warnings: string[] = [];
      let scenarioUuids: string[];
      let scenarioSource: 'explicit_uuids' | 'explicit_scenario_id' | 'company_default';
      let resolvedScenarioId: number | undefined;

      if (parsed.scenario_uuids && parsed.scenario_uuids.length > 0) {
        scenarioUuids = parsed.scenario_uuids;
        scenarioSource = 'explicit_uuids';
      } else {
        resolvedScenarioId = parsed.scenario_id;
        scenarioSource = parsed.scenario_id ? 'explicit_scenario_id' : 'company_default';

        if (!resolvedScenarioId) {
          // Fall back to the company's configured default scenario.
          const companyUuid = await resolveCompanyUuid(
            { company_id: parsed.company_id },
            context.userToken,
          );
          const settings = await neonPanelRequest<ForecastingSettingsResponse>({
            token: context.userToken,
            path: `/api/v1/companies/${encodeURIComponent(companyUuid)}/settings/forecasts`,
          });
          resolvedScenarioId = settings.default_scenario_id ?? undefined;
        }

        if (!resolvedScenarioId) {
          return {
            job_run_id: '',
            job_name: GLUE_JOB_NAME,
            state: 'DENIED',
            warnings: [
              `No scenario specified and company_id ${parsed.company_id} has no default_scenario_id configured. `
                + 'Set a default via forecasting_update_company_settings, or pass scenario_id / scenario_uuids explicitly.',
            ],
          };
        }

        const resolved = await resolveScenarioUuidsById(parsed.company_id, resolvedScenarioId);
        if (resolved.length === 0) {
          return {
            job_run_id: '',
            job_name: GLUE_JOB_NAME,
            state: 'DENIED',
            warnings: [
              `Could not resolve a scenario_uuid for scenario_id ${resolvedScenarioId} (company_id ${parsed.company_id}). `
                + 'The scenario may not yet appear in the inventory planning snapshot. '
                + 'Pass scenario_uuids explicitly to override.',
            ],
          };
        }

        // A scenario_id maps to exactly one scenario. If the snapshot yields more
        // than one uuid, use the first and warn rather than silently broadening.
        scenarioUuids = [resolved[0].uuid];
        if (resolved.length > 1) {
          warnings.push(
            `scenario_id ${resolvedScenarioId} mapped to multiple scenario_uuids `
              + `(${resolved.map((r) => r.uuid).join(', ')}); using ${resolved[0].uuid}.`,
          );
        }
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
        '--SCENARIO_UUIDS': scenarioUuids.join(','),
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
        scenario_uuids: scenarioUuids,
        scenario_source: scenarioSource,
        resolved_scenario_id: resolvedScenarioId,
        arguments_sent: glueArgs,
        warnings: warnings.length > 0 ? warnings : undefined,
        next_step: 'Use forecasting_check_sales_forecast_job_status with this job_run_id to monitor progress. Wait at least 3 minutes before checking.',
      };
    },
  });
}
