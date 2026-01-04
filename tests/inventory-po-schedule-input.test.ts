import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inventoryPoScheduleInputSchema } from '../src/tools/athena_tools/tools/inventory_po_schedule/register';

test('inventory_po_schedule: accepts flat input', () => {
  const parsed = inventoryPoScheduleInputSchema.parse({
    planning_base: 'actively_sold_only',
    company_id: '106',
    marketplaces: ['US'],
    limit: 100,
  });

  assert.equal(parsed.planning_base, 'actively_sold_only');
  assert.equal(parsed.company_id, 106);
  assert.deepEqual(parsed.marketplaces, ['US']);
  assert.equal(parsed.limit, 100);
});

test('inventory_po_schedule: rejects nested sku_selector', () => {
  assert.throws(() =>
    inventoryPoScheduleInputSchema.parse({
      planning_base: 'actively_sold_only',
      // @ts-expect-error legacy shape is intentionally rejected
      sku_selector: { planning_base: 'actively_sold_only' },
    }),
  );
});

test('inventory_po_schedule: rejects unknown keys (strict)', () => {
  assert.throws(() =>
    inventoryPoScheduleInputSchema.parse({
      planning_base: 'actively_sold_only',
      // @ts-expect-error unknown key
      foo: 'bar',
    }),
  );
});

test('inventory_po_schedule: requires planning_base', () => {
  assert.throws(() =>
    inventoryPoScheduleInputSchema.parse({
      company_id: 106,
    }),
  );
});
