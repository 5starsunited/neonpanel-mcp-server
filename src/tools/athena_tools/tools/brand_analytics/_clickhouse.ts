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
 * SOURCE OF TRUTH: etl.asin_revenue_class_daily (clickhouse_etl migration
 * 0054). A refreshable materialised view rebuilds it at 07:00 UTC every day and
 * APPENDs the result under a `classification_date`, so a class is reproducible:
 * the same query re-run an hour later returns the same answer.
 *
 * The rejected alternatives, both of which were in use before:
 *  - etl.ba_asin_attributes / the classification denormalised onto
 *    etl.ba_search_query_performance. Both resolve through the
 *    etl.sku_classification_last30_by_marketplace VIEW, which is recomputed on
 *    every single query from a rolling 30-day sales window. A historical week
 *    came back stamped with today's class, and re-running minutes later gave a
 *    different one. Since A+B is the default class filter, that changed which
 *    rows a caller saw between two identical calls.
 *  - etl.inventory_planning_snapshot. Materialised, so reproducible, but it has
 *    no producer: two loads exist ever and the useful one is 2026-07-18. It
 *    could only get staler.
 *
 * KNOWN LIMITATION: coverage, not freshness. The upstream classification only
 * covers SKUs with `available > 0` in app.amazon_restock_inventory_recommendations,
 * which for company 106 leaves 65 of 139 (marketplace, asin) pairs seen in SQP
 * unclassified. That filter belongs to inventory planning, not to revenue
 * classification, but relaxing it would move every ASIN's revenue_share (the
 * shares are windowed over the classified population) and would change
 * etl.ba_asin_attributes for its other consumers, so it needs a deliberate
 * decision rather than a quiet widening here.
 *
 * Queries expose `classification_as_of` so a caller can tell a stale class from
 * a missing one.
 *
 * Two things the daily table makes unnecessary, both of which the snapshot
 * needed:
 *  - No marketplace bridging. marketplace_id here is already the Amazon
 *    marketplace id the etl.ba_* views key on. The snapshot carried an internal
 *    numeric id plus a country_code and had to be joined through
 *    etl.ba_marketplaces, which dropped marketplaces on the way.
 *  - No per-SKU de-duplication. The daily table is already one row per
 *    (company, marketplace, asin, date); the SKU-to-ASIN collapse happens
 *    upstream, using the same rule as etl.ba_asin_attributes.
 */
export function asinClassCteSql(companyIds: number | readonly number[]): string {
  const companyClause = companyIdListClause(companyIds) ?? '1 = 0';
  // FINAL because the table is a ReplacingMergeTree: a same-day re-refresh
  // writes a second row per key that only collapses on merge. Without FINAL an
  // unmerged duplicate would multiply rows through the LEFT JOIN below.
  //
  // The latest date is resolved PER COMPANY. A global max() would blank out
  // every other company on any day a refresh only partially lands.
  return (
    `asin_revenue_class AS (\n` +
    `  SELECT\n` +
    `    daily.company_id AS company_id,\n` +
    `    daily.marketplace_id AS marketplace_id,\n` +
    `    daily.asin AS asin,\n` +
    `    nullIf(daily.revenue_abcd_class, '') AS revenue_abcd_class,\n` +
    `    nullIf(daily.pareto_abc_class, '') AS pareto_abc_class,\n` +
    `    CAST(daily.revenue_share AS Nullable(Float64)) AS revenue_share,\n` +
    `    CAST(daily.cumulative_revenue_share AS Nullable(Float64)) AS cumulative_revenue_share,\n` +
    `    daily.classification_date AS classification_as_of\n` +
    `  FROM etl.asin_revenue_class_daily AS daily FINAL\n` +
    `  INNER JOIN (\n` +
    `    SELECT\n` +
    `      company_id AS latest_company_id,\n` +
    `      max(classification_date) AS latest_classification_date\n` +
    `    FROM etl.asin_revenue_class_daily\n` +
    `    WHERE ${companyClause}\n` +
    `    GROUP BY company_id\n` +
    `  ) AS latest\n` +
    `    ON latest.latest_company_id = daily.company_id\n` +
    `   AND latest.latest_classification_date = daily.classification_date\n` +
    `  WHERE ${companyClause}\n` +
    `    AND daily.asin != ''\n` +
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