import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';

test('array query params use [] so PHP parses single items as arrays; stack traces are redacted', async () => {
  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    seen.push(decodeURIComponent(req.url ?? ''));
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'boom', exception: 'TypeError', trace: [{ file: '/app/x.php' }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.NEONPANEL_API_BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const { neonPanelRequest, NeonPanelApiError } = await import('../src/clients/neonpanel-api');
    await assert.rejects(
      neonPanelRequest({
        token: 't',
        path: '/api/v1/revenue-and-cogs',
        query: { grouping: ['company'], company_uuids: ['a', 'b'], periodicity: 'total' },
      }),
      (err: unknown) => {
        assert.ok(err instanceof NeonPanelApiError);
        assert.doesNotMatch(err.message, /trace|x\.php|TypeError/);
        assert.equal(JSON.stringify(err.details).includes('trace'), false);
        return true;
      },
    );
  } finally {
    server.close();
  }
  assert.match(seen[0], /grouping\[\]=company/);
  assert.match(seen[0], /company_uuids\[\]=a&company_uuids\[\]=b/);
  assert.match(seen[0], /periodicity=total/);
});
