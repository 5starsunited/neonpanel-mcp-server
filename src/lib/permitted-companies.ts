import { createHash } from 'node:crypto';
import { neonPanelRequest } from '../clients/neonpanel-api';

/**
 * Shared company-permission resolution for data tools.
 *
 * Replaces the per-tool copy of "loop permissions -> GET /permissions/<p>/companies
 * -> union company ids". Two performance fixes over that pattern:
 *   1. The per-permission requests run in PARALLEL (the old loop awaited serially,
 *      adding ~0.5s per permission to every tool call).
 *   2. Results are cached per (user token, permission) for a short TTL, so an agent
 *      making several tool calls in one conversation pays the API round-trips once.
 *
 * Failure semantics match the old loop: a failed permission lookup contributes no
 * companies (never throws) — and failures are NOT cached, so a transient API error
 * only affects the call that saw it.
 */

const CACHE_TTL_MS = toPositiveInt(process.env.NEONPANEL_PERMISSIONS_CACHE_MS, 45_000);
const CACHE_MAX_ENTRIES = 2_000;

type CompaniesWithPermissionResponse = {
  companies?: Array<{ company_id?: number; companyId?: number; id?: number } | null>;
};

type CacheEntry = {
  expiresAt: number;
  ids: Promise<ReadonlySet<number>>;
};

const cache = new Map<string, CacheEntry>();

type PermissionFetcher = (token: string, permission: string) => Promise<ReadonlySet<number>>;
let fetcher: PermissionFetcher = fetchPermittedCompanyIds;

/** Test hook: swap the HTTP fetcher and reset the cache. Pass undefined to restore. */
export function __setPermissionFetcherForTests(override?: PermissionFetcher): void {
  fetcher = override ?? fetchPermittedCompanyIds;
  cache.clear();
}

export async function getPermittedCompanyIds(
  token: string,
  permissions: readonly string[],
): Promise<Set<number>> {
  const results = await Promise.all(permissions.map((p) => getForPermission(token, p)));
  const union = new Set<number>();
  for (const ids of results) {
    for (const id of ids) union.add(id);
  }
  return union;
}

function getForPermission(token: string, permission: string): Promise<ReadonlySet<number>> {
  const key = `${hashToken(token)}:${permission}`;
  const now = Date.now();

  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.ids;
  }

  const ids = fetcher(token, permission).catch(() => {
    // Match the old per-tool behavior: a failed lookup grants nothing. Drop the
    // cache entry so the next call retries instead of caching the failure.
    cache.delete(key);
    return new Set<number>() as ReadonlySet<number>;
  });

  cache.set(key, { expiresAt: now + CACHE_TTL_MS, ids });
  pruneCache(now);
  return ids;
}

async function fetchPermittedCompanyIds(
  token: string,
  permission: string,
): Promise<ReadonlySet<number>> {
  const response = await neonPanelRequest<CompaniesWithPermissionResponse>({
    token,
    path: `/api/v1/permissions/${encodeURIComponent(permission)}/companies`,
  });

  const ids = new Set<number>();
  for (const c of response.companies ?? []) {
    if (c === null || typeof c !== 'object') continue;
    const id = c.company_id ?? c.companyId ?? c.id;
    if (typeof id === 'number' && Number.isFinite(id) && id > 0) {
      ids.add(id);
    }
  }
  return ids;
}

// Cache keys must not retain raw bearer tokens in memory.
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 32);
}

function pruneCache(now: number): void {
  if (cache.size <= CACHE_MAX_ENTRIES) return;
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  // Still over the cap (many live entries): drop oldest-inserted first.
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function toPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}
