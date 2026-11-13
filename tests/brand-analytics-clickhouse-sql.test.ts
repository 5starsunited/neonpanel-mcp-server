import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

/**
 * Regression guard for the Athena -> ClickHouse migration of the Brand
 * Analytics tool group.
 *
 * Every tool in this group now reads ClickHouse. These assertions exist so a
 * later change cannot quietly reintroduce an Athena dependency, or reintroduce
 * one of the three silent-wrong-answer bug classes the migration uncovered.
 * Each one is a defect that produced plausible numbers rather than an error,
 * which is exactly the kind that survives review.
 */

const groupRoot = path.join(
  process.cwd(),
  'src/tools/athena_tools/tools/brand_analytics',
);

/** Directories holding a registered tool (identified by having a register.ts). */
function toolDirs(): string[] {
  return fs
    .readdirSync(groupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(groupRoot, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'register.ts')));
}

/**
 * Comments legitimately mention the Athena sources each query was migrated
 * from, so scanning raw text would flag the very notes that explain the
 * migration. Strip comments and string literals are left intact deliberately:
 * a table name smuggled through a literal is still a real dependency.
 */
function stripComments(text: string, ext: string): string {
  const withoutBlock = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return ext === '.sql'
    ? withoutBlock.replace(/--[^\n]*/g, ' ')
    : withoutBlock.replace(/^\s*\/\/[^\n]*/gm, ' ');
}

function readAll(dir: string, extensions: string[]): Array<{ file: string; text: string }> {
  return fs
    .readdirSync(dir)
    .filter((name) => extensions.includes(path.extname(name)))
    .map((name) => ({
      file: path.join(dir, name),
      text: stripComments(fs.readFileSync(path.join(dir, name), 'utf8'), path.extname(name)),
    }));
}

const registeredTools = toolDirs();

test('every Brand Analytics tool is registered and discoverable', () => {
  // Guards against a tool being dropped from the group unnoticed. Update the
  // count deliberately when adding or removing a tool.
  assert.equal(registeredTools.length, 23, `expected 23 registered tools, found ${registeredTools.length}`);
});

