import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Response } from 'undici';
import { OpenApiService } from '../src/lib/openapi-service';

const validDocument = {
  openapi: '3.1.0',
  info: { title: 'Test', version: '1.0.0' },
  paths: {
    '/companies': {
      get: { responses: { '200': { description: 'OK' } } },
    },
  },
};

test('OpenApiService fetches from remote and persists to disk', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'openapi-service-'));
  const localPath = path.join(dir, 'openapi.json');

  const service = new OpenApiService(
    'https://example.com/openapi.json',
    localPath,
    1000,
    async () =>
      new Response(JSON.stringify(validDocument), {
        status: 200,
        headers: { etag: 'W/"123"' },
      }),
  );

  const document = (await service.getDocument(true)) as { openapi: string };
  assert.equal(document.openapi, '3.1.0');

  const cached = JSON.parse(await readFile(localPath, 'utf8'));
  assert.equal(cached.openapi, '3.1.0');

  await rm(dir, { recursive: true, force: true });
});

test('OpenApiService falls back to disk cache when remote fetch fails', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'openapi-service-'));
  const localPath = path.join(dir, 'openapi.json');
  await writeFile(localPath, JSON.stringify(validDocument), 'utf8');

  const service = new OpenApiService(
    'https://example.com/openapi.json',
    localPath,
    1000,
    async () => {
      throw new Error('network failure');
    },
  );

  const document = (await service.getDocument()) as { openapi: string };
  assert.equal(document.openapi, '3.1.0');

  await rm(dir, { recursive: true, force: true });
});

test('OpenApiService parses consolidated YAML and reports document metadata', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'openapi-service-'));
  const localPath = path.join(dir, 'openapi.json');
  const service = new OpenApiService(
    'https://example.com/api/v1/openapi',
    localPath,
    1000,
    async () =>
      new Response(
        'openapi: 3.1.0\ninfo:\n  title: Test\n  version: 1.0.0\npaths:\n  /companies:\n    get:\n      responses:\n        "200":\n          description: OK\n',
        { status: 200, headers: { 'content-type': 'application/yaml' } },
      ),
  );

  const result = await service.refreshFromRemote();
  const status = await service.getStatus();

  assert.deepEqual(result, { outcome: 'updated' });
  assert.equal(status.remoteUrl, 'https://example.com/api/v1/openapi');
  assert.deepEqual(status.document && { openapiVersion: status.document.openapiVersion, pathCount: status.document.pathCount }, {
    openapiVersion: '3.1.0',
    pathCount: 1,
  });

  await rm(dir, { recursive: true, force: true });
});

test('OpenApiService rejects invalid remote payloads without replacing a valid cache', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'openapi-service-'));
  const localPath = path.join(dir, 'openapi.json');
  let calls = 0;
  const service = new OpenApiService(
    'https://example.com/api/v1/openapi',
    localPath,
    1000,
    async () => {
      calls += 1;
      return calls === 1
        ? new Response(JSON.stringify(validDocument), { status: 200 })
        : new Response('<html>upstream error</html>', { status: 200, headers: { 'content-type': 'text/html' } });
    },
  );

  await service.refreshFromRemote();
  const result = await service.refreshFromRemote();
  const document = (await service.getDocument()) as { info: { title: string } };

  assert.equal(result.outcome, 'fallback');
  assert.equal(document.info.title, 'Test');
  assert.deepEqual(JSON.parse(await readFile(localPath, 'utf8')), validDocument);

  await rm(dir, { recursive: true, force: true });
});

test('OpenApiService retains a valid cache when the remote returns 304', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'openapi-service-'));
  const localPath = path.join(dir, 'openapi.json');
  let calls = 0;
  const service = new OpenApiService(
    'https://example.com/api/v1/openapi',
    localPath,
    1000,
    async () => {
      calls += 1;
      return calls === 1
        ? new Response(JSON.stringify(validDocument), { status: 200, headers: { etag: 'W/"test"' } })
        : new Response(null, { status: 304 });
    },
  );

  await service.refreshFromRemote();
  const result = await service.refreshFromRemote();
  const document = (await service.getDocument()) as { paths: Record<string, unknown> };

  assert.deepEqual(result, { outcome: 'not-modified' });
  assert.ok(document.paths['/companies']);

  await rm(dir, { recursive: true, force: true });
});
