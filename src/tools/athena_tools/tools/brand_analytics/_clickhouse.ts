import { insertClickHouseJsonEachRow, runClickHouseQuery, type ClickHouseQueryResult } from '../../../../clients/clickhouse';
import { logger } from '../../../../logging/logger';
import { isValidIntentIdSlug } from './_intent_common';

export function sqlEscapeString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function sqlStringLiteral(value: string): string {
  return `'${sqlEscapeString(value)}'`;
}

export function sqlStringArrayExpr(values: string[]): string {
  return `CAST([${values.map(sqlStringLiteral).join(',')}], 'Array(String)')`;
}

export function sqlUInt64ArrayExpr(values: number[]): string {
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error('ClickHouse UInt64 arrays require non-negative safe integers.');
  }
  return `CAST([${values.map(String).join(',')}], 'Array(UInt64)')`;
}

export function sqlNullableStringExpr(value?: string | null): string {
  return value == null || value.trim().length === 0
    ? 'CAST(NULL AS Nullable(String))'
    : sqlStringLiteral(value);
}

export function sqlNullableDateExpr(value?: string | null): string {
  if (value == null || value.trim().length === 0) {
    return 'CAST(NULL AS Nullable(Date))';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('ClickHouse dates must use YYYY-MM-DD.');
  }
  return `toDate(${sqlStringLiteral(value)})`;
}

export function allowListedSql<T extends string>(
  value: string | undefined,
  values: Readonly<Record<T, string>>,
  fallback: T,
): string {
  if (value && Object.prototype.hasOwnProperty.call(values, value)) {
    return values[value as T];
  }
  return values[fallback];
}

/**
 * Request-scoped version stamp for the SharedReplacingMergeTree(version) state
 * tables. Every logical upsert (write, deactivate, reset) inserts a NEW row
 * carrying a newer version; FINAL then collapses the ORDER BY key to it. There
 * are no DELETE statements in the BA write path.
 */
export function nowVersion(): string {
  return new Date().toISOString();
}

/**
 * BA state tables key marketplace scope on the canonical Amazon `marketplace_id`
 * (the same key the SQP/SCP report contracts use), while the MCP tool inputs
 * speak country codes ('US', 'UK'). Resolve one to the other so written state
 * stays joinable to the analytical sources.
 *
 * Returns a lowercase-token -> marketplace_id map. Tokens that match neither a
 * country code nor a marketplace id are absent; callers decide the fallback.
 */
export async function resolveMarketplaceIds(
  tokens: readonly string[],
): Promise<Map<string, string>> {
  const wanted = Array.from(
    new Set(tokens.map((token) => token.trim().toLowerCase()).filter((token) => token.length > 0)),
  );
  const resolved = new Map<string, string>();
  if (wanted.length === 0) return resolved;

  const tokenArray = sqlStringArrayExpr(wanted);
  const result = await runClickHouseQuery({
    query:
      `SELECT marketplace_id, lower(country_code) AS country_code_lc, lower(marketplace_id) AS marketplace_id_lc\n` +
      `FROM etl.ba_marketplaces\n` +
      `WHERE has(${tokenArray}, lower(country_code)) OR has(${tokenArray}, lower(marketplace_id))`,
  });

  for (const row of result.rows) {
    const marketplaceId = String(row.marketplace_id ?? '');
    if (!marketplaceId) continue;
    const countryCodeLc = String(row.country_code_lc ?? '');
    const marketplaceIdLc = String(row.marketplace_id_lc ?? '');
    if (countryCodeLc) resolved.set(countryCodeLc, marketplaceId);
    if (marketplaceIdLc) resolved.set(marketplaceIdLc, marketplaceId);
  }
  return resolved;
}

export async function executeBrandAnalyticsQuery(query: string): Promise<ClickHouseQueryResult> {
  const result = await runClickHouseQuery({ query });
  logger.info(
    {
      brandAnalytics: {
        rows: result.rows.length,
        elapsedMs: result.stats?.elapsedSec === undefined ? undefined : Math.round(result.stats.elapsedSec * 1000),
        rowsRead: result.stats?.rowsRead,
        bytesRead: result.stats?.bytesRead,
      },
    },
    'Brand Analytics ClickHouse query completed',
  );
  return result;
}

/**
 * Append versioned rows to a BA state table. Thin wrapper over the JSONEachRow
 * client that exists so every write handler logs the same way.
 */
export async function insertBrandAnalyticsState(options: {
  table: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
}): Promise<void> {
  if (options.rows.length === 0) return;
  await insertClickHouseJsonEachRow(options);
  logger.info(
    { brandAnalytics: { table: options.table, insertedRows: options.rows.length } },
    'Brand Analytics ClickHouse state insert completed',
  );
}

/**
 * Deactivate every currently-active row of a company in a BA state table by
 * re-inserting each one with is_active = 0 and a newer version. The state
 * tables are SharedReplacingMergeTree(version), so this collapses to a
 * deactivated row per ORDER BY key without issuing a DELETE.
 *
 * Returns the number of rows actually deactivated, read from ClickHouse rather
 * than assumed, so callers can report an exact count.
 */
