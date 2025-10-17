import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Response } from 'undici';
import { OpenApiService } from '../src/lib/openapi-service';

test('OpenApiService fetches from remote and persists to disk', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'openapi-service-'));
  const localPath = path.join(dir, 'openapi.json');

  const service = new OpenApiService(
    'https://example.com/openapi.json',
    localPath,
    1000,
    async () =>
      new Response(JSON.stringify({ openapi: '3.1.0', info: { title: 'Test' } }), {
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
  await writeFile(localPath, JSON.stringify({ openapi: '3.0.0' }), 'utf8');

  const service = new OpenApiService(
    'https://example.com/openapi.json',
    localPath,
    1000,
    async () => {
      throw new Error('network failure');
    },
  );

  const document = (await service.getDocument()) as { openapi: string };
  assert.equal(document.openapi, '3.0.0');

  await rm(dir, { recursive: true, force: true });
});
