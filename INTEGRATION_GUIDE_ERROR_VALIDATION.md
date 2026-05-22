# Integration Guide: Enhanced Validation & Error Handling

This guide shows how to integrate the new error handling and validation improvements into brand analytics tools.

## Files Created

1. **`request-context.ts`** — Generate unique request IDs for tracing
2. **`brand-analytics-error.ts`** — Unified error response class
3. **`zod-enum-helpers.ts`** — Enhanced enum validation with suggestions

## Step-by-Step Integration Example

### For: `brand_analytics_get_keyword_funnel_metrics`

#### Step 1: Import utilities at the top of register.ts

```typescript
import { generateRequestContext } from '../../../utils/request-context';
import { BrandAnalyticsError } from '../../../utils/brand-analytics-error';
import { createGroupByEnumSchema, buildAggregationErrorMessage } from '../../../utils/zod-enum-helpers';
```

#### Step 2: Update the aggregation schema in querySchema

**Before:**
```typescript
group_by: z
  .array(z.enum(['intent', 'company', 'marketplace', 'keyword', 'week', 'month']))
  .max(3)
  .optional(),
```

**After:**
```typescript
group_by: createGroupByEnumSchema(
  ['intent', 'company', 'marketplace', 'keyword', 'week', 'month'],
  'for aggregation'
).optional(),
```

#### Step 3: Wrap the execute function with error handling

**Before:**
```typescript
execute: async (args, context) => {
  const parsed = inputSchema.parse(args);  // Could throw ZodError
  // ... rest of logic
}
```

**After:**
```typescript
execute: async (args, context) => {
  const requestCtx = generateRequestContext();
  
  try {
    const parsed = inputSchema.parse(args);
    // ... rest of logic
    return result;
  } catch (error) {
    // Handle validation errors
    if (error instanceof z.ZodError) {
      const invalidGroupBy = error.errors.find(
        e => e.path.includes('group_by')
      );
      
      if (invalidGroupBy) {
        throw BrandAnalyticsError.invalidAggregation(
          buildAggregationErrorMessage(
            'aggregation.group_by',
            'primary_intent_id',  // from the error
            ['intent', 'company', 'marketplace', 'keyword', 'week', 'month'],
            {
              'intent': ['intent_id', 'intent_label'],
              'company': ['company_id'],
              'marketplace': ['marketplace'],
              'keyword': ['keyword'],
              'week': ['week'],
              'month': ['month'],
            }
          ),
          { validation_errors: error.errors },
          requestCtx.request_id
        );
      }
      
      throw BrandAnalyticsError.validationError(
        `Validation failed: ${error.errors.map(e => e.message).join('; ')}`,
        { validation_errors: error.errors },
        requestCtx.request_id
      );
    }
    
    // Other errors
    throw error;
  }
},
```

### Step 4: Expose request_id in read tool responses

For tools that return data successfully, add request metadata:

```typescript
const athenaResult = await runAthenaQuery({ ... });
const rows = athenaResult.rows ?? [];

return {
  items: applySelectFields(rows, selectFields),
  _metadata: {
    request_id: requestCtx.request_id,
    query_execution_id: athenaResult.queryExecutionId,
    query_duration_ms: athenaResult.duration,
    row_count: rows.length,
  },
};
```

## Expected Error Responses

### Example 1: Invalid group_by value

**Request:**
```json
{
  "filters": { "company_ids": [92], "marketplaces": ["US"] },
  "aggregation": { "group_by": ["primary_intent_id"] }
}
```

**Response:**
```json
{
  "error": "Invalid aggregation.group_by parameter: 'primary_intent_id'.",
  "error_code": "INVALID_AGGREGATION",
  "http_status": 400,
  "request_id": "brand-analytics-1716389716000-abc123def",
  "message": "Did you mean 'intent'?\n\n'intent' returns columns: intent_id, intent_label.",
  "details": {
    "provided": "primary_intent_id",
    "suggested": "intent",
    "valid_values": ["intent", "company", "marketplace", "keyword", "week", "month"]
  },
  "timestamp": "2026-05-22T06:55:16.189Z"
}
```

### Example 2: Multiple validation errors

**Response:**
```json
{
  "error": "Validation failed: group_by contains invalid value, company_ids is required",
  "error_code": "VALIDATION_ERROR",
  "http_status": 400,
  "request_id": "brand-analytics-1716389716000-xyz789",
  "details": {
    "validation_errors": [
      { "path": ["aggregation", "group_by", 0], "message": "..." },
      { "path": ["filters", "company_ids"], "message": "..." }
    ]
  },
  "timestamp": "2026-05-22T06:55:16.189Z"
}
```

## Rollout Strategy

1. **Test tools first** (2-3 tools):
   - `brand_analytics_get_keyword_funnel_metrics`
   - `brand_analytics_get_search_term_momentum`
   - `brand_analytics_analyze_search_query_performance`

2. **Validate pattern** — Ensure error responses match the bug report template

3. **Roll out to all tools** — Apply systematically to remaining 25+ tools

4. **Monitor** — Track request_id usage in logs for tracing effectiveness

## Files to Update

### Priority 1 (Test tools)
- [ ] `get_keyword_funnel_metrics/register.ts`
- [ ] `get_search_term_momentum/register.ts`
- [ ] `analyze_search_query_performance/register.ts`

### Priority 2 (Core read tools)
- [ ] `get_competitive_landscape/register.ts`
- [ ] `list_user_intent_clusters/register.ts`
- [ ] `cluster_search_terms/register.ts`

### Priority 3 (All remaining tools)
- [ ] Remaining read tools
- [ ] Write tools
- [ ] List tools

## Backward Compatibility

✅ **Success responses** — Unchanged (items at top level)  
✅ **Error responses** — New field `request_id` added (optional)  
✅ **Metadata** — New `_metadata` object added (optional)  
✅ **Existing clients** — Still work with old response format  

## Benefits

1. **Traceability** — All errors have unique request_id for log correlation
2. **Clarity** — Error messages explain what went wrong + suggest fixes
3. **Debugging** — Includes query_execution_id for Athena console lookup
4. **Consistency** — All tools return same error structure
5. **AI-Friendly** — "Did you mean" suggestions reduce confusion

---

See [BRAND_ANALYTICS_FIX_PLAN.md](../BRAND_ANALYTICS_FIX_PLAN.md) for full architectural details.
