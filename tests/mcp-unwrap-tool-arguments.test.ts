import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeToolCallArguments, unwrapToolArguments } from '../src/mcp';

test('unwrapToolArguments unwraps a single params wrapper', () => {
  const input = {
    params: {
      planning_base: 'actively_sold_only',
      company_id: 106,
      marketplaces: ['US'],
      limit: 100,
    },
  };

  const unwrapped = unwrapToolArguments(input) as any;
  assert.equal(unwrapped.planning_base, 'actively_sold_only');
  assert.equal(unwrapped.company_id, 106);
  assert.deepEqual(unwrapped.marketplaces, ['US']);
  assert.equal(unwrapped.limit, 100);
});

test('unwrapToolArguments unwraps nested params wrappers (bounded)', () => {
  const input = { params: { params: { a: 1 } } };
  const unwrapped = unwrapToolArguments(input) as any;
  assert.deepEqual(unwrapped, { a: 1 });
});

test('unwrapToolArguments leaves normal objects unchanged', () => {
  const input = { planning_base: 'actively_sold_only' };
  const unwrapped = unwrapToolArguments(input);
  assert.deepEqual(unwrapped, input);
});

test('unwrapToolArguments parses JSON-stringified arguments', () => {
  const input = '{"planning_base":"actively_sold_only","company_id":106,"marketplaces":["US"],"limit":100}';
  const unwrapped = unwrapToolArguments(input);
  assert.deepEqual(unwrapped, {
    planning_base: 'actively_sold_only',
    company_id: 106,
    marketplaces: ['US'],
    limit: 100,
  });
});

test('normalizeToolCallArguments wraps flattened query fields from input schema', () => {
  const inputSchema = {
    type: 'object',
    properties: {
      query: {
        type: 'object',
        properties: {
          filters: { type: 'object' },
          time: { type: 'object' },
          periodicity: { type: 'string' },
          group_by_company: { type: 'integer' },
        },
      },
      debug_sql: { type: 'boolean' },
    },
  };

  const normalized = normalizeToolCallArguments(
    {
      filters: { company_id: 230 },
      time: { start_date: '2026-02-01', end_date: '2026-04-30' },
      periodicity: 'month',
      group_by_company: 1,
      debug_sql: true,
    },
    inputSchema,
  ) as any;

  assert.deepEqual(normalized, {
    query: {
      filters: { company_id: 230 },
      time: { start_date: '2026-02-01', end_date: '2026-04-30' },
      periodicity: 'month',
      group_by_company: 1,
    },
    debug_sql: true,
  });
});
