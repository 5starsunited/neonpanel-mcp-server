import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { ToolRegistry } from '../src/tools/types';

test('tools/list entries do not include non-standard auth fields', () => {
  const registry = new ToolRegistry();

  registry.register({
    name: 'test.echo',
    description: 'Echo input',
    isConsequential: false,
    inputSchema: z.object({ message: z.string() }),
    outputSchema: { type: 'object', additionalProperties: true },
    execute: async (args) => args,
  });

  const [entry] = registry.list();
  assert.ok(entry);

  const asAny = entry as any;
  assert.equal(asAny.auth, undefined);
  assert.equal(asAny.securitySchemes, undefined);

  assert.equal(entry._meta?.['openai/visibility'], 'public');
  assert.deepEqual(entry._meta?.securitySchemes, [{ type: 'oauth2', scopes: ['neonpanel.mcp'] }]);
});