export async function deactivateCompanyState(options: {
  table: string;
  columns: string[];
  companyId: number;
  version: string;
  /** Extra equality predicates, already rendered as safe SQL. */
  extraWhereSql?: string;
}): Promise<number> {
  const { table, columns, companyId, version } = options;
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    throw new Error('deactivateCompanyState requires a positive company_id.');
  }
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(table)) {
    throw new Error('deactivateCompanyState requires a plain ClickHouse table name.');
  }
  const projection = columns
    .map((column) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(column)) {
        throw new Error(`Invalid ClickHouse column name: ${column}`);
      }
      return column;
    })
    .join(', ');

  const extra = options.extraWhereSql ? ` AND (${options.extraWhereSql})` : '';
  const current = await runClickHouseQuery({
    query:
      `SELECT ${projection}\n` +
      `FROM ${table} FINAL\n` +
      `WHERE company_id = ${companyId} AND is_active = 1${extra}`,
  });

  const tombstones = current.rows.map((row) => ({ ...row, is_active: 0, version }));
  await insertBrandAnalyticsState({ table, columns, rows: tombstones });
  return tombstones.length;
}

function companyIdListClause(companyIds: number | readonly number[]): string | null {
  const ids = Array.isArray(companyIds) ? companyIds : [companyIds as number];
  const safe = (ids as number[])
    .filter((n) => Number.isSafeInteger(n) && n > 0)
    .map((n) => String(n));
  if (safe.length === 0) return null;
  return safe.length === 1 ? `company_id = ${safe[0]}` : `company_id IN (${safe.join(', ')})`;
}

/**
 * ClickHouse subquery returning the lowercased search terms mapped to any of the
 * given intent_ids. Returns null when there is nothing to filter on, so callers
 * can render the clause as a no-op.
 */
export function intentTermsSubquerySql(
  companyIds: number | readonly number[],
  intentIds: readonly string[] | null | undefined,
): string | null {
  if (!intentIds || intentIds.length === 0) return null;
  const safeIds = intentIds.filter((s) => isValidIntentIdSlug(s));
  if (safeIds.length === 0) return null;
  const companyClause = companyIdListClause(companyIds);
  if (!companyClause) return null;
  const intentInList = safeIds.map(sqlStringLiteral).join(', ');
  return (
    `(SELECT DISTINCT lower(search_term) AS t ` +
    `FROM etl.ba_search_term_to_intent_current ` +
    `WHERE ${companyClause} AND intent_id IN (${intentInList}))`
  );
}

/** WHERE-clause fragment restricting a search-term column to the given intents. */
export function intentTermsFilterClauseSql(
  companyIds: number | readonly number[],
  intentIds: readonly string[] | null | undefined,
  searchTermColumnSql: string,
): string {
  const sub = intentTermsSubquerySql(companyIds, intentIds);
  if (!sub) return '1';
  return `lower(${searchTermColumnSql}) IN (SELECT t FROM ${sub} AS x)`;
}

/**
 * Body of a `term_intents` CTE mapping (company_id, lower(search_term)) to its
 * intent ids plus the highest-confidence one. Paste into a WITH clause.
 *
 * Every projected column is explicitly aliased: `ui` and `sti` both expose
 * company_id/intent_id, and an unaliased reference would be emitted as a
 * qualified column NAME (e.g. `sti.company_id`), breaking downstream joins.
 */
export function termIntentsCteSql(companyIds: number | readonly number[]): string {
  // With no companies we still emit a parseable, empty CTE. The caller's
  // permission check should already have short-circuited before this point.
  const companyClause = companyIdListClause(companyIds) ?? '1 = 0';
  return (
    `term_intents AS (\n` +
    `  SELECT\n` +
    `    sti.company_id AS company_id,\n` +
    `    sti.term_norm AS term_norm,\n` +
    `    groupUniqArray(sti.intent_id) AS intent_ids,\n` +
    `    anyIf(sti.intent_id, sti.rn_primary = 1) AS primary_intent_id,\n` +
    `    anyIf(ui.intent_name, sti.rn_primary = 1) AS primary_intent_label\n` +
    `  FROM (\n` +
    `    SELECT\n` +
    `      company_id,\n` +
    `      lower(search_term) AS term_norm,\n` +
    `      intent_id,\n` +
    `      confidence,\n` +
    `      row_number() OVER (\n` +
    `        PARTITION BY company_id, lower(search_term)\n` +
    `        ORDER BY confidence DESC, intent_id ASC\n` +
    `      ) AS rn_primary\n` +
    `    FROM etl.ba_search_term_to_intent_current\n` +
    `    WHERE ${companyClause}\n` +
    `  ) AS sti\n` +
    `  LEFT JOIN etl.ba_user_intents_current AS ui\n` +
    `    ON ui.intent_id = sti.intent_id\n` +
    `   AND ui.company_id = sti.company_id\n` +
    `  GROUP BY sti.company_id, sti.term_norm\n` +
    `)`
  );
}