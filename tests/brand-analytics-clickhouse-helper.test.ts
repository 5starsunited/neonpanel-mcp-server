import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  allowListedSql,
  sqlNullableDateExpr,
  sqlNullableStringExpr,
  sqlStringArrayExpr,
  sqlStringLiteral,
  sqlUInt64ArrayExpr,
} from '../src/tools/athena_tools/tools/brand_analytics/_clickhouse';

test('Brand Analytics ClickHouse helpers render typed array literals', () => {
  assert.equal(sqlStringArrayExpr([]), "CAST([], 'Array(String)')");
  assert.equal(sqlStringArrayExpr(['US', "O'Reilly"]), "CAST(['US','O\\'Reilly'], 'Array(String)')");
  assert.equal(sqlUInt64ArrayExpr([]), "CAST([], 'Array(UInt64)')");
  assert.equal(sqlUInt64ArrayExpr([1, 42]), "CAST([1,42], 'Array(UInt64)')");
  assert.throws(() => sqlUInt64ArrayExpr([-1]), /non-negative safe integers/);
});

test('Brand Analytics ClickHouse helpers escape literals and type nullable values', () => {
  assert.equal(sqlStringLiteral("a\\b'c"), "'a\\\\b\\'c'");
  assert.equal(sqlNullableStringExpr(null), 'CAST(NULL AS Nullable(String))');
  assert.equal(sqlNullableStringExpr(''), 'CAST(NULL AS Nullable(String))');
  assert.equal(sqlNullableStringExpr('term'), "'term'");
  assert.equal(sqlNullableDateExpr(), 'CAST(NULL AS Nullable(Date))');
  assert.equal(sqlNullableDateExpr('2026-08-06'), "toDate('2026-08-06')");
  assert.throws(() => sqlNullableDateExpr('06-08-2026'), /YYYY-MM-DD/);
});

test('Brand Analytics ClickHouse helpers only render allow-listed dimensions', () => {
  const dimensions = { company: 'company_id', week: 'toStartOfWeek(week_start)' } as const;

  assert.equal(allowListedSql('week', dimensions, 'company'), 'toStartOfWeek(week_start)');
  assert.equal(allowListedSql('company_id; DROP TABLE', dimensions, 'company'), 'company_id');
});