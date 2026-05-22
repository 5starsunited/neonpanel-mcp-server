# Brand Analytics Tools: Error Capture & Schema Validation Fix Plan

**Created:** 2026-05-22 | **Scope:** 30 brand analytics tools | **Severity:** Medium-High (debugging pain, unclear errors)

---

## Executive Summary

**Problem:** Brand analytics tools lack proper error context (request IDs, HTTP status, query IDs) and provide unclear validation messages.

**Impact:** 
- Users can't trace failures to logs
- Ambiguous errors (empty results = no data OR no permissions?)
- Missing correlation with Athena console
- No performance diagnostics

**Effort:** ~4-6 hours | **Risk:** Low (additive, backward compatible)

---

## 1. Current State Analysis

### 1.1 Existing Issues (from exploration)

| Issue | Current Behavior | Gap |
|-------|------------------|-----|
| **Request ID** | Not present in response | Can't trace to logs |
| **HTTP Status** | Tool returns object, no HTTP status hint | Client guesses 500 vs 400 |
| **Query ID** | Athena QueryExecutionId in logs, not response | Can't search Athena console |
| **Validation Errors** | ZodError format (technical) | Unclear why it failed |
| **Permission Denial** | Returns `items: []` | Indistinguishable from no data |
| **Query Timing** | Not captured | Can't diagnose slow queries |
| **group_by Accepted Values** | Error doesn't list valid options | Users must read docs |

### 1.2 Specific Example: `group_by` Validation Failure

**Current behavior:**
- User requests: `group_by: ["primary_intent_id"]`
- Tool has enum: `intent, search_term, marketplace, company, brand, product_family, category, asin`
- Error returned: ZodError (technical, unformatted)
- **Missing:** List of valid values, suggestion of closest match

**Root cause:**
- No explicit error message customization
- Validation error thrown directly to user

---

## 2. Root Causes

### 2.1 Architecture Gaps
1. **No RequestContext** — Each tool invocation starts fresh, no correlation ID
2. **No Structured Error Class** — Raw ZodError bubbles up
3. **No Schema Annotation** — Validation errors don't include enum values
4. **No Permission Layer** — Athena SQL succeeds with no rows = ambiguous

### 2.2 Schema Validation Gaps
1. **group_by enum** — Hardcoded in Zod, not documented in error message
2. **Constraint descriptions** — `min(1)` error says "Must be at least 1 item", not "Required and non-empty"
3. **Aggregation conflicts** — No validation that `group_by` + `time.periods_back` is compatible

### 2.3 Error Reporting Gaps
1. **No request_id field** — Tools return error object, no unique ID for tracing
2. **No queryExecutionId** — Athena query ID not exposed to client
3. **No HTTP status hint** — Client can't determine if 400 (bad input) or 500 (server error)
4. **No error code** — All errors treated equally

---

## 3. Proposed Solution

### 3.1 Unified Error Response Format

**New standard response structure:**
```typescript
{
  error: string;                    // Human-readable message
  error_code: string;               // Machine-readable code (VALIDATION_ERROR, PERMISSION_DENIED, QUERY_FAILED, etc.)
  http_status: number;              // Recommended HTTP status (400, 403, 500, etc.)
  request_id?: string;              // Correlation ID for tracing
  query_execution_id?: string;      // Athena QueryExecutionId (for read tools)
  message?: string;                 // Additional context
  details?: Record<string, any>;    // Field-specific errors or debug info
  timestamp?: string;               // ISO 8601 UTC
}
```

### 3.2 RequestContext Implementation

**Create:** `src/tools/athena_tools/utils/request-context.ts`
```typescript
export class RequestContext {
  static generate(): {
    request_id: string;
    timestamp: string;
  } {
    return {
      request_id: `brand-analytics-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date().toISOString(),
    };
  }
}
```

**Usage:** Inject into every tool invocation to capture request_id + timestamp.

### 3.3 Enhanced Error Class

**Create:** `src/tools/athena_tools/utils/brand-analytics-error.ts`
```typescript
export class BrandAnalyticsError extends Error {
  constructor(
    public error_code: 'VALIDATION_ERROR' | 'PERMISSION_DENIED' | 'QUERY_FAILED' | 'PARSE_ERROR' | 'UNKNOWN',
    public message: string,
    public http_status: number = 500,
    public details?: Record<string, any>,
    public request_id?: string,
    public query_execution_id?: string
  ) {
    super(message);
  }

