import {
  AthenaClient,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  StartQueryExecutionCommand,
  type ColumnInfo,
  type GetQueryExecutionCommandOutput,
  type Row,
} from '@aws-sdk/client-athena';
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import type { AwsCredentialIdentity, AwsCredentialIdentityProvider } from '@aws-sdk/types';
import { config } from '../config';
import { AppError } from '../lib/errors';

export type AthenaQueryOptions = {
  query: string;
  workGroup?: string;
  database?: string;
  outputLocation?: string;
  maxWaitMs?: number;
  pollIntervalMs?: number;
  maxRows?: number;
};

export type AthenaQueryResult = {
  queryExecutionId: string;
  query: string;
  columns: Array<{ name: string; type?: string }>; // Athena type strings can vary
  rows: Array<Record<string, string | null>>;
  stats?: {
    dataScannedInBytes?: number;
    engineExecutionTimeInMillis?: number;
    totalExecutionTimeInMillis?: number;
    queryPlanningTimeInMillis?: number;
    serviceProcessingTimeInMillis?: number;
    queryQueueTimeInMillis?: number;
  };
};

export async function runAthenaQuery(options: AthenaQueryOptions): Promise<AthenaQueryResult> {
  const region = config.athena.region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
  if (!region) {
    throw new AppError('AWS region is not configured (AWS_REGION).', {
      status: 500,
      code: 'aws_region_missing',
    });
  }

  const credentials = buildCredentialsProvider(region);
  const client = new AthenaClient({ region, credentials });

  const start = await client.send(
    new StartQueryExecutionCommand({
      QueryString: options.query,
      WorkGroup: options.workGroup ?? config.athena.workgroup,
      QueryExecutionContext: options.database
        ? {
            Database: options.database,
          }
        : undefined,
      ResultConfiguration: options.outputLocation
        ? {
            OutputLocation: options.outputLocation,
          }
        : config.athena.outputLocation
          ? { OutputLocation: config.athena.outputLocation }
          : undefined,
    }),
  );

  const queryExecutionId = start.QueryExecutionId;
  if (!queryExecutionId) {
    throw new AppError('Athena did not return a QueryExecutionId.', {
      status: 502,
      code: 'athena_missing_execution_id',
    });
  }

  const maxWaitMs = options.maxWaitMs ?? 60_000;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const deadline = Date.now() + maxWaitMs;

  let lastExecution: GetQueryExecutionCommandOutput | undefined;

  while (true) {
    const execution = await client.send(
      new GetQueryExecutionCommand({
        QueryExecutionId: queryExecutionId,
      }),
    );

    lastExecution = execution;

    const state = execution.QueryExecution?.Status?.State;

    if (state === 'SUCCEEDED') {
      break;
    }

    if (state === 'FAILED' || state === 'CANCELLED') {
      const reason = execution.QueryExecution?.Status?.StateChangeReason;
      const reasonText = reason ? ` Reason: ${reason}` : '';
      throw new AppError(`Athena query ${state.toLowerCase()} (QueryExecutionId: ${queryExecutionId}).${reasonText}`, {
        status: 502,
        code: 'athena_query_failed',
        details: {
          queryExecutionId,
          state,
          reason,
        },
      });
    }

    if (Date.now() > deadline) {
      throw new AppError('Athena query timed out waiting for completion.', {
        status: 504,
        code: 'athena_query_timeout',
        details: {
          queryExecutionId,
          waitedMs: maxWaitMs,
        },
      });
    }

    await sleep(pollIntervalMs);
  }

  const maxRows = Math.max(1, Math.min(1000, options.maxRows ?? 200));

  const executionStats = lastExecution?.QueryExecution?.Statistics;

  const results = await client.send(
    new GetQueryResultsCommand({
      QueryExecutionId: queryExecutionId,
      MaxResults: maxRows,
    }),
  );

  const columnInfo = results.ResultSet?.ResultSetMetadata?.ColumnInfo ?? [];
  const rows = results.ResultSet?.Rows ?? [];

  const columns = columnInfo
    .map((col) => ({
      name: col.Name ?? '',
      type: col.Type,
    }))
    .filter((col) => col.name.trim().length > 0);

  const dataRows = stripHeaderRow(rows, columns);

  return {
    queryExecutionId,
    query: options.query,
    columns,
    rows: dataRows.map((row) => rowToObject(row, columnInfo)),
    stats: executionStats
      ? {
          dataScannedInBytes: executionStats.DataScannedInBytes,
          engineExecutionTimeInMillis: executionStats.EngineExecutionTimeInMillis,
          totalExecutionTimeInMillis: executionStats.TotalExecutionTimeInMillis,
          queryPlanningTimeInMillis: executionStats.QueryPlanningTimeInMillis,
          serviceProcessingTimeInMillis: executionStats.ServiceProcessingTimeInMillis,
          queryQueueTimeInMillis: executionStats.QueryQueueTimeInMillis,
        }
      : undefined,
  };
}

function buildCredentialsProvider(region: string): AwsCredentialIdentityProvider | undefined {
  const roleArn = config.athena.assumeRoleArn;
  if (!roleArn || roleArn.trim().length === 0) {
    // Default AWS SDK provider chain (task role, env vars, ~/.aws for local with AWS_PROFILE, etc)
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
        RoleSessionName: config.athena.assumeRoleSessionName,
      }),
    );

    const c = assumed.Credentials;
    if (!c?.AccessKeyId || !c?.SecretAccessKey) {
      throw new AppError('Failed to assume Athena role (missing credentials).', {
        status: 502,
        code: 'athena_assume_role_failed',
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

function stripHeaderRow(rows: Row[], columns: Array<{ name: string }>): Row[] {
  if (rows.length === 0 || columns.length === 0) return rows;

  const first = rows[0];
  const firstValues = (first.Data ?? []).map((cell) => (cell.VarCharValue ?? '').trim());
  const colNames = columns.map((col) => col.name.trim());

  const isHeader =
    firstValues.length >= colNames.length && colNames.every((name, i) => firstValues[i] === name);

  return isHeader ? rows.slice(1) : rows;
}

function rowToObject(row: Row, columnInfo: ColumnInfo[]): Record<string, string | null> {
  const cells = row.Data ?? [];
  const out: Record<string, string | null> = {};

  for (let i = 0; i < columnInfo.length; i += 1) {
    const name = columnInfo[i]?.Name;
    if (!name || name.trim().length === 0) continue;
    const value = cells[i]?.VarCharValue;
    out[name] = value === undefined ? null : value;
  }

  return out;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
