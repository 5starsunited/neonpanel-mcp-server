import path from 'node:path';
import { runAthenaQuery } from '../../../../../clients/athena';
import { config } from '../../../../../config';
import { logger } from '../../../../../logging/logger';
import { loadTextFile } from '../../../runtime/load-assets';
import { renderSqlTemplate } from '../../../runtime/render-sql';
import { sqlStringLiteral } from '../_clickhouse';

/**
 * PPC leg of brand_analytics_growth_machine_diagnosis.
 *
 * Ads live in Athena (amazon_ads.ads_dataset) while Brand Analytics lives in ClickHouse, so the
 * two cannot be joined in one statement. We run ppc_athena.sql first (SP EXACT-match keyword
 * targets aggregated to keyword × ASIN over the SQP weeks of the period), then inline the rows
 * into the ClickHouse diagnosis query as a values() relation. Keeping the join and the
 * prescription cascade in one ClickHouse query means the grouped and ungrouped paths cannot
 * diverge from each other.
 */

/** Cap on inlined keyword × ASIN rows. Rows arrive sorted by spend, so the cap drops the tail. */
export const MAX_PPC_ROWS = 5000;

/**
 * ClickHouse parses at most max_query_size bytes of query text (default 256 KiB). An inlined
 * PPC relation at the row cap is roughly 0.5 MB, so the diagnosis request raises the limit.
 */
export const PPC_QUERY_SETTINGS = { max_query_size: 8 * 1024 * 1024 } as const;

export const PPC_SOURCE_LABEL = 'athena:amazon_ads.ads_dataset (Sponsored Products EXACT keyword targets)';

export type PpcExactRow = {
  kw_norm: string;
  child_asin: string;
  ppc_impressions: number;
  ppc_clicks: number;
  ppc_spend: number;
  ppc_sales: number;
  ppc_purchases: number;
  ppc_campaign_count: number;
};

export type PpcSourceStatus = 'ok' | 'no_ad_data' | 'error';

export type PpcFetchResult = {
  status: PpcSourceStatus;
  rows: PpcExactRow[];
  truncated: boolean;
  /** Total SP spend (USD) for the company / marketplace / period, all match types. */
  totalSpSpendUsd: number | null;
  /** SP spend (USD) on EXACT keyword targets, before the diagnosis entity/keyword scope. */
  exactSpendUsd: number | null;
  error?: string;
};

function athenaStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function athenaDateLiteral(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Athena dates must use YYYY-MM-DD.');
  }
  return `DATE '${value}'`;
}

