import crypto from 'node:crypto';
import { neonPanelRequest } from '../../../../clients/neonpanel-api';
import type { ToolExecutionContext } from '../../../types';

/**
 * Shared helpers for the intent-clustering tools:
 *   - brand_analytics_cluster_search_terms
 *   - brand_analytics_create_user_intent_cluster
 *   - brand_analytics_list_user_intent_clusters
 */

type CompaniesWithPermissionResponse = {
  companies?: Array<{ company_id?: number; companyId?: number; id?: number }>;
};

/**
 * App-side surrogate BIGINT id. Monotonic-ish:
 *   id = Date.now() * 1000 + cryptoRand(0..999)
 * Fits comfortably in a signed 64-bit BIGINT (now ~1.78e15, headroom ~5e18).
 */
export function generateBigintId(): number {
  const suffix = crypto.randomInt(0, 1000);
  return Date.now() * 1000 + suffix;
}

/** intent_id slug: lowercase letters, digits, underscores. */
export function isValidIntentIdSlug(s: string): boolean {
  return /^[a-z0-9][a-z0-9_]{0,63}$/.test(s);
}

/**
 * Build a SQL subquery returning the lowercase search_terms mapped to any of
 * the given intent_ids for the given company (or companies). Returns `null`
 * when no intent_ids are supplied (caller should then render the filter as TRUE).
 *
 * Resulting fragment looks like (single company):
 *   (SELECT DISTINCT lower(search_term) AS t
 *      FROM "catalog"."brand_analytics_iceberg"."search_term_to_intent"
 *      WHERE company_id = 103 AND intent_id IN ('a','b'))
 *
 * Invalid intent_id slugs are silently dropped (defense-in-depth — input
 * schemas should already validate). If all are invalid, returns null.
 */
export function intentTermsSubquerySql(
  catalog: string,
  companyIds: number | readonly number[],
  intentIds: readonly string[] | null | undefined,
): string | null {
  if (!intentIds || intentIds.length === 0) return null;
  const safeIds = intentIds.filter((s) => isValidIntentIdSlug(s));
  if (safeIds.length === 0) return null;
  const ids = Array.isArray(companyIds) ? companyIds : [companyIds as number];
  const safeCompanyIds = (ids as number[])
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => String(Math.trunc(n)));
  if (safeCompanyIds.length === 0) return null;
  const companyClause =
    safeCompanyIds.length === 1
      ? `company_id = ${safeCompanyIds[0]}`
      : `company_id IN (${safeCompanyIds.join(', ')})`;
  const intentInList = safeIds.map((s) => sqlString(s)).join(', ');
  return (
    `(SELECT DISTINCT lower(search_term) AS t ` +
    `FROM "${catalog}"."brand_analytics_iceberg"."search_term_to_intent" ` +
    `WHERE ${companyClause} AND intent_id IN (${intentInList}))`
  );
}

/**
 * Convenience wrapper: returns a ready-to-render WHERE clause fragment for the
 * given search-term column. When `intentIds` is empty/null, returns 'TRUE' so
 * the clause is a no-op. Otherwise returns `lower(<col>) IN (SELECT t FROM <sub> AS x)`.
 */
export function intentTermsFilterClauseSql(
  catalog: string,
  companyIds: number | readonly number[],
  intentIds: readonly string[] | null | undefined,
  searchTermColumnSql: string,
): string {
  const sub = intentTermsSubquerySql(catalog, companyIds, intentIds);
  if (!sub) return 'TRUE';
  return `lower(${searchTermColumnSql}) IN (SELECT t FROM ${sub} AS x)`;
}

/**
 * Returns the body of a `term_intents` CTE (without the leading `term_intents AS`).
 * For each (company_id, lower(search_term)) maps:
 *   - intent_ids          : ARRAY<VARCHAR> of all mapped intent_ids
 *   - primary_intent_id   : highest-confidence intent_id (ties broken by intent_id ASC)
 *   - primary_intent_label: matching label from user_intents.intent_name
 *
 * Restricted to the supplied companies. Caller is responsible for joining onto
 * `(company_id, lower(<search_term_col>))` and emitting the three columns.
 *
 * Returns a full CTE definition: `term_intents AS ( ... )` — paste into a WITH clause.
 */
export function termIntentsCteSql(
  catalog: string,
  companyIds: number | readonly number[],
): string {
  const ids = Array.isArray(companyIds) ? companyIds : [companyIds as number];
  const safe = (ids as number[])
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => String(Math.trunc(n)));
  // When no company ids are supplied we still emit a valid (empty) CTE so the
  // surrounding query parses. Caller's permission check should already prevent
  // this branch from producing a real Athena run.
  const companyClause =
    safe.length === 0
      ? '1 = 0'
      : safe.length === 1
        ? `company_id = ${safe[0]}`
        : `company_id IN (${safe.join(', ')})`;
  return (
    `term_intents AS (\n` +
    `  SELECT\n` +
    `    sti.company_id,\n` +
    `    sti.term_norm,\n` +
    `    array_agg(DISTINCT sti.intent_id) AS intent_ids,\n` +
    `    arbitrary(CASE WHEN sti.rn_primary = 1 THEN sti.intent_id END) AS primary_intent_id,\n` +
    `    arbitrary(CASE WHEN sti.rn_primary = 1 THEN ui.intent_name END) AS primary_intent_label\n` +
    `  FROM (\n` +
    `    SELECT\n` +
    `      company_id,\n` +
    `      lower(search_term) AS term_norm,\n` +
    `      intent_id,\n` +
    `      confidence,\n` +
    `      ROW_NUMBER() OVER (\n` +
    `        PARTITION BY company_id, lower(search_term)\n` +
    `        ORDER BY confidence DESC NULLS LAST, intent_id ASC\n` +
    `      ) AS rn_primary\n` +
    `    FROM "${catalog}"."brand_analytics_iceberg"."search_term_to_intent"\n` +
    `    WHERE ${companyClause}\n` +
    `  ) sti\n` +
    `  LEFT JOIN "${catalog}"."brand_analytics_iceberg"."user_intents" ui\n` +
    `    ON ui.intent_id = sti.intent_id\n` +
    `   AND ui.company_id = sti.company_id\n` +
    `  GROUP BY sti.company_id, sti.term_norm\n` +
    `)`
  );
}

/** SQL string literal with single-quote escaping. */
export function sqlString(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

export function sqlNullableString(v: string | null | undefined): string {
  return v == null || v === '' ? 'NULL' : sqlString(v);
}

export function sqlNullableInt(v: number | null | undefined): string {
  return v == null ? 'NULL' : String(Math.trunc(v));
}

export function sqlNullableDouble(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return 'NULL';
  return `CAST(${v} AS DOUBLE)`;
}

/**
 * Permission check: caller must have one of the brand-analytics permissions
 * on the requested company_id.
 */
export async function isAuthorizedForCompany(
  companyId: number,
  context: ToolExecutionContext,
): Promise<boolean> {
  const permissions = [
    'view:quicksight_group.sales_and_marketing_new',
    'view:quicksight_group.marketing',
  ];
  for (const permission of permissions) {
    try {
      const resp = await neonPanelRequest<CompaniesWithPermissionResponse>({
        token: context.userToken,
        path: `/api/v1/permissions/${encodeURIComponent(permission)}/companies`,
      });
      const ids = (resp.companies ?? [])
        .map((c) => c.company_id ?? c.companyId ?? c.id)
        .filter((id): id is number => typeof id === 'number' && Number.isFinite(id) && id > 0);
      if (ids.includes(companyId)) return true;
    } catch {
      // continue
    }
  }
  return false;
}
