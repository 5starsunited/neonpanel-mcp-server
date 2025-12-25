import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePeriod } from '../src/lib/period/resolve-period';
import { AppError } from '../src/lib/errors';

test('resolvePeriod defaults to this_week (Monday start) in UTC', () => {
  const now = new Date(Date.UTC(2025, 11, 25, 12, 0, 0)); // 2025-12-25
  const resolved = resolvePeriod({ now });
  assert.deepEqual(resolved, {
    startDate: '2025-12-22',
    endDate: '2025-12-28',
    source: 'period',
  });
});

test('resolvePeriod preset this_month in UTC', () => {
  const now = new Date(Date.UTC(2025, 11, 25, 12, 0, 0));
  const resolved = resolvePeriod({ now, period: { kind: 'preset', preset: 'this_month' } });
  assert.deepEqual(resolved, {
    startDate: '2025-12-01',
    endDate: '2025-12-31',
    source: 'period',
  });
});

test('resolvePeriod relative next 2 weeks is an inclusive window from today', () => {
  const now = new Date(Date.UTC(2025, 11, 25, 12, 0, 0));
  const resolved = resolvePeriod({
    now,
    period: { kind: 'relative', direction: 'next', unit: 'week', count: 2 },
  });
  assert.deepEqual(resolved, {
    startDate: '2025-12-25',
    endDate: '2026-01-07',
    source: 'period',
  });
});

test('resolvePeriod accepts explicit startDate/endDate', () => {
  const resolved = resolvePeriod({ startDate: '2025-01-01', endDate: '2025-01-31' });
  assert.deepEqual(resolved, {
    startDate: '2025-01-01',
    endDate: '2025-01-31',
    source: 'explicit',
  });
});

test('resolvePeriod rejects mixing explicit dates with period', () => {
  const now = new Date(Date.UTC(2025, 11, 25, 12, 0, 0));
  assert.throws(
    () => resolvePeriod({ now, startDate: '2025-01-01', endDate: '2025-01-02', period: { kind: 'preset', preset: 'this_week' } }),
    (err) => err instanceof AppError && err.code === 'invalid_period',
  );
});
