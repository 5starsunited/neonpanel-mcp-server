#!/usr/bin/env node

/*
  Generates per-tool folders under src/tools/athena_tools/tools/ from a toolset JSON.

  - Creates <toolName>/tool.json with $refs inlined from common_types.
  - Creates <toolName>/query.sql draft that enumerates output fields (flattened) as selected columns.

  This is intentionally a scaffold: you will replace query.sql with real SQL per tool,
  and implement register.ts tool-by-tool.
*/

const fs = require('node:fs');
const path = require('node:path');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeFileIfMissing(filePath, content) {
  if (fs.existsSync(filePath)) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return true;
}

function deepClone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function inlineCommonRefs(schema, commonTypes) {
  if (!schema || typeof schema !== 'object') return schema;

  if (Array.isArray(schema)) {
    return schema.map((v) => inlineCommonRefs(v, commonTypes));
  }

  if (typeof schema.$ref === 'string') {
    const ref = schema.$ref;
    const m = ref.match(/^#\/common_types\/([a-zA-Z0-9_]+)$/);
    if (m) {
      const key = m[1];
      if (!commonTypes[key]) {
        throw new Error(`Missing common_types reference: ${ref}`);
      }
      return inlineCommonRefs(deepClone(commonTypes[key]), commonTypes);
    }
  }

  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    out[k] = inlineCommonRefs(v, commonTypes);
  }
  return out;
}

function patchCompanyUuidToId(schema) {
  if (!schema || typeof schema !== 'object') return;
  if (Array.isArray(schema)) {
    for (const item of schema) patchCompanyUuidToId(item);
    return;
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
    }
  }

  for (const v of Object.values(schema)) patchCompanyUuidToId(v);
}

function collectOutputFields(schema, prefix = '') {
  // Returns an array of flattened leaf field names, e.g. item_ref.sku, items[].days_to_oos
  const fields = [];
  if (!schema || typeof schema !== 'object') return fields;

  const type = schema.type;
  if (type === 'object' && schema.properties && typeof schema.properties === 'object') {
    for (const [k, v] of Object.entries(schema.properties)) {
      const nextPrefix = prefix ? `${prefix}.${k}` : k;
      fields.push(...collectOutputFields(v, nextPrefix));
    }
    // If an object has no properties but is still an object, treat prefix as a leaf.
    if (Object.keys(schema.properties).length === 0 && prefix) fields.push(prefix);
    return fields;
  }

  if (type === 'array' && schema.items) {
    const nextPrefix = prefix ? `${prefix}[]` : '[]';
    fields.push(...collectOutputFields(schema.items, nextPrefix));
    return fields;
  }

  if (prefix) fields.push(prefix);
  return fields;
}

function flattenToSqlAliases(fieldPaths) {
  // Turn item_ref.sku -> item_ref_sku, items[].days_to_oos -> items_days_to_oos
  return fieldPaths
    .map((p) => p.replace(/\[\]/g, '').replace(/\./g, '_'))
    .filter((p) => p.length > 0);
}

function makeSqlDraft({ toolName, outputSchema, hasLimitParam }) {
  const fieldPaths = collectOutputFields(outputSchema);
  const aliases = flattenToSqlAliases(fieldPaths);
  const uniqueAliases = Array.from(new Set(['company_id', ...aliases]));

  const selectLines = uniqueAliases.map((a) => `  NULL AS ${a}`);
  // company_id should be the real partition key; keep it first if present.
  if (selectLines.length > 0) {
    const idx = uniqueAliases.indexOf('company_id');
    if (idx >= 0) {
      selectLines[idx] = '  company_id';
    }
  }

  const limitVar = hasLimitParam ? '{{limit}}' : '{{topN}}';

  return `-- Tool: ${toolName}\n-- Draft SQL scaffold. Replace NULL columns with real fields/expressions and update FROM/WHERE as needed.\n-- This draft intentionally enumerates all output fields from the tool JSON (flattened).\n-- Note: company_id is a STRING partition column in Athena; filter using quoted string literals.\n\nSELECT\n${selectLines.join(',\n')}\nFROM "{{catalog}}"."{{database}}"."{{table}}"\nWHERE company_id IN ({{companyIdsSql}})\nLIMIT ${limitVar}\n`;
}

function main() {
  const root = path.resolve(__dirname, '..');

  const toolsetPath = process.argv[2] || path.join(
    root,
    'src',
    'tools',
    'athena_tools',
    'toolsets',
    'amazon_supply_chain_toolset_v0.3.1.json',
  );

  const prefix = process.argv[3] || 'amazon_supply_chain';

  const toolset = readJson(toolsetPath);
  const commonTypes = toolset.common_types || {};
  const tools = Array.isArray(toolset.tools) ? toolset.tools : [];

  if (tools.length === 0) {
    console.error('No tools found in toolset JSON.');
    process.exit(1);
  }

  const baseDir = path.join(root, 'src', 'tools', 'athena_tools', 'tools');

  let createdToolJson = 0;
  let createdSql = 0;

  for (const tool of tools) {
    if (!tool || typeof tool !== 'object') continue;
    if (typeof tool.name !== 'string' || tool.name.trim().length === 0) continue;

    const toolName = tool.name.trim();
    const folder = path.join(baseDir, toolName);

    const parameters = inlineCommonRefs(deepClone(tool.parameters || { type: 'object', properties: {}, required: [] }), commonTypes);
    const output = inlineCommonRefs(deepClone(tool.output_schema || { type: 'object', additionalProperties: true }), commonTypes);

    // Partition key convention: company_id (not company_uuid).
    patchCompanyUuidToId(parameters);

    const hasLimitParam = Boolean(parameters && parameters.properties && parameters.properties.limit);

    const toolSpec = {
      name: `${prefix}.${toolName}`,
      description: tool.description || '',
      isConsequential: false,
      inputSchema: parameters,
      outputSchema: output,
      examples: [],
    };

    const toolJsonPath = path.join(folder, 'tool.json');
    const querySqlPath = path.join(folder, 'query.sql');

    if (writeFileIfMissing(toolJsonPath, JSON.stringify(toolSpec, null, 2) + '\n')) {
      createdToolJson += 1;
    }

    const sqlDraft = makeSqlDraft({ toolName, outputSchema: output, hasLimitParam });
    if (writeFileIfMissing(querySqlPath, sqlDraft)) {
      createdSql += 1;
    }
  }

  process.stdout.write(`Generated tool stubs from ${path.basename(toolsetPath)}\n`);
  process.stdout.write(`- New tool.json files: ${createdToolJson}\n`);
  process.stdout.write(`- New query.sql files: ${createdSql}\n`);
}

main();
