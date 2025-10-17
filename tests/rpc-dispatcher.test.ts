import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RpcDispatcher } from '../src/mcp/rpc/dispatcher';

const dispatcher = RpcDispatcher.fromRecord({
  ping: async () => 'pong',
});

test('returns method not found for unknown method', async () => {
  const response = await dispatcher.handle(
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'unknown',
    },
    {
      token: 'token',
      scopes: [],
      payload: {},
      validatedToken: {
        token: 'token',
        payload: {},
        scopes: [],
      } as any,
    },
  );

  assert.equal(response.jsonrpc, '2.0');
  if ('error' in response) {
    assert.equal(response.error.code, -32601);
  } else {
    assert.fail('expected error response');
  }
});
