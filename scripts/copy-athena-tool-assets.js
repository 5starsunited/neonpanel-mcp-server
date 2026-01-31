#!/usr/bin/env node

/*
  Copies Athena tool assets (tool.json + query.sql) from src/ into dist/ so they are available
  at runtime in the container.

  Source: src/tools/athena_tools/tools/<tool_name>/(tool.json|query.sql)
  Dest:   dist/tools/athena_tools/tools/<tool_name>/(tool.json|query.sql)
*/

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'tools', 'athena_tools', 'tools');
const DST = path.join(ROOT, 'dist', 'tools', 'athena_tools', 'tools');

async function main() {
  if (!fs.existsSync(SRC)) {
    // Nothing to copy (ok for repos that don't have Athena tools yet)
    return;
  }

  const files = await walk(SRC);
  const assets = files.filter((p) => p.endsWith('tool.json') || p.endsWith('.sql') || p.endsWith('.py'));

  let copied = 0;
  for (const srcFile of assets) {
    const rel = path.relative(SRC, srcFile);
    const dstFile = path.join(DST, rel);
    await fsp.mkdir(path.dirname(dstFile), { recursive: true });
    await fsp.copyFile(srcFile, dstFile);
    copied += 1;
  }

  if (copied > 0) {
    process.stdout.write(`Copied ${copied} Athena tool asset(s) to dist.\n`);
  }
}

async function walk(dir) {
  const out = [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (ent.isFile()) {
      out.push(full);
    }
  }
  return out;
}

main().catch((err) => {
  console.error('Failed to copy Athena tool assets:', err);
  process.exit(1);
});
