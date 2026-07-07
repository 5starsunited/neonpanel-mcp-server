import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getPermittedCompanyIds,
  __setPermissionFetcherForTests,
} from '../src/lib/permitted-companies';

afterEach(() => {
  __setPermissionFetcherForTests(undefined);
});

test('unions ids across permissions and fetches them in parallel', async () => {
  const inFlight: string[] = [];
  let maxConcurrent = 0;
  __setPermissionFetcherForTests(async (_token, permission) => {
    inFlight.push(permission);
    maxConcurrent = Math.max(maxConcurrent, inFlight.length);
    await new Promise((r) => setTimeout(r, 20));
    inFlight.splice(inFlight.indexOf(permission), 1);
    return new Set(permission === 'a' ? [1, 2] : [2, 3]);
  });

  const ids = await getPermittedCompanyIds('token-1', ['a', 'b']);
  assert.deepEqual([...ids].sort(), [1, 2, 3]);
  assert.equal(maxConcurrent, 2, 'permission lookups should overlap, not run serially');
});

test('caches per (token, permission) within the TTL', async () => {
  let calls = 0;
  __setPermissionFetcherForTests(async () => {
    calls += 1;
    return new Set([42]);
  });

  await getPermittedCompanyIds('token-1', ['a', 'b']);
  await getPermittedCompanyIds('token-1', ['a', 'b']);
  assert.equal(calls, 2, 'second call should be served from cache');

  await getPermittedCompanyIds('token-2', ['a']);
  assert.equal(calls, 3, 'different token must not share cache entries');
});

test('a failed lookup grants nothing and is not cached', async () => {
  let calls = 0;
  __setPermissionFetcherForTests(async () => {
    calls += 1;
    if (calls === 1) throw new Error('api down');
    return new Set([7]);
  });

  const first = await getPermittedCompanyIds('token-1', ['a']);
  assert.equal(first.size, 0, 'failure contributes no companies');

  const second = await getPermittedCompanyIds('token-1', ['a']);
  assert.deepEqual([...second], [7], 'failure must not be cached; retry succeeds');
});
