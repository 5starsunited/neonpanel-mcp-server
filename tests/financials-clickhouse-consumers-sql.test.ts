import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { renderSqlTemplate } from '../src/tools/athena_tools/runtime/render-sql';

const financialsRoot = path.join(
  process.cwd(),
  'src/tools/athena_tools/tools/financials',
);

const cases = [
  {
    tool: 'list_financial_transaction_class_map',
    vars: {
      search: 'CAST(NULL AS Nullable(String))',
      summary_classes_array: 'CAST([] AS Array(String))',
      limit_top_n: 500,
    },
  },
  {
    tool: 'list_financial_transaction_services',
    vars: {
      company_id: 106,
      report_months_array: "['2026-08']",
      search: 'CAST(NULL AS Nullable(String))',
      only_unclassified: 'FALSE',
      limit_top_n: 200,
    },
  },
  {
    tool: 'list_financial_transaction_transfers',
    vars: {
      company_id: 106,
      report_months_array: "['2026-08']",
      marketplaces_array: "['US','Amazon.com','ATVPDKIKX0DER']",
      directions_array: 'CAST([] AS Array(String))',
      start_date: "toDate('2026-08-01')",
      end_date: "toDate('2026-08-31')",
      sort_direction: 'DESC',
      limit_top_n: 100,
    },
  },
] as const;

test('financial transaction consumers render with ClickHouse sources only', () => {
  for (const { tool, vars } of cases) {
    const sql = fs.readFileSync(path.join(financialsRoot, tool, 'query.sql'), 'utf8');
    const rendered = renderSqlTemplate(sql, vars);

    assert.doesNotMatch(rendered, /\{\{.*?\}\}/, `${tool} has an unresolved token`);
    assert.doesNotMatch(rendered, /neonpanel_iceberg|financial_transaction_lines_v1\"/i);
    assert.match(rendered, /staging\.financial_transaction_class_map/);
    if (tool !== 'list_financial_transaction_class_map') {
      assert.match(rendered, /analytics\.financial_transaction_lines_v1_current/);
    }
  }
});
