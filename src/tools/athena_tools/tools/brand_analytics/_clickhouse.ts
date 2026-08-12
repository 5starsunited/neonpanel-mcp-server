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
 * Body of an `asin_revenue_class` CTE exposing the ABCD / Pareto revenue
 * classification for one (company_id, marketplace_id, asin). Paste into a WITH
 * clause and join with asinClassJoinSql().
 *
 * Named `asin_revenue_class`, not `asin_class`: the latter was a legacy
 * snapshot-ETL column over a pareto percentile that no longer exists, and
 * several queries carry comments explaining why it was dropped.
 *
 * SOURCE OF TRUTH: etl.inventory_planning_snapshot. The alternative — the
 * classification denormalised onto etl.ba_search_query_performance, which
 * resolves through the etl.sku_classification_last30_by_marketplace VIEW — is
 * recomputed on every single query from a rolling 30-day sales window. That
 * makes it both non-reproducible (the same historical week returns a different
 * class minutes later) and far less complete (it classified 20-70% of SQP rows
 * against this snapshot's 75-100%).
 *
 * KNOWN LIMITATION: the snapshot is not refreshed daily. Only two loads exist
 * and the useful one is 2026-07-18, so ASINs that started selling after that
 * date carry no class. Queries expose the load date as `classification_as_of`
 * so a caller can tell a stale class from a missing one.
 *
 * Three impedance mismatches with the etl.ba_* views are handled here:
 *  - company_id is Int64 in the snapshot and UInt64 in the views. An uncast
 *    join fails outright with "Code: 386 ... no supertype for types Int64,
 *    UInt64", so it is narrowed to UInt64 on this side.
 *  - marketplace_id is an internal Int64 id in the snapshot, not the Amazon
 *    marketplace string the views key on. etl.ba_marketplaces is a clean 1:1
 *    map (27 rows, 27 distinct country codes, 27 distinct marketplace ids), so
 *    country_code bridges the two. The join is INNER: a country that does not
 *    resolve must drop out rather than collapse onto an empty marketplace_id
 *    and cross-join every marketplace.
 *  - the snapshot is per SKU, so an ASIN sold under several SKUs appears more
 *    than once and 146 such keys disagree about the class. argMax over
 *    (revenue_30d, inventory_id) picks the dominant SKU deterministically;
 *    without the inventory_id tiebreaker equal-revenue SKUs would alternate
 *    between runs.
 */
export function asinClassCteSql(companyIds: number | readonly number[]): string {
  const companyClause = companyIdListClause(companyIds) ?? '1 = 0';
  // Zero-padded strings, so lexicographic MAX is chronological. Scoped per
  // company because a partial load did land once (2026-06-03 wrote 21 rows for
  // a single company); a global MAX would let a repeat of that wipe out the
  // classification for every other company.
  return (
    `asin_revenue_class AS (\n` +
    `  SELECT\n` +
    `    toUInt64(snap.company_id) AS company_id,\n` +
    `    mk.marketplace_id AS marketplace_id,\n` +
    `    snap.asin AS asin,\n` +
    `    argMax(nullIf(ifNull(snap.revenue_abcd_class, ''), ''), snap.pick_order) AS revenue_abcd_class,\n` +
    `    argMax(nullIf(ifNull(snap.pareto_abc_class, ''), ''), snap.pick_order) AS pareto_abc_class,\n` +
    `    argMax(CAST(snap.revenue_share AS Nullable(Float64)), snap.pick_order) AS revenue_share,\n` +
    `    argMax(CAST(snap.cumulative_revenue_share AS Nullable(Float64)), snap.pick_order) AS cumulative_revenue_share,\n` +
    `    max(snap.day_key) AS classification_as_of\n` +
    `  FROM (\n` +
    `    SELECT\n` +
    `      company_id,\n` +
    `      country_code,\n` +
    `      asin,\n` +
    `      revenue_abcd_class,\n` +
    `      pareto_abc_class,\n` +
    `      revenue_share,\n` +
    `      cumulative_revenue_share,\n` +
    `      concat(ifNull(year, ''), '-', ifNull(month, ''), '-', ifNull(day, '')) AS day_key,\n` +
    `      (ifNull(revenue_30d, 0), ifNull(inventory_id, 0)) AS pick_order\n` +
    `    FROM etl.inventory_planning_snapshot\n` +
    `    WHERE ${companyClause}\n` +
    `      AND ifNull(asin, '') != ''\n` +
    `  ) AS snap\n` +
    `  INNER JOIN (\n` +
    `    SELECT company_id AS latest_company_id, max(day_key) AS latest_day_key\n` +
    `    FROM (\n` +
    `      SELECT\n` +
    `        company_id,\n` +
    `        concat(ifNull(year, ''), '-', ifNull(month, ''), '-', ifNull(day, '')) AS day_key,\n` +
    `        revenue_abcd_class\n` +
    `      FROM etl.inventory_planning_snapshot\n` +
    `      WHERE ${companyClause}\n` +
    `    )\n` +
    `    WHERE ifNull(revenue_abcd_class, '') != ''\n` +
    `    GROUP BY company_id\n` +
    `  ) AS latest\n` +
    `    ON latest.latest_company_id = snap.company_id\n` +
    `   AND latest.latest_day_key = snap.day_key\n` +
    `  INNER JOIN etl.ba_marketplaces AS mk\n` +
    `    ON upper(ifNull(mk.country_code, '')) = upper(ifNull(snap.country_code, ''))\n` +
    `  GROUP BY company_id, marketplace_id, asin\n` +
    `)`
  );
}

/**
 * LEFT JOIN binding `asin_revenue_class` to a fact alias. LEFT, not INNER: an
 * unclassified ASIN must still return its report rows with a NULL class,
 * otherwise the snapshot's coverage gaps would silently delete traffic from
 * every report.
 */
export function asinClassJoinSql(factAlias: string, asinColumnSql?: string): string {
  const asinSql = asinColumnSql ?? `${factAlias}.asin`;
  return (
    `LEFT JOIN asin_revenue_class AS cls\n` +
    `    ON cls.company_id = ${factAlias}.company_id\n` +
    `   AND cls.marketplace_id = ${factAlias}.marketplace_id\n` +
    `   AND cls.asin = ${asinSql}`
  );
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