function toCount(value: string | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function toMoney(value: string | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function renderPpcAthenaSql(
  template: string,
  params: { catalog: string; companyId: number; marketplaceId: string; periodStart: string; periodEnd: string },
): string {
  if (!Number.isSafeInteger(params.companyId) || params.companyId < 1) {
    throw new Error('company_id must be a positive integer.');
  }
  return renderSqlTemplate(template, {
    catalog: params.catalog,
    company_id: params.companyId,
    marketplace_id_literal: athenaStringLiteral(params.marketplaceId),
    period_start_date: athenaDateLiteral(params.periodStart),
    period_end_date: athenaDateLiteral(params.periodEnd),
  });
}

/** Splits Athena output into the coverage row and the EXACT keyword × ASIN rows. */
export function parsePpcAthenaRows(
  rows: Array<Record<string, string | null>>,
): Pick<PpcFetchResult, 'rows' | 'totalSpSpendUsd' | 'exactSpendUsd' | 'truncated'> {
  let totalSpSpendUsd: number | null = null;
  const exact: PpcExactRow[] = [];
  for (const row of rows) {
    if (row.row_kind === 'coverage') {
      totalSpSpendUsd = row.ppc_spend == null ? 0 : toMoney(row.ppc_spend);
      continue;
    }
    const kw = (row.kw_norm ?? '').trim().toLowerCase();
    const asin = (row.child_asin ?? '').trim();
    if (!kw || !asin) continue;
    exact.push({
      kw_norm: kw,
      child_asin: asin,
      ppc_impressions: toCount(row.ppc_impressions),
      ppc_clicks: toCount(row.ppc_clicks),
      ppc_spend: toMoney(row.ppc_spend),
      ppc_sales: toMoney(row.ppc_sales),
      ppc_purchases: toCount(row.ppc_purchases),
      ppc_campaign_count: toCount(row.ppc_campaign_count),
    });
  }
  const truncated = exact.length > MAX_PPC_ROWS;
  const kept = truncated ? exact.slice(0, MAX_PPC_ROWS) : exact;
  const exactSpendUsd = exact.reduce((acc, r) => acc + r.ppc_spend, 0);
  return { rows: kept, totalSpSpendUsd, exactSpendUsd, truncated };
}

const PPC_COLUMNS_SPEC =
  'kw_norm String, child_asin String, ppc_impressions UInt64, ppc_clicks UInt64, ' +
  'ppc_spend Float64, ppc_sales Float64, ppc_purchases UInt64, ppc_campaign_count UInt32';

/** Empty relation with the PPC column contract (used when there are no rows or Athena failed). */
export const EMPTY_PPC_ROWS_SQL =
  "SELECT '' AS kw_norm, '' AS child_asin, toUInt64(0) AS ppc_impressions, toUInt64(0) AS ppc_clicks, " +
  'toFloat64(0) AS ppc_spend, toFloat64(0) AS ppc_sales, toUInt64(0) AS ppc_purchases, ' +
  'toUInt32(0) AS ppc_campaign_count WHERE 0';

function floatLiteral(value: number): string {
  return Number.isFinite(value) ? String(value) : '0';
}

/**
 * Renders PPC rows as a single-line ClickHouse values() relation. Single-line on purpose: the
 * relation is spliced into a template, and nothing in it may terminate or open a comment.
 */
export function buildPpcRowsSql(rows: readonly PpcExactRow[]): string {
  if (rows.length === 0) return EMPTY_PPC_ROWS_SQL;
  const tuples = rows.map(
    (r) =>
      `(${sqlStringLiteral(r.kw_norm)},${sqlStringLiteral(r.child_asin)},` +
      `${toCount(String(r.ppc_impressions))},${toCount(String(r.ppc_clicks))},` +
      `${floatLiteral(r.ppc_spend)},${floatLiteral(r.ppc_sales)},` +
      `${toCount(String(r.ppc_purchases))},${toCount(String(r.ppc_campaign_count))})`,
  );
  return `SELECT * FROM values(${sqlStringLiteral(PPC_COLUMNS_SPEC)}, ${tuples.join(',')})`;
}

/**
 * Runs the Athena PPC query. Never throws: an Athena failure degrades to status 'error' with no
 * rows, so the diagnosis still returns its SQP/SCP prescriptions with PPC signals NULL.
 */
export async function fetchPpcExactTargets(params: {
  companyId: number;
  marketplaceId: string;
  periodStart: string;
  periodEnd: string;
}): Promise<PpcFetchResult> {
  try {
    const template = await loadTextFile(path.join(__dirname, 'ppc_athena.sql'));
    const query = renderPpcAthenaSql(template, { ...params, catalog: config.athena.catalog });
    const result = await runAthenaQuery({
      query,
      database: 'amazon_ads',
      workGroup: config.athena.workgroup,
      outputLocation: config.athena.outputLocation,
      // +1 for the coverage row, +1 so truncation is detectable.
      maxRows: MAX_PPC_ROWS + 2,
    });
    const parsed = parsePpcAthenaRows(result.rows ?? []);
    const status: PpcSourceStatus = (parsed.totalSpSpendUsd ?? 0) > 0 ? 'ok' : 'no_ad_data';
    return { status, ...parsed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ err: message, companyId: params.companyId }, 'Growth machine PPC (Athena) query failed');
    return {
      status: 'error',
      rows: [],
      truncated: false,
      totalSpSpendUsd: null,
      exactSpendUsd: null,
      error: message,
    };
  }
}

/** Header fields describing the PPC leg. */
export function ppcHeaderFields(
  ppc: PpcFetchResult,
  matchStats: { exactKeywords: number | null; exactKeywordsInSqp: number | null },
): Record<string, unknown> {
  const warnings: string[] = [];
  if (ppc.status === 'error') {
    warnings.push(
      `PPC source unavailable (${ppc.error ?? 'Athena query failed'}); PPC-driven signals are NULL (not evaluated).`,
    );
  } else if (ppc.status === 'no_ad_data') {
    warnings.push('No Sponsored Products spend for this company/marketplace/period; PPC-driven signals are NULL.');
  } else {
    warnings.push(
      'PPC covers Sponsored Products EXACT keyword targets only. BROAD/PHRASE/auto/ASIN targets cannot be ' +
        'attributed to a search term, so rows without an EXACT target have ppc_evaluated=false and NULL PPC signals.',
    );
  }
  if (ppc.truncated) {
    warnings.push(`PPC rows capped at the top ${MAX_PPC_ROWS} keyword × ASIN pairs by spend.`);
  }
  const coverage =
    ppc.exactSpendUsd != null && ppc.totalSpSpendUsd != null && ppc.totalSpSpendUsd > 0
      ? Math.round((ppc.exactSpendUsd / ppc.totalSpSpendUsd) * 1000) / 10
      : null;
  const { exactKeywords, exactKeywordsInSqp } = matchStats;
  return {
    ppc_source: PPC_SOURCE_LABEL,
    ppc_source_status: ppc.status,
    ppc_total_sp_spend_usd: ppc.totalSpSpendUsd == null ? null : Math.round(ppc.totalSpSpendUsd * 100) / 100,
    ppc_exact_spend_usd: ppc.exactSpendUsd == null ? null : Math.round(ppc.exactSpendUsd * 100) / 100,
    ppc_exact_spend_coverage_pct: coverage,
    ppc_rows_truncated: ppc.truncated,
    normalization_match_rate:
      exactKeywords != null && exactKeywords > 0 && exactKeywordsInSqp != null
        ? Math.round((exactKeywordsInSqp / exactKeywords) * 1000) / 1000
        : null,
    warnings,
  };
}

/** Reads and removes the run-level `_ppc_*` columns the ClickHouse query repeats on every row. */
export function extractMatchStats(rows: Array<Record<string, unknown>>): {
  rows: Array<Record<string, unknown>>;
  exactKeywords: number | null;
  exactKeywordsInSqp: number | null;
} {
  let exactKeywords: number | null = null;
  let exactKeywordsInSqp: number | null = null;
  const cleaned = rows.map((row) => {
    const { _ppc_exact_keywords: a, _ppc_exact_keywords_in_sqp: b, ...rest } = row;
    if (exactKeywords == null && a != null) exactKeywords = Number(a);
    if (exactKeywordsInSqp == null && b != null) exactKeywordsInSqp = Number(b);
    return rest;
  });
  return { rows: cleaned, exactKeywords, exactKeywordsInSqp };
}