test('no Brand Analytics handler or SQL asset references Athena', () => {
  const forbidden: Array<{ pattern: RegExp; why: string }> = [
    { pattern: /runAthenaQuery/, why: 'Athena client' },
    { pattern: /config\.athena/, why: 'Athena config' },
    { pattern: /\{\{\s*catalog\s*\}\}/, why: 'Athena catalog token' },
    { pattern: /brand_analytics_iceberg/, why: 'Athena database' },
    { pattern: /amazon_ads_reports_iceberg/, why: 'Athena database' },
    { pattern: /AwsDataCatalog/i, why: 'Athena catalog' },
    { pattern: /\bapproxdistinct\s*\(/i, why: 'Athena-only function' },
    { pattern: /\barray_agg\s*\(/i, why: 'Athena-only function' },
    { pattern: /\bcardinality\s*\(/i, why: 'Athena-only function' },
    { pattern: /\bany_match\s*\(/i, why: 'Athena-only function' },
    { pattern: /\btry_cast\s*\(/i, why: 'Athena-only function' },
    { pattern: /\bdate_add\s*\(\s*'/i, why: 'Athena-only function' },
    { pattern: /\bUNNEST\b/, why: 'Athena-only construct' },
  ];

  // The ONE sanctioned Athena dependency: the growth machine's PPC leg. Amazon Ads data
  // only exists in Athena (amazon_ads.ads_dataset) since the Ads ClickHouse retirement on
  // 2026-10-08; Brand Analytics data itself must still come from ClickHouse. The test below
  // pins these files to the Ads serving table so the exemption cannot widen silently.
  const sanctionedAthenaFiles = new Set([
    'src/tools/athena_tools/tools/brand_analytics/growth_machine_diagnosis/ppc.ts',
    'src/tools/athena_tools/tools/brand_analytics/growth_machine_diagnosis/ppc_athena.sql',
  ]);

  const violations: string[] = [];
  for (const dir of registeredTools) {
    for (const { file, text } of readAll(dir, ['.ts', '.sql'])) {
      if (sanctionedAthenaFiles.has(path.relative(process.cwd(), file))) continue;
      for (const { pattern, why } of forbidden) {
        if (pattern.test(text)) {
          violations.push(`${path.relative(process.cwd(), file)}: ${why} (${pattern})`);
        }
      }
    }
  }
  assert.deepEqual(violations, [], `Athena references found:\n${violations.join('\n')}`);
});

test('tool.json descriptions name ClickHouse tables, not the old Athena ones', () => {
  // Descriptions are read by the model at call time, so a stale table name
  // there is a live instruction to reason about a database that no longer
  // backs the tool -- worth catching separately from the SQL itself.
  const violations: string[] = [];
  for (const dir of registeredTools) {
    const manifest = path.join(dir, 'tool.json');
    if (!fs.existsSync(manifest)) continue;
    const text = fs.readFileSync(manifest, 'utf8');
    for (const stale of text.match(/\b\w*_iceberg\.\w+/g) ?? []) {
      violations.push(`${path.relative(process.cwd(), manifest)}: ${stale}`);
    }
  }
  assert.deepEqual(violations, [], `stale Athena table names:\n${violations.join('\n')}`);
});

test('lagInFrame is always wrapped in toNullable', () => {
  // ClickHouse lagInFrame returns the column type's DEFAULT (0.0, '') rather
  // than NULL when there is no preceding row. Unwrapped, a first observation
  // reports a delta equal to its entire current value and any "is this the
  // first period?" branch never fires.
  const violations: string[] = [];
  for (const dir of registeredTools) {
    for (const { file, text } of readAll(dir, ['.sql'])) {
      const calls = text.match(/lagInFrame\s*\(\s*[^)]*/g) ?? [];
      for (const call of calls) {
        if (!call.includes('toNullable')) {
          violations.push(`${path.relative(process.cwd(), file)}: ${call.trim()}`);
        }
      }
    }
  }
  assert.deepEqual(violations, [], `lagInFrame without toNullable:\n${violations.join('\n')}`);
});

test('maxIf/minIf used to pick thresholds are wrapped in toNullable', () => {
  // Same defect class: maxIf returns 0 rather than NULL when no row matches,
  // which silently defeats every `ifNull(threshold, <default>)` fallback.
  const violations: string[] = [];
  for (const dir of registeredTools) {
    for (const { file, text } of readAll(dir, ['.sql'])) {
      if (!/threshold_value/.test(text)) continue;
      const calls = text.match(/\b(?:maxIf|minIf)\s*\(\s*[^,]*/g) ?? [];
      for (const call of calls) {
        if (call.includes('threshold_value') && !call.includes('toNullable')) {
          violations.push(`${path.relative(process.cwd(), file)}: ${call.trim()}`);
        }
      }
    }
  }
  assert.deepEqual(violations, [], `threshold aggregate without toNullable:\n${violations.join('\n')}`);
});

test('ranked output uses the rank column, not a re-sorted duplicate ORDER BY', () => {
  // row_number() OVER (ORDER BY <sort>) in the projection plus a separate final
  // ORDER BY <sort> lets the two break ties independently. Observed live: a
  // "top 3" that returned ranks 184, 183, 182. Any query that computes a rank
  // must order its final result by that rank.
  const violations: string[] = [];
  for (const dir of registeredTools) {
    for (const { file, text } of readAll(dir, ['.sql'])) {
      // `rank` exactly -- not rank_position, which is a partitioned per-group
      // attribute rather than the rank of the result set.
      if (!/\brow_number\(\)[\s\S]{0,400}?AS\s+`rank`/i.test(text)) continue;
      const finalOrderBy = text.match(/ORDER BY[\s\S]*$/i)?.[0] ?? '';
      if (!/ORDER BY\s+`rank`/i.test(finalOrderBy)) {
        violations.push(path.relative(process.cwd(), file));
      }
    }
  }
  assert.deepEqual(violations, [], `computed a rank but did not order by it:\n${violations.join('\n')}`);
});

test('SQL assets declare no unresolved template tokens outside {{...}} placeholders', () => {
  // renderSqlTemplate throws on unknown tokens at runtime; this catches a
  // malformed placeholder (e.g. {{ foo } ) at commit time instead.
  const violations: string[] = [];
  for (const dir of registeredTools) {
    for (const { file, text } of readAll(dir, ['.sql'])) {
      const stray = text.match(/\{\{[^}]*$|^[^{]*\}\}/gm) ?? [];
      const unbalanced = stray.filter((s) => s.includes('{{') !== s.includes('}}'));
      if (unbalanced.length > 0) {
        violations.push(`${path.relative(process.cwd(), file)}: ${unbalanced.join(' | ')}`);
      }
    }
  }
  assert.deepEqual(violations, [], `malformed template tokens:\n${violations.join('\n')}`);
});

test('revenue/Pareto classification is read only from the dated daily table', () => {
  // etl.ba_asin_attributes derives revenue_abcd_class / pareto_abc_class from
  // etl.sku_classification_last30_by_marketplace, which is a plain View: it is
  // recomputed from a rolling trailing-30-day window at query time. A historical
  // week therefore came back stamped with TODAY's class, and the same query re-run
  // an hour later returned different classes for the same week -- silently.
  //
  // Classification now comes from etl.asin_revenue_class_daily, rebuilt and
  // date-stamped once a day by clickhouse_etl migration 0054, exposed as the
  // `asin_revenue_class` CTE. Downstream CTEs may pass the columns along under
  // their own aliases; what must never happen is reading them back off a live
  // source. So the check resolves each alias to the table it is bound to, rather
  // than whitelisting alias names.
  const classColumn = /(?:revenue_abcd_class|pareto_abc_class)/;
  const liveClassSources = new Set([
    'etl.ba_asin_attributes',
    'etl.ba_search_query_performance',
    'etl.ba_search_catalog_performance',
    'etl.sku_classification_last30_by_marketplace',
  ]);
  const violations: string[] = [];

  for (const dir of registeredTools) {
    for (const { file, text } of readAll(dir, ['.sql'])) {
      if (!classColumn.test(text)) continue;
      const relative = path.relative(process.cwd(), file);

      const boundToLiveSource = new Map<string, string>();
      for (const [, table, alias] of text.matchAll(
        /(?:FROM|JOIN)\s+(etl\.\w+)\s+AS\s+(\w+)/gi,
      )) {
        if (liveClassSources.has(table.toLowerCase())) {
          boundToLiveSource.set(alias, table);
        }
      }

      for (const [, alias] of text.matchAll(
        /\b(\w+)\.(?:revenue_abcd_class|pareto_abc_class)\b/g,
      )) {
        const table = boundToLiveSource.get(alias);
        if (table) {
          violations.push(`${relative}: reads ${alias}.<class> off the live ${table}`);
        }
      }

      // The rolling view must not be reintroduced under any alias.
      if (/sku_classification_last30_by_marketplace/.test(text)) {
        violations.push(`${relative}: references the rolling classification view`);
      }

      // Classification columns are only legitimate if the dated CTE is in scope.
      if (!/\{\{\s*asin_class_cte_sql\s*\}\}/.test(text)) {
        violations.push(`${relative}: uses class columns without the {{asin_class_cte_sql}} token`);
      }
    }
  }

  assert.deepEqual(
    [...new Set(violations)],
    [],
    `classification must come from etl.asin_revenue_class_daily:\n${violations.join('\n')}`,
  );
});

test('queries that expose a class column also expose classification_as_of', () => {
  // The class is a point-in-time fact rebuilt daily, and a refresh can lag or
  // fail. Every response that carries a class must carry the as-of date beside
  // it, otherwise a caller reads a stale class as current.
  //
  // Whether a class column survives to the response cannot be decided by pattern
  // matching: the grouped variants project a class in their base CTE and then
  // aggregate it away, so they look identical to the detail variants in the text.
  // The two sets below were established by running each query and reading the
  // returned column names, and are asserted to cover every query that uses the
  // classification CTE -- so a new query cannot join the group unclassified.
  const exposesClass = new Set([
    'analyze_search_query_performance/query.sql',
    'analyze_search_catalog_performance/query.sql',
    'get_conversion_leak_analysis/query.sql',
    'get_search_term_momentum/query.sql',
    'analyze_repeat_purchases/query.sql',
    'get_cross_sell_opportunities/query.sql',
  ]);
  // Filters on class but aggregates it out of the projection.
  const filtersOnly = new Set([
    'analyze_search_query_performance/query_grouped.sql',
    'get_search_term_momentum/query_grouped.sql',
    'get_keyword_funnel_metrics/query.sql',
    'get_keyword_funnel_metrics/query_grouped.sql',
  ]);

  const usingCte: string[] = [];
  const missingAsOf: string[] = [];
  const unexpectedAsOf: string[] = [];

  for (const dir of registeredTools) {
    for (const { file, text } of readAll(dir, ['.sql'])) {
      if (!/\{\{\s*asin_class_cte_sql\s*\}\}/.test(text)) continue;
      const id = `${path.basename(dir)}/${path.basename(file)}`;
      usingCte.push(id);
      const hasAsOf = /classification_as_of/.test(text);
      if (exposesClass.has(id) && !hasAsOf) missingAsOf.push(id);
      if (filtersOnly.has(id) && hasAsOf) unexpectedAsOf.push(id);
    }
  }

  assert.deepEqual(
    usingCte.sort(),
    [...exposesClass, ...filtersOnly].sort(),
    'a query started using the classification CTE without being classified as exposing or filtering it',
  );
  assert.deepEqual(missingAsOf, [], `class exposed without classification_as_of:\n${missingAsOf.join('\n')}`);
  assert.deepEqual(
    unexpectedAsOf,
    [],
    `filter-only query now returns classification_as_of; move it to exposesClass:\n${unexpectedAsOf.join('\n')}`,
  );
});


test('search term momentum scopes the competitor top-3 to the company and requested terms', () => {
  // etl.ba_search_term_smart / ba_search_terms_current take the latest generation with a
  // QUALIFY window that has no company_id in its partition, so the company filter cannot be
  // pushed below it: each call materialised every company's latest week (millions of rows)
  // and hit the memory limit even for a single keyword. The tool must read the staging table
  // with the company filter inside the window input, and restrict top3 to the requested terms.
  const dir = path.join(groupRoot, 'get_search_term_momentum');
  for (const file of ['query.sql', 'query_grouped.sql']) {
    const sql = stripComments(fs.readFileSync(path.join(dir, file), 'utf8'), '.sql');
    assert.doesNotMatch(sql, /ba_search_term_smart|ba_search_terms_current/, `${file} reads the unpushable view`);
    assert.match(sql, /FROM staging\.ba_search_terms/, `${file} must read staging.ba_search_terms`);
    assert.match(
      sql,
      /FROM staging\.ba_search_terms\s+WHERE has\(\{\{company_ids_array\}\}, company_id\)/,
      `${file} must filter company before the window`,
    );
    assert.match(sql, /\{\{top3_term_filter_sql\}\}/, `${file} must restrict top3 to requested terms`);
    assert.match(sql, /base_filtered AS MATERIALIZED/, `${file} must not re-evaluate base_filtered per reference`);
  }
  // The detail query only needs brand/product_family, so it must not pay for the
  // ba_search_query_performance view (planning attributes + rolling 30-day classification).
  const detail = stripComments(fs.readFileSync(path.join(dir, 'query.sql'), 'utf8'), '.sql');
  assert.doesNotMatch(detail, /etl\.ba_search_query_performance\s+AS sqp/);
  assert.match(detail, /etl\.ba_search_query_performance_current AS sqp/);
});

test('growth_machine PPC leg reads only the Ads serving table, SP EXACT targets', () => {
  const dir = path.join(process.cwd(), 'src/tools/athena_tools/tools/brand_analytics/growth_machine_diagnosis');
  const sql = stripComments(fs.readFileSync(path.join(dir, 'ppc_athena.sql'), 'utf8'), '.sql');
  const tables = [...sql.matchAll(/FROM\s+("[^"]+"\.)?"?([a-z_]+)"?\."?([a-z_]+)"?/gi)].map((m) => `${m[2]}.${m[3]}`);
  assert.deepEqual([...new Set(tables)], ['amazon_ads.ads_dataset']);
  assert.match(sql, /company_id = \{\{company_id\}\}/, 'must be tenant-scoped');
  assert.match(sql, /amazon_marketplace_id = \{\{marketplace_id_literal\}\}/);
  assert.match(sql, /match_type = 'EXACT'/, 'only EXACT targets map to a search term');
  // Conversion rows carry no keyword text: the keyword must be rebuilt from target_keyword_id,
  // otherwise every sale lands on a NULL keyword and every keyword looks like a bleeder.
  assert.match(sql, /LEFT JOIN kw_dim AS k ON k\.target_keyword_id = sp\.target_keyword_id/);

  for (const file of ['query.sql', 'query_grouped.sql']) {
    const ch = fs.readFileSync(path.join(dir, file), 'utf8');
    const body = stripComments(ch, '.sql');
    assert.match(body, /FROM \(\{\{ppc_rows_sql\}\}\) AS ppc_src/, `${file} must read the inlined PPC rows`);
    // The token must not appear in a comment: a multi-row values() spliced into a `--`
    // comment would be harmless only while it stays on one line.
    assert.equal((ch.match(/\{\{ppc_rows_sql\}\}/g) ?? []).length, 1, `${file}: ppc_rows_sql must appear once`);
    // PPC-driven signals must be NULL, not false, when no EXACT target exists.
    for (const sig of ['sig_cart_leak', 'sig_bleeder', 'sig_proven_winner', 'sig_cannibalization']) {
      assert.match(body, new RegExp(`f\\.ppc_evaluated[^,]*,[\\s\\S]*?NULL\\s*\\)\\s*AS ${sig}`), `${file}: ${sig}`);
    }
  }
});

test('growth_machine organic-share signals use the ASIN purchase share and NULL when unknown', () => {
  const dir = path.join(process.cwd(), 'src/tools/athena_tools/tools/brand_analytics/growth_machine_diagnosis');
  for (const file of ['query.sql', 'query_grouped.sql']) {
    const body = stripComments(fs.readFileSync(path.join(dir, file), 'utf8'), '.sql');
    // total_purchase_rate is the MARKET conversion rate; it must never feed the share column.
    assert.match(body, /avg\(asin_purchase_share\) AS sqp_brand_purchase_share/, file);
    assert.match(body, /avg\(total_purchase_rate\) AS sqp_market_purchase_rate/, file);
    assert.doesNotMatch(body, /total_purchase_rate\) AS sqp_brand_purchase_share/, file);
    // Unknown share (no SQP row) must not be read as 0.
    assert.doesNotMatch(body, /ifNull\(f\.sqp_brand_purchase_share, 0\)/, file);
    for (const sig of ['sig_proven_winner', 'sig_cannibalization', 'sig_defend']) {
      assert.match(
        body,
        new RegExp(`isNotNull\\(f\\.sqp_brand_purchase_share\\),[\\s\\S]*?NULL\\s*\\)\\s*AS ${sig}`),
        `${file}: ${sig} must be NULL when organic share is unknown`,
      );
    }
  }
});

test('growth_machine_diagnosis no longer reads the dropped PPC search-term table', () => {
  const dir = path.join(process.cwd(), 'src/tools/athena_tools/tools/brand_analytics/growth_machine_diagnosis');
  for (const file of ['query.sql', 'query_grouped.sql']) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    assert.doesNotMatch(sql, /FROM\s+etl\.ba_ppc_search_terms_weekly/i, file);
    // SQP is windowed from staging with the company filter applied before the window.
    assert.match(sql, /FROM staging\.ba_search_query_performance[\s\S]*?QUALIFY/, file);
  }
});
