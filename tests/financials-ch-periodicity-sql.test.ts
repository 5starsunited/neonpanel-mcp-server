import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { renderSqlTemplate } from '../src/tools/athena_tools/runtime/render-sql';

const toolRoot = path.join(
  process.cwd(),
  'src/tools/athena_tools/tools/financials/analyze_financial_transactions_ch',
);

const sql = fs.readFileSync(path.join(toolRoot, 'query.sql'), 'utf8');
const register = fs.readFileSync(path.join(toolRoot, 'register.ts'), 'utf8');

// The ClickHouse date-bucket expressions the register maps each periodicity to.
// Mirrors PERIOD_EXPR in register.ts; 'none' collapses to a single NULL bucket.
const PERIOD_EXPRS = [
  'CAST(NULL AS Nullable(Date))',
  'toDate(posted_date_day)',
  'toMonday(posted_date_day)',
  'toStartOfMonth(posted_date_day)',
  'toStartOfQuarter(posted_date_day)',
  'toStartOfYear(posted_date_day)',
];

function baseVars(periodExpr: string): Record<string, string | number> {
  return {
    database: 'staging',
    company_id: 103,
    report_months_array: 'CAST([] AS Array(String))',
    marketplaces_array: "['Amazon.com']",
    start_date: "toDate('2026-06-01')",
    end_date: "toDate('2026-06-30')",
    consolidation_currency: 'CAST(NULL AS Nullable(String))',
    summary_classes_array: 'CAST([] AS Array(String))',
    summary_subclasses_array: 'CAST([] AS Array(String))',
    period_expr: periodExpr,
    limit_top_n: 200,
    sort_column: 'class_order',
    sort_direction: 'ASC',
  };
}

test('query.sql threads posted_date_day forward and buckets it into period', () => {
  // posted_date_day must survive the CTE chain so the period bucket can reference it.
  assert.match(sql, /priced_lines[\s\S]*?l\.posted_date_day/);
  assert.match(sql, /resolved[\s\S]*?l\.posted_date_day\s+AS\s+posted_date_day/);
  // period is computed via the template expr, grouped, and selected out.
  assert.match(sql, /\{\{period_expr\}\}\s+AS\s+period/);
  assert.match(sql, /GROUP BY summary_class, summary_subclass, currency, period/);
  assert.match(sql, /SELECT\s+f\.period,/);
  assert.match(sql, /ORDER BY period ASC/);
});

test('register.ts exposes periodicity and the full ClickHouse bucket set', () => {
  assert.match(register, /const PERIODICITIES = \['none', 'day', 'week', 'month', 'quarter', 'year'\]/);
  assert.match(register, /period_expr: periodExpr/);
  for (const expr of PERIOD_EXPRS) {
    assert.ok(register.includes(expr), `register.ts should map a periodicity to ${expr}`);
  }
});

test('query.sql renders with no missing template variables for every periodicity', () => {
  for (const expr of PERIOD_EXPRS) {
    const rendered = renderSqlTemplate(sql, baseVars(expr));
    assert.doesNotMatch(rendered, /\{\{.*?\}\}/, `unresolved token for ${expr}`);
    // The template pads whitespace between the expr and `AS period`.
    const injected = new RegExp(`${expr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+AS period`);
    assert.match(rendered, injected, `period expr not injected for ${expr}`);
  }
});
