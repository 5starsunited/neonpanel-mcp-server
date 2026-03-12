import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { getGlueJobRunStatus } from '../../../../../clients/glue';
import type { ToolRegistry, ToolSpecJson } from '../../../../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GLUE_JOB_NAME = 'fc-prod-sales_forecast-job';

// ---------------------------------------------------------------------------
// Zod
// ---------------------------------------------------------------------------

const inputSchema = z
  .object({
    job_run_id: z.string().min(1, 'job_run_id is required'),
  })
  .strict();

const fallbackOutputSchema = { type: 'object', additionalProperties: true } as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TERMINAL_STATES = new Set(['SUCCEEDED', 'FAILED', 'STOPPED', 'ERROR', 'TIMEOUT']);
const IN_PROGRESS_STATES = new Set(['STARTING', 'RUNNING', 'STOPPING', 'WAITING']);

function adviceForState(state: string): string {
  if (state === 'SUCCEEDED') {
    return 'Job completed successfully. Forecast data is now available — use forecasting_list_sales_forecasts or forecasting_get_sales_forecast_details to review the results.';
  }
  if (state === 'FAILED' || state === 'ERROR') {
    return 'Job failed. Check the error_message for details. You may retry with forecasting_run_sales_forecast_job.';
  }
  if (state === 'TIMEOUT') {
    return 'Job timed out. This may indicate an unusually large dataset. Consider running with a specific inventory_id or contact engineering.';
  }
  if (state === 'STOPPED') {
    return 'Job was manually stopped. You can restart it with forecasting_run_sales_forecast_job.';
  }
  if (IN_PROGRESS_STATES.has(state)) {
    return 'Job is still running. Check again in 1-2 minutes.';
  }
  return `Unknown state "${state}". Check again in 1-2 minutes or contact engineering.`;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerForecastingCheckSalesForecastJobStatusTool(registry: ToolRegistry) {
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
    name: 'forecasting_check_sales_forecast_job_status',
    description:
      'Check the status of a previously started sales-forecast Glue job run. Jobs typically take 3-5 minutes — do NOT check earlier than 3 minutes after starting. Use forecasting_list_sales_forecasts or forecasting_get_sales_forecast_details to review results after completion.',
    isConsequential: false,
    inputSchema,
    outputSchema: specJson?.outputSchema ?? fallbackOutputSchema,
    specJson,
    execute: async (args) => {
      const parsed = inputSchema.parse(args);

      const result = await getGlueJobRunStatus(GLUE_JOB_NAME, parsed.job_run_id);

      return {
        job_run_id: result.jobRunId,
        job_name: result.jobName,
        state: result.state,
        started_on: result.startedOn,
        completed_on: result.completedOn,
        execution_time_seconds: result.executionTimeSeconds,
        error_message: result.errorMessage,
        advice: adviceForState(result.state),
      };
    },
  });
}
