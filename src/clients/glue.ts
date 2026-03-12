import {
  GlueClient,
  StartJobRunCommand,
  GetJobRunCommand,
  type JobRun,
} from '@aws-sdk/client-glue';
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import type { AwsCredentialIdentity, AwsCredentialIdentityProvider } from '@aws-sdk/types';
import { config } from '../config';
import { AppError } from '../lib/errors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StartGlueJobOptions = {
  jobName: string;
  arguments: Record<string, string>;
};

export type GlueJobRunResult = {
  jobRunId: string;
  jobName: string;
  state: string;
  startedOn?: string;
  completedOn?: string;
  executionTimeSeconds?: number;
  errorMessage?: string;
};

// ---------------------------------------------------------------------------
// Credentials (reuses the same assume-role pattern as athena.ts)
// ---------------------------------------------------------------------------

function buildCredentialsProvider(region: string): AwsCredentialIdentityProvider | undefined {
  const roleArn = config.athena.assumeRoleArn;
  if (!roleArn || roleArn.trim().length === 0) {
    return undefined;
  }

  const sts = new STSClient({ region });
  let cached: { creds: AwsCredentialIdentity; expiresAt: number } | undefined;

  return async (): Promise<AwsCredentialIdentity> => {
    const now = Date.now();
    if (cached && now < cached.expiresAt - 5 * 60_000) {
      return cached.creds;
    }

    const assumed = await sts.send(
      new AssumeRoleCommand({
        RoleArn: roleArn,
        RoleSessionName: 'neonpanel-mcp-glue',
      }),
    );

    const c = assumed.Credentials;
    if (!c?.AccessKeyId || !c?.SecretAccessKey) {
      throw new AppError('Failed to assume role for Glue access (missing credentials).', {
        status: 502,
        code: 'glue_assume_role_failed',
        details: { roleArn },
      });
    }

    const expiresAt = c.Expiration ? new Date(c.Expiration).getTime() : now + 60 * 60_000;
    cached = {
      creds: {
        accessKeyId: c.AccessKeyId,
        secretAccessKey: c.SecretAccessKey,
        sessionToken: c.SessionToken,
      },
      expiresAt,
    };

    return cached.creds;
  };
}

// ---------------------------------------------------------------------------
// Singleton client
// ---------------------------------------------------------------------------

function getGlueClient(): GlueClient {
  const region = config.athena.region ?? process.env.AWS_REGION ?? 'us-east-1';
  const credentials = buildCredentialsProvider(region);
  return new GlueClient({ region, credentials });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Start a Glue job run and return immediately with the JobRunId. */
export async function startGlueJobRun(options: StartGlueJobOptions): Promise<GlueJobRunResult> {
  const client = getGlueClient();

  const startResponse = await client.send(
    new StartJobRunCommand({
      JobName: options.jobName,
      Arguments: options.arguments,
    }),
  );

  const jobRunId = startResponse.JobRunId;
  if (!jobRunId) {
    throw new AppError('Glue did not return a JobRunId.', {
      status: 502,
      code: 'glue_missing_run_id',
    });
  }

  return {
    jobRunId,
    jobName: options.jobName,
    state: 'STARTED',
  };
}

/** Get the current status of a Glue job run. */
export async function getGlueJobRunStatus(jobName: string, runId: string): Promise<GlueJobRunResult> {
  const client = getGlueClient();

  const response = await client.send(
    new GetJobRunCommand({
      JobName: jobName,
      RunId: runId,
    }),
  );

  const run: JobRun | undefined = response.JobRun;
  const state = run?.JobRunState ?? 'UNKNOWN';

  return {
    jobRunId: runId,
    jobName,
    state,
    startedOn: run?.StartedOn?.toISOString(),
    completedOn: run?.CompletedOn?.toISOString(),
    executionTimeSeconds: run?.ExecutionTime,
    errorMessage: run?.ErrorMessage,
  };
}
