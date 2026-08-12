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

  const violations: string[] = [];
  for (const dir of registeredTools) {
    for (const { file, text } of readAll(dir, ['.ts', '.sql'])) {
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
