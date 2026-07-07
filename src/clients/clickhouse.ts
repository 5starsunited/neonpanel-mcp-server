import { config } from '../config';
import { AppError } from '../lib/errors';
import { logger } from '../logging/logger';

export type ClickHouseQueryOptions = {
  query: string;
  timeoutMs?: number;
};

export type ClickHouseQueryResult = {
  query: string;
  columns: Array<{ name: string; type?: string }>;
  rows: Array<Record<string, unknown>>;
  stats?: {
    elapsedSec?: number;
    rowsRead?: number;
    bytesRead?: number;
  };
};

type ClickHouseJsonPayload = {
  meta?: Array<{ name: string; type?: string }>;
  data?: Array<Record<string, unknown>>;
  statistics?: { elapsed?: number; rows_read?: number; bytes_read?: number };
};

export async function runClickHouseQuery(
  options: ClickHouseQueryOptions,
): Promise<ClickHouseQueryResult> {
  const { url, user, password } = config.clickhouse;
  if (!url || !password) {
    throw new AppError('ClickHouse is not configured (CLICKHOUSE_URL / CLICKHOUSE_PASSWORD).', {
      status: 500,
      code: 'clickhouse_not_configured',
    });
  }

  const endpoint = new URL(url);
  endpoint.searchParams.set('default_format', 'JSON');
  // Emit UInt64/Int64 as JSON numbers (COUNT(*) etc); our values stay well below 2^53.
  endpoint.searchParams.set('output_format_json_quote_64bit_integers', '0');

  const t0 = Date.now();
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      body: options.query,
      headers: {
        'X-ClickHouse-User': user,
        'X-ClickHouse-Key': password,
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
    });
  } catch (error) {
    throw new AppError('ClickHouse request failed (network/timeout).', {
      status: 504,
      code: 'clickhouse_unreachable',
      details: { message: error instanceof Error ? error.message : String(error) },
    });
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new AppError(`ClickHouse query failed (HTTP ${response.status}).`, {
      status: 502,
      code: 'clickhouse_query_failed',
      details: { body: text.slice(0, 1000) },
    });
  }

  // Time-to-headers (DNS + TCP + TLS + query exec + TTFB). Compared against the
  // server-reported query time below, this isolates connection/network cost.
  const headersMs = Date.now() - t0;
  const payload = (await response.json()) as ClickHouseJsonPayload;
  const totalMs = Date.now() - t0;
  const serverElapsedSec = payload.statistics?.elapsed;

  // If headersMs >> serverElapsedSec, the time is in connection/network/event-loop
  // scheduling (e.g. DNS on a saturated libuv threadpool under concurrency), NOT the query.
  logger.info(
    {
      clickhouse: {
        headersMs,
        bodyMs: totalMs - headersMs,
        totalMs,
        serverElapsedMs: serverElapsedSec !== undefined ? Math.round(serverElapsedSec * 1000) : undefined,
        rows: payload.data?.length ?? 0,
      },
    },
    'ClickHouse query timing',
  );

  return {
    query: options.query,
    columns: (payload.meta ?? []).map((col) => ({ name: col.name, type: col.type })),
    rows: payload.data ?? [],
    stats: payload.statistics
      ? {
          elapsedSec: payload.statistics.elapsed,
          rowsRead: payload.statistics.rows_read,
          bytesRead: payload.statistics.bytes_read,
        }
      : undefined,
  };
}
