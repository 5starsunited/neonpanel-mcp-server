# Athena Tool Development Guide

## Overview

This guide covers the essential patterns and requirements for creating new Athena tools in the NeonPanel MCP server. **Following these patterns is critical** - deviations can cause ALL tools to fail loading.

## Critical Registration Pattern

### ✅ CORRECT Pattern (MUST FOLLOW)

```typescript
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { ToolExecutionContext, ToolRegistry, ToolSpecJson } from '../../../../../types';
// ... other imports

// Define Zod input schema
const inputSchema = z.object({
  query: z.object({
    filters: z.object({
      company_id: z.array(z.number().int().min(1)).min(1),
      // ... other filters
    }).required({ company_id: true }),
    // ... other query properties
  }),
});

type InputType = z.infer<typeof inputSchema>;

// Main execution function
async function executeYourTool(params: InputType, context: ToolExecutionContext) {
  // 1. Permission check via NeonPanel API
  // 2. Load SQL template
  // 3. Build dynamic SQL clauses
  // 4. Execute Athena query
  // 5. Return formatted results
}

// Registration function - CRITICAL PATTERN
export function registerYourTool(registry: ToolRegistry): void {
  const toolJsonPath = path.join(__dirname, 'tool.json');
  
  // Load tool.json with error handling
  let specJson: ToolSpecJson | undefined;
  try {
    if (fs.existsSync(toolJsonPath)) {
      specJson = JSON.parse(fs.readFileSync(toolJsonPath, 'utf-8')) as ToolSpecJson;
    }
  } catch {
    specJson = undefined;
  }

  // Register with ALL required properties
  registry.register({
    name: specJson?.name ?? 'your_tool_name',
    description: specJson?.description ?? 'Fallback description',
    inputSchema,  // ✅ Use Zod schema directly for type safety
    outputSchema: specJson?.outputSchema ?? {
      type: 'object',
      properties: {
        items: { type: 'array', items: { type: 'object', additionalProperties: true } },
        meta: { type: 'object', additionalProperties: true },
      },
      required: ['items'],
    },
    isConsequential: specJson?.isConsequential ?? false,
    specJson,  // ✅ CRITICAL - Must include this property
    execute: async (rawInput: unknown, context: ToolExecutionContext) => {
      const parsed = inputSchema.parse(rawInput);
      return executeYourTool(parsed, context);
    },
  });
}
```

### ❌ COMMON MISTAKES THAT BREAK ALL TOOLS

#### 1. Missing `specJson` Property
```typescript
// ❌ WRONG - Will break ALL tools
registry.register({
  name: toolSpec.name,
  description: toolSpec.description,
  inputSchema,
  outputSchema: { /* ... */ },
  // Missing: specJson property ❌
  execute: async (rawInput, context) => { /* ... */ },
});
```

**Impact**: Tool registration fails silently, breaking the entire tool registry. Server starts but returns 0 tools.

#### 2. Using `require('fs')` Inline
```typescript
// ❌ WRONG - Inconsistent with other tools
const toolSpec: ToolSpecJson = JSON.parse(require('fs').readFileSync(...));
```

**Should be**: Import `fs` at the top of the file with proper error handling.

#### 3. Using `specJson.inputSchema` Instead of Zod Schema
```typescript
// ❌ WRONG - Breaks type safety
registry.register({
  inputSchema: specJson?.inputSchema ?? inputSchema,  // Type error
  // ...
});
```

**Should be**: Always use the Zod `inputSchema` directly for TypeScript type inference.

## File Structure Requirements

```
tools/category/subcategory/tool_name/
├── tool.json          # MCP tool specification (required)
├── query.sql          # Athena SQL template (required)
├── register.ts        # Registration and execution logic (required)
└── README.md          # Tool documentation (optional)
```

## Tool Registration Checklist

Before committing a new tool, verify:

- [ ] **Import `fs` from 'node:fs'** at the top of register.ts
- [ ] **Define Zod inputSchema** matching tool.json structure
- [ ] **Load tool.json with try/catch** and undefined fallback
- [ ] **Include `specJson` property** in registry.register() call
- [ ] **Use Zod inputSchema** (not specJson.inputSchema)
- [ ] **Export registration function** matching pattern: `registerCategoryToolNameTool`
- [ ] **Add import and call** in `src/tools/athena_tools/index.ts`
- [ ] **Test build**: `npm run build` (must succeed with 0 errors)
- [ ] **Test registration**: Use node test command to verify tool appears in list

## Testing Tool Registration

```bash
# Build the project
npm run build

# Test tool registration (should show all 12+ tools)
node -e "const reg = require('./dist/tools/athena_tools/index.js'); \
const tools = []; \
const mockReg = {register: (t) => tools.push(t.name || 'unnamed')}; \
reg.registerAthenaTools(mockReg); \
console.log('✅ Registered', tools.length, 'tools'); \
console.log(tools.join(', '))"
```

**Expected output**: Should list all tools including your new one.

## Common Patterns

### Permission Checking

All tools should check NeonPanel API permissions:

```typescript
const permission = 'view:quicksight_group.business_planning_new';
const permissionResponse = await neonPanelRequest<CompaniesWithPermissionResponse>({
  token: context.userToken,
  path: `/api/v1/permissions/${encodeURIComponent(permission)}/companies`,
});

const permittedCompanies = (permissionResponse.companies ?? []).filter(
  (c): c is { company_id?: number; companyId?: number; id?: number } => 
    c !== null && typeof c === 'object',
);

const permittedCompanyIds = permittedCompanies
  .map((c) => c.company_id ?? c.companyId ?? c.id)
  .filter((id): id is number => typeof id === 'number' && Number.isFinite(id) && id > 0);
```

### Dynamic SQL Generation

Use template variables for dynamic clauses:

```typescript
const query = renderSqlTemplate(template, {
  company_ids_array: sqlBigintArrayExpr(allowedCompanyIds),
  filter_param: sqlVarcharArrayExpr(filters.someField ?? []),
  group_by_clause: groupByFields.map(f => dimensionMap[f]).join(', '),
  order_by_clause: `ORDER BY ${sortField} ${sortDirection}`,
  limit_rows: limit.toString(),
});
```

### Array Filter Helpers

```typescript
function sqlStringLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function sqlVarcharArrayExpr(values: string[]): string {
  if (values.length === 0) return 'ARRAY[]';
  return `ARRAY[${values.map(sqlStringLiteral).join(', ')}]`;
}

function sqlBigintArrayExpr(values: number[]): string {
  if (values.length === 0) return 'ARRAY[]';
  return `ARRAY[${values.map(String).join(', ')}]`;
}
```

## Query Envelope Pattern

All Athena tools should return results in the standard envelope format:

```typescript
return {
  items: resultRows,
  meta: {
    query: {
      company_ids: allowedCompanyIds,
      dimensions: filters,
      // ... other query parameters
    },
    aggregation: {
      group_by: groupBy,
      // ... aggregation settings
    },
    row_count: resultRows.length,
    limit,
  },
};
```

## Deployment Process

1. **Develop locally** with proper patterns
2. **Test build**: `npm run build` (0 errors required)
3. **Test registration**: Verify tool appears in list
4. **Commit to feature branch**
5. **Deploy to DEV**: `npx cdk deploy NeonpanelMcpStackV3 --profile app-dev-administrator`
6. **Test in DEV** via MCP interface
7. **Merge to main** when verified
8. **Deploy to PROD**: `npx cdk deploy NeonpanelMcpStackV3 --profile app-prod-administrator`

## Known Issues & Solutions

### Issue: Tools List Returns Empty (0 tools)

**Symptoms**: 
- MCP server health check passes (200 OK)
- `/v1/tools` returns empty items array
- No error in logs

**Root Causes**:
1. Missing `specJson` property in registry.register()
2. Malformed tool.json (invalid JSON)
3. Exception thrown during registration that's silently caught

**Solution**:
1. Follow the exact registration pattern above
2. Validate tool.json with JSON linter
3. Test registration with node command before deployment

### Issue: TypeScript Build Errors

**Common Type Errors**:
- `Type 'Record<string, unknown>' is not assignable to type 'ZodTypeAny'`
  - **Fix**: Use Zod inputSchema directly, not specJson.inputSchema

- `Cannot read properties of undefined (reading 'name')`
  - **Fix**: Add specJson property to registry.register() call

## Reference Examples

Good examples to follow:
- `src/tools/athena_tools/tools/forecasting/list_latest_sales_forecast/register.ts`
- `src/tools/athena_tools/tools/supply_chain/list_fba_replenishment_candidates/register.ts`
- `src/tools/athena_tools/tools/brand_analytics/cogs/analyze_fifo_cogs/register.ts` (after fix)

## Questions?

If you encounter registration issues:
1. Compare your code to reference examples above
2. Run the registration test command
3. Check that ALL required properties are present
4. Verify fs import and error handling matches pattern

Remember: **One malformed tool can break the entire registry**. Follow these patterns exactly.
