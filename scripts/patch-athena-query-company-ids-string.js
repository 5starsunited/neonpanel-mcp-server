#!/usr/bin/env node

/*
  Patch Athena tool query templates to use string-style company_id filtering.

  - company_id is a STRING partition column in Athena.
  - Replaces {{companyIdsCsv}} with {{companyIdsSql}} in src/tools/athena_tools/tools/<tool>/query.sql
  - Updates WHERE company_id IN (...) placeholder accordingly.
*/

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TOOLS_DIR = path.join(ROOT, 'src', 'tools', 'athena_tools', 'tools');

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(full));
    else if (ent.isFile()) out.push(full);
  }
  return out;
}

function main() {
  if (!fs.existsSync(TOOLS_DIR)) {
    console.error('Tools directory not found:', TOOLS_DIR);
    process.exit(1);
  }

  const files = walk(TOOLS_DIR).filter((p) => p.endsWith(path.sep + 'query.sql'));
  let patched = 0;

  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    let next = raw;

    // Replace placeholder name.
    next = next.replace(/\{\{\s*companyIdsCsv\s*\}\}/g, '{{companyIdsSql}}');

    // Ensure WHERE clause uses the string placeholder (don’t try to be too clever).
    next = next.replace(
      /WHERE\s+company_id\s+IN\s*\(\s*\{\{\s*companyIdsSql\s*\}\}\s*\)/g,
      'WHERE company_id IN ({{companyIdsSql}})',
    );

    if (next !== raw) {
      fs.writeFileSync(file, next);
      patched += 1;
    }
  }

  process.stdout.write(`Patched ${patched} query.sql file(s).\n`);
}

main();
