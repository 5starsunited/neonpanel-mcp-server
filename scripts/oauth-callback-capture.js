#!/usr/bin/env node

/**
 * Minimal OAuth redirect capture server.
 *
 * Why: Some OAuth flows redirect too fast to copy `?code=...` from the URL bar.
 * This server captures the full request URL and prints it, shows it in the browser,
 * and writes it to .tmp/oauth-last-redirect.txt.
 *
 * Usage:
 *   node scripts/oauth-callback-capture.js
 *   PORT=8888 node scripts/oauth-callback-capture.js
 *
 * Then set your OAuth redirect_uri to:
 *   http://localhost:8888/callback
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const port = Number.parseInt(process.env.PORT || '8888', 10);
const host = process.env.HOST || '127.0.0.1';

const rootDir = path.resolve(__dirname, '..');
const tmpDir = path.join(rootDir, '.tmp');
const outFile = path.join(tmpDir, 'oauth-last-redirect.txt');

function ensureTmpDir() {
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
  } catch {
    // ignore
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`);

  if (url.pathname !== '/callback') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`OK. Waiting for OAuth redirect on /callback\n\nSet redirect_uri to: http://${host}:${port}/callback\n`);
    return;
  }

  const full = url.toString();
  ensureTmpDir();
  try {
    fs.writeFileSync(outFile, full, 'utf8');
  } catch {
    // ignore
  }

  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';

  // Print to terminal for easy copy.
  process.stdout.write(`\n=== OAuth Redirect Captured ===\n${full}\n`);
  if (code) process.stdout.write(`code: ${code}\n`);
  if (state) process.stdout.write(`state: ${state}\n`);
  process.stdout.write(`Saved: ${outFile}\n\n`);

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html>
<html><head><meta charset="utf-8" />
<title>OAuth Redirect Captured</title>
</head>
<body>
  <h2>OAuth Redirect Captured</h2>
  <p><b>Full URL</b></p>
  <pre>${escapeHtml(full)}</pre>
  <p><b>code</b></p>
  <pre>${escapeHtml(code)}</pre>
  <p><b>state</b></p>
  <pre>${escapeHtml(state)}</pre>
  <p>Saved to: <code>${escapeHtml(outFile)}</code></p>
</body></html>`);
});

server.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`OAuth callback capture listening on http://${host}:${port}`);
  console.log(`Waiting for redirect on http://${host}:${port}/callback`);
});