  toResponse() {
    return {
      error: this.message,
      error_code: this.error_code,
      http_status: this.http_status,
      request_id: this.request_id,
      query_execution_id: this.query_execution_id,
      details: this.details,
      timestamp: new Date().toISOString(),
    };
  }
}
```

### 3.4 Zod Schema Customization

**Pattern:** Add `.superRefine()` to provide custom error messages with valid enum values.

**Example for group_by:**
```typescript
group_by: z.array(
  z.enum(['intent', 'search_term', 'marketplace', 'company', 'brand', 'product_family', 'category', 'asin'])
).max(3).optional()
.superRefine((val, ctx) => {
  if (val && val.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `group_by cannot be empty. Valid options: intent, search_term, marketplace, company, brand, product_family, category, asin (max 3)`,
    });
  }
})
```

### 3.5 Tool-Level Error Handler Wrapper

**Create:** Base error handler for all tools in `src/tools/athena_tools/utils/tool-error-handler.ts`

```typescript
export async function executeWithErrorContext<T>(
  toolName: string,
  handler: (context: RequestContext) => Promise<T>,
  requestContext: RequestContext
): Promise<T | BrandAnalyticsError> {
  try {
    return await handler(requestContext);
  } catch (error) {
    if (error instanceof ZodError) {
      return new BrandAnalyticsError(
        'VALIDATION_ERROR',
        formatZodError(error),  // Custom formatter
        400,
        { validation_errors: error.errors },
        requestContext.request_id
      );
    }
    if (error instanceof BrandAnalyticsError) {
      error.request_id = requestContext.request_id;
      return error;
    }
    return new BrandAnalyticsError(
      'UNKNOWN',
      error instanceof Error ? error.message : 'Unknown error',
      500,
      { original_error: error },
      requestContext.request_id
    );
  }
}

function formatZodError(error: ZodError): string {
  const issues = error.errors.map(e => {
    const path = e.path.join('.');
    return `${path}: ${e.message}`;
  }).join('; ');
  return `Validation failed: ${issues}`;
}
```

### 3.6 Athena Query ID Exposure

**Modification:** Update all read tools to capture and return `queryExecutionId`.

**Pattern:**
```typescript
// In tool execution
const startTime = Date.now();
const queryResult = await executeAthenaQuery(sql);
const duration = Date.now() - startTime;

return {
  items: parseResults(queryResult.rows),
  _metadata: {
    query_execution_id: queryResult.queryExecutionId,
    query_duration_ms: duration,
    request_id: requestContext.request_id,
  }
};
```

---

## 4. Implementation Roadmap

### Phase 1: Foundation (1-2 hours)
- [ ] Create `request-context.ts` utility
- [ ] Create `brand-analytics-error.ts` class
- [ ] Create `tool-error-handler.ts` wrapper
- [ ] Update Zod schema for 3-5 key tools (test the pattern)

### Phase 2: Rollout (2-3 hours)
- [ ] Apply error context to all 30 tools
- [ ] Update all Zod schemas with `.superRefine()` enhancements
- [ ] Update all read tools to capture `queryExecutionId`
- [ ] Update all write tools with enhanced error responses

### Phase 3: Testing & Documentation (1 hour)
- [ ] Test error responses match template
- [ ] Update API documentation
- [ ] Add request_id/error_code examples to README
- [ ] Test the `group_by` validation with invalid input

---

## 5. Validation: Example Fixes

### 5.1 Example 1: `group_by` Validation Error

**Before:**
```json
{
  "message": "Invalid enum value",
  "errors": [{ "code": "invalid_enum_value", "path": ["aggregation", "group_by", 0], "message": "Invalid enum value..." }]
}
```

**After:**
```json
{
  "error": "Invalid aggregation parameter",
  "error_code": "VALIDATION_ERROR",
  "http_status": 400,
  "request_id": "brand-analytics-1716389716000-abc123def",
  "message": "group_by value 'primary_intent_id' is not recognized. Valid options: intent, search_term, marketplace, company, brand, product_family, category, asin (max 3 dimensions)",
  "details": {
    "field": "aggregation.group_by[0]",
    "provided": "primary_intent_id",
    "valid_values": ["intent", "search_term", "marketplace", "company", "brand", "product_family", "category", "asin"]
  },
  "timestamp": "2026-05-22T06:55:16.189Z"
}
```

### 5.2 Example 2: Athena Query Failure

**Before:**
```json
{
  "error": "Query failed",
  "state": "FAILED",
  "stateChangeReason": "INTERNAL_ERROR"
}
```

**After:**
```json
{
  "error": "Athena query failed",
  "error_code": "QUERY_FAILED",
  "http_status": 500,
  "request_id": "brand-analytics-1716389716000-xyz789",
  "query_execution_id": "abc12345-6789-abcd-ef01-23456789abcd",
  "message": "Database query execution failed during aggregation",
  "details": {
    "state": "FAILED",
    "reason": "INTERNAL_ERROR",
    "query_duration_ms": 2345
  },
  "timestamp": "2026-05-22T06:55:16.189Z"
}
```

### 5.3 Example 3: Permission Denied (Explicit)

**Before:**
```json
{
  "items": []
}
```

**After:**
```json
{
  "error": "Access denied",
  "error_code": "PERMISSION_DENIED",
  "http_status": 403,
  "request_id": "brand-analytics-1716389716000-perm456",
  "message": "You do not have permission to access data for company_ids: [92] in marketplace: US",
  "details": {
    "denied_companies": [92],
    "reason": "Permission boundary restricts access to company_ids in [1, 2, 3, 4, 5]"
  },
  "timestamp": "2026-05-22T06:55:16.189Z"
}
```

---

## 6. Files to Create/Modify

### Create (New)
1. `src/tools/athena_tools/utils/request-context.ts` (50 lines)
2. `src/tools/athena_tools/utils/brand-analytics-error.ts` (60 lines)
3. `src/tools/athena_tools/utils/tool-error-handler.ts` (80 lines)
4. `src/tools/athena_tools/utils/zod-helpers.ts` (100 lines) — Reusable schema enhancements

### Modify (Existing)
1. **30 tool files** — Add RequestContext injection + error wrapping
2. **30 schema files** — Add `.superRefine()` customizations for validation messages
3. `src/tools/athena_tools/tools/brand_analytics/*/register.ts` (all tools) — Pass request context through

---

## 7. Success Criteria

✅ **Error Template Compliance:**
- All error responses include: error, error_code, http_status, request_id, message, details, timestamp
- request_id is unique per invocation (traceable to logs)
- http_status correctly indicates 400 (validation), 403 (permission), 500 (server), etc.

✅ **Validation Clarity:**
- Invalid enum values list all valid options in error message
- Field-level errors include path and constraint that failed
- Helpful suggestions (e.g., "Did you mean 'intent'?" for typos)

✅ **Athena Integration:**
- Read tools expose queryExecutionId in response
- Query duration (ms) captured and included in _metadata
- Queryable: user can search Athena console with provided ID

✅ **Backward Compatibility:**
- Success responses unchanged (items still at top level)
- Only error responses modified
- Existing clients still work with new responses

---

## 8. Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Breaking existing clients | Add error responses as optional fields; success path unchanged |
| Rollout scope (30 tools) | Implement 3-5 key tools first, validate pattern, then templated rollout |
| Zod version compatibility | Use `.superRefine()` (available since v3.x, current in package.json) |
| Performance (request_id generation) | UUID generation is <1ms; negligible impact |

---

## Next Steps

1. **Confirm approach** — Does this plan align with your debugging/tracing needs?
2. **Prioritize tools** — Which tools should be fixed first (e.g., `keyword_funnel_metrics`)?
3. **Permission layer** — How should permission denial be detected (SQL empty result vs. explicit permission check)?
4. **Begin Phase 1** — Create utilities and test on 1-2 tools.

