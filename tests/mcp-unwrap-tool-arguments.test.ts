import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unwrapToolArguments } from '../src/mcp';

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
