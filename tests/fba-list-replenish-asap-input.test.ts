import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fbaListReplenishAsapInputSchema } from '../src/tools/athena_tools/tools/fba_list_replenish_asap/register';

test('fba_list_replenish_asap: accepts flat input', () => {
  const parsed = fbaListReplenishAsapInputSchema.parse({
    planning_base: 'actively_sold_only',
    company_id: 106,
    marketplaces: ['US'],
    time_window: { lookahead_days: 14 },
    limit: 50,
  });

  assert.equal(parsed.planning_base, 'actively_sold_only');
  assert.equal(parsed.company_id, 106);
  assert.deepEqual(parsed.marketplaces, ['US']);
  assert.equal(parsed.limit, 50);
});

test('fba_list_replenish_asap: rejects nested sku_selector', () => {
  assert.throws(() =>
    fbaListReplenishAsapInputSchema.parse({
      planning_base: 'actively_sold_only',
      // @ts-expect-error legacy shape is intentionally rejected
      sku_selector: { planning_base: 'actively_sold_only' },
    }),
  );
});

test('fba_list_replenish_asap: rejects unknown keys (strict)', () => {
  assert.throws(() =>
    fbaListReplenishAsapInputSchema.parse({
      planning_base: 'actively_sold_only',
      // @ts-expect-error unknown key
      foo: 'bar',
    }),
  );
});

test('fba_list_replenish_asap: requires planning_base', () => {
  assert.throws(() =>
    fbaListReplenishAsapInputSchema.parse({
      company_id: 106,
    }),
  );
});
