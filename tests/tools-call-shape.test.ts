import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRpcDispatcher } from '../src/mcp';

function buildContext() {
  return {
    token: 'access-token',
    scopes: ['neonpanel.mcp'],
    subject: 'user-123',
    payload: {},
    validatedToken: {
      token: 'access-token',
      payload: {},
      scopes: ['neonpanel.mcp'],
      subject: 'user-123',
    } as any,
  };
}

test('tools/call returns MCP content wrapper (even on tool not found)', async () => {
  const dispatcher = createRpcDispatcher();

  const response = await dispatcher.handle(
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: '__does_not_exist__',
        arguments: {},
      },
    },
    buildContext(),
  );

  assert.equal(response.jsonrpc, '2.0');
  if ('error' in response) {
    assert.fail('expected tools/call to return success result with isError, not JSON-RPC error');
  }

  const result = response.result as any;
  assert.ok(result);
  assert.ok(Array.isArray(result.content));
  assert.ok(result.content.length >= 1);
  assert.equal(result.isError, true);

  const first = result.content[0];
  assert.equal(first.type, 'text');
  assert.equal(typeof first.text, 'string');
  assert.ok(first.text.length > 0);
});
