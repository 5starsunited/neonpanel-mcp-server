import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  buildPpcRowsSql,
  EMPTY_PPC_ROWS_SQL,
  extractMatchStats,
  MAX_PPC_ROWS,
  parsePpcAthenaRows,
  ppcHeaderFields,
  renderPpcAthenaSql,
  type PpcFetchResult,
} from '../src/tools/athena_tools/tools/brand_analytics/growth_machine_diagnosis/ppc';

const dir = path.join(process.cwd(), 'src/tools/athena_tools/tools/brand_analytics/growth_machine_diagnosis');

test('parsePpcAthenaRows separates coverage from EXACT rows and normalises keys', () => {
  const parsed = parsePpcAthenaRows([
    { row_kind: 'coverage', kw_norm: '', child_asin: '', ppc_spend: '1000.5' },
    {
      row_kind: 'exact', kw_norm: '  Donut Pillow ', child_asin: 'B0B61478T9', ppc_impressions: '100',
      ppc_clicks: '10', ppc_spend: '250.25', ppc_sales: '900', ppc_purchases: '7', ppc_campaign_count: '2',
    },
    { row_kind: 'exact', kw_norm: '', child_asin: 'B0X', ppc_spend: '5' },
  ]);
  assert.equal(parsed.totalSpSpendUsd, 1000.5);
  assert.equal(parsed.rows.length, 1);
  assert.deepEqual(parsed.rows[0], {
    kw_norm: 'donut pillow', child_asin: 'B0B61478T9', ppc_impressions: 100, ppc_clicks: 10,
    ppc_spend: 250.25, ppc_sales: 900, ppc_purchases: 7, ppc_campaign_count: 2,
  });
  assert.equal(parsed.exactSpendUsd, 250.25);
  assert.equal(parsed.truncated, false);
});

test('parsePpcAthenaRows caps rows and flags truncation', () => {
  const rows = Array.from({ length: MAX_PPC_ROWS + 1 }, (_, i) => ({
    row_kind: 'exact', kw_norm: `kw ${i}`, child_asin: 'B0', ppc_spend: '1',
  }));
  const parsed = parsePpcAthenaRows(rows);
  assert.equal(parsed.rows.length, MAX_PPC_ROWS);
  assert.equal(parsed.truncated, true);
  // Coverage maths must use all EXACT spend, not just the kept rows.
  assert.equal(parsed.exactSpendUsd, MAX_PPC_ROWS + 1);
});

test('buildPpcRowsSql is a single-line, escaped values() relation', () => {
  assert.equal(buildPpcRowsSql([]), EMPTY_PPC_ROWS_SQL);
  const sql = buildPpcRowsSql([
    {
      kw_norm: "o'reilly \\ pillow -- x", child_asin: 'B0', ppc_impressions: 1.9, ppc_clicks: -3,
      ppc_spend: Number.NaN, ppc_sales: 12.5, ppc_purchases: 2, ppc_campaign_count: 1,
    },
  ]);
  assert.ok(!sql.includes('\n'), 'must stay on one line');
  assert.match(sql, /^SELECT \* FROM values\('kw_norm String, child_asin String/);
  assert.ok(sql.includes("'o\\'reilly \\\\ pillow -- x'"), sql);
  assert.ok(sql.includes(",'B0',1,0,0,12.5,2,1)"), sql);
});

test('renderPpcAthenaSql fills every token and rejects bad dates', () => {
  const template = fs.readFileSync(path.join(dir, 'ppc_athena.sql'), 'utf8');
  const sql = renderPpcAthenaSql(template, {
    catalog: 'awsdatacatalog', companyId: 106, marketplaceId: "ATVP'X", periodStart: '2026-10-04', periodEnd: '2026-11-08',
  });
  assert.ok(!/\{\{/.test(sql));
  assert.match(sql, /company_id = 106/);
  assert.match(sql, /amazon_marketplace_id = 'ATVP''X'/);
  assert.match(sql, /DATE '2026-10-04'/);
  assert.throws(() =>
    renderPpcAthenaSql(template, {
      catalog: 'c', companyId: 106, marketplaceId: 'm', periodStart: "2026-10-04'; --", periodEnd: '2026-11-08',
    }),
  );
});

test('ppcHeaderFields reports coverage, match rate and degrades on error', () => {
  const ok: PpcFetchResult = {
    status: 'ok', rows: [], truncated: false, totalSpSpendUsd: 342249.05, exactSpendUsd: 122101.41,
  };
  const h = ppcHeaderFields(ok, { exactKeywords: 200, exactKeywordsInSqp: 150 });
  assert.equal(h.ppc_source_status, 'ok');
  assert.equal(h.ppc_exact_spend_coverage_pct, 35.7);
  assert.equal(h.normalization_match_rate, 0.75);

  const failed: PpcFetchResult = {
    status: 'error', rows: [], truncated: false, totalSpSpendUsd: null, exactSpendUsd: null, error: 'boom',
  };
  const e = ppcHeaderFields(failed, { exactKeywords: null, exactKeywordsInSqp: null });
  assert.equal(e.ppc_source_status, 'error');
  assert.equal(e.ppc_exact_spend_coverage_pct, null);
  assert.equal(e.normalization_match_rate, null);
  assert.match((e.warnings as string[])[0], /boom/);
});

test('extractMatchStats lifts the run-level columns out of every row', () => {
  const out = extractMatchStats([
    { a: 1, _ppc_exact_keywords: 10, _ppc_exact_keywords_in_sqp: 4 },
    { a: 2, _ppc_exact_keywords: 10, _ppc_exact_keywords_in_sqp: 4 },
  ]);
  assert.deepEqual(out.rows, [{ a: 1 }, { a: 2 }]);
  assert.equal(out.exactKeywords, 10);
  assert.equal(out.exactKeywordsInSqp, 4);
});
