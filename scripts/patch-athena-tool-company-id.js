#!/usr/bin/env node

/*
  Patch generated Athena tool specs to use company_id instead of company_uuid.

  - Searches src/tools/athena_tools/tools/<tool_name>/tool.json
  - Replaces any schema property named company_uuid with company_id
  - Ensures company_id is an integer with minimum 1

  This intentionally does NOT touch tool names or other fields.
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

function patchSchemaObject(schema) {
  if (!schema || typeof schema !== 'object') return false;

  let changed = false;

  if (Array.isArray(schema)) {
    for (const item of schema) {
      changed = patchSchemaObject(item) || changed;
    }
    return changed;
  }

  if (schema.type === 'object' && schema.properties && typeof schema.properties === 'object') {
    if (Object.prototype.hasOwnProperty.call(schema.properties, 'company_uuid')) {
      const existing = schema.properties.company_uuid;
      delete schema.properties.company_uuid;

      schema.properties.company_id = {
        ...(existing && typeof existing === 'object' ? existing : {}),
        type: 'integer',
        minimum: 1,
        description:
          (existing && typeof existing === 'object' && typeof existing.description === 'string'
            ? existing.description
            : 'Optional: restrict to a specific company_id (must be permitted).'),
      };

      changed = true;
    }
  }

  for (const v of Object.values(schema)) {
    changed = patchSchemaObject(v) || changed;
  }

  return changed;
}

function main() {
  if (!fs.existsSync(TOOLS_DIR)) {
    console.error('Tools directory not found:', TOOLS_DIR);
    process.exit(1);
  }

  const files = walk(TOOLS_DIR).filter((p) => p.endsWith(path.sep + 'tool.json'));
  let patched = 0;

  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    const json = JSON.parse(raw);

    const changed =
      patchSchemaObject(json.inputSchema) ||
      patchSchemaObject(json.parameters) ||
      patchSchemaObject(json);

    if (changed) {
      fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
      patched += 1;
    }
  }

  process.stdout.write(`Patched ${patched} tool.json file(s) to use company_id.\n`);
}

main();
