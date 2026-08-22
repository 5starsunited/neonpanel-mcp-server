import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { ToolRegistry } from '../src/tools/types';

const CONNECTOR_TOOL_PREFIX = 'mcp_neonpanel_';
const MAX_CONNECTOR_TOOL_NAME_LENGTH = 64;

test('reconciliation list tool fits the connector name limit', () => {
  const toolName = 'financials_list_transaction_reconciliations';
  assert.ok(`${CONNECTOR_TOOL_PREFIX}${toolName}`.length <= MAX_CONNECTOR_TOOL_NAME_LENGTH);
});

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
