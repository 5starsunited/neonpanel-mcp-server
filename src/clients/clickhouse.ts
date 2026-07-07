import { Pool } from 'undici';
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

// A dedicated keep-alive connection pool for the ClickHouse origin. Reusing warm
// connections is the whole point: it skips per-call DNS + TCP + TLS, which is what
// blows up under concurrency (Node's DNS lookups share the small libuv threadpool,
// so a concurrent tool's SDK calls can starve a fresh ClickHouse connection). With
// a warm pooled connection there is no per-call lookup to queue.
let pool: Pool | undefined;
let poolOrigin: string | undefined;

function getPool(origin: string): Pool {
  if (pool && poolOrigin === origin) return pool;
  pool?.close().catch(() => {});
  pool = new Pool(origin, {
    connections: 8,
    keepAliveTimeout: 60_000, // keep idle sockets 60s so back-to-back tool calls reuse them
    keepAliveMaxTimeout: 600_000,
  });
  poolOrigin = origin;
  return pool;
}

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

  const timeoutMs = options.timeoutMs ?? 60_000;
  const t0 = Date.now();

  let statusCode: number;
  let bodyText: string;
  let headersMs = 0;
  try {
    const res = await getPool(endpoint.origin).request({
      path: `${endpoint.pathname}${endpoint.search}`,
      method: 'POST',
      headers: {
        'X-ClickHouse-User': user,
        'X-ClickHouse-Key': password,
      },
      body: options.query,
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
    });
    statusCode = res.statusCode;
    // Time-to-headers (connection reuse or DNS+TCP+TLS, + query exec + TTFB).
    headersMs = Date.now() - t0;
    bodyText = await res.body.text();
  } catch (error) {
    throw new AppError('ClickHouse request failed (network/timeout).', {
      status: 504,
      code: 'clickhouse_unreachable',
      details: { message: error instanceof Error ? error.message : String(error) },
    });
  }

  if (statusCode < 200 || statusCode >= 300) {
    throw new AppError(`ClickHouse query failed (HTTP ${statusCode}).`, {
      status: 502,
      code: 'clickhouse_query_failed',
      details: { body: bodyText.slice(0, 1000) },
    });
  }

  const payload = JSON.parse(bodyText) as ClickHouseJsonPayload;
  const totalMs = Date.now() - t0;
  const serverElapsedSec = payload.statistics?.elapsed;

  // If headersMs >> serverElapsedMs, the time is in connection/network/event-loop
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
