# Brand Analytics Tools Exploration

**Date**: May 22, 2026  
**Workspace**: `/Users/mikesorochev/GitHub Projects/neonpanel-mcp-server`

---

## 1. File Structure Overview

### Directory Layout
```
src/tools/athena_tools/tools/brand_analytics/
├── _shared/
│   └── catalog_cte.sql
├── _intent_common.ts (shared intent-clustering helpers)
├── select-fields.ts (shared field projection with validation)
├── _shared/
│   └── catalog_cte.sql
├── [30 tool directories] ← see detailed list below
│
├── Tools:
├── READ (analysis/retrieval):
│   ├── analyze_repeat_purchases/
│   ├── analyze_search_catalog_performance/
│   ├── analyze_search_query_performance/
│   ├── cluster_search_terms/
│   ├── create_user_intent_cluster/
│   ├── get_competitive_landscape/
│   ├── get_conversion_leak_analysis/
│   ├── get_cross_sell_opportunities/
│   ├── get_customer_retention_stats/
│   ├── get_keyword_funnel_metrics/
│   ├── get_search_term_momentum/
│   ├── growth_machine_diagnosis/
│   ├── list_analytics_watchlist/
│   ├── list_competitor_asins/
│   ├── list_ryg_thresholds/
│   ├── list_sqp_query_details_uploads/
│   ├── list_tracked_search_terms/
│   ├── list_user_intent_clusters/
│   └── run_watchlist/
│
├── WRITE (data persistence):
│   ├── upload_sqp_query_details/
│   ├── write_analytics_watchlist/
│   ├── write_competitor_asins/
│   ├── write_ryg_thresholds/
│   └── write_tracked_search_terms/
│
└── Configuration:
    ├── analytics_watchlist/ (reference data)
    ├── competitor_asins/ (reference data)
    ├── ryg_thresholds/ (Red-Yellow-Green color thresholds)
    ├── sqp_query_details_uploads/ (audit trail)
    └── tracked_search_terms/ (keyword cores per ASIN)
```

**Total Tool Implementations**: ~30 (organized in separate directories)

---

## 2. File Structure Per Tool

### Standard Tool Layout
Each tool directory contains:

```
{tool_name}/
├── register.ts                    # Main handler (Zod validation, permission checks, SQL rendering)
├── tool.json                      # Tool spec (name, description, input/output schemas)
├── query.sql                      # SQL template (read operations)
├── query_grouped.sql             # Grouped variant (if tool supports aggregation)
├── insert.sql                    # SQL INSERT template (write operations)
├── delete_slots.sql / reset_all.sql  # Write cleanup operations
├── {table_name}_ddl.txt          # Iceberg table definition (documentation)
└── [README.md, sample files]     # Optional documentation
```

### Example: `get_search_term_momentum/`

```
get_search_term_momentum/
├── register.ts                   # 330+ lines
├── tool.json                     # Full input/output schema
├── query.sql                     # Detail-level query (term × ASIN × marketplace)
├── query_grouped.sql            # Portfolio-level aggregation
└── search_query_snapshot_ddl.txt # Data source table definition
```

---

## 3. Schema Validation Approach

### Validation Framework: **Zod (TypeScript-native)**

**Location**: `src/tools/athena_tools/tools/brand_analytics/get_search_term_momentum/register.ts` (lines 51-99)

### Validation Layers

#### 1. **Query Envelope Schema** (Common to all Brand Analytics tools)
```typescript
const querySchema = z.object({
  filters: z.object({
    company_ids: z.array(z.coerce.number().int().min(1)).min(1),  // REQUIRED
    search_terms: z.array(z.string()).optional(),
    intent_ids: z.array(z.string().min(1).max(64)).optional(),
    asins: z.array(z.string()).optional(),
    marketplaces: z.array(z.string()).optional(),
    // ... 8+ other optional filters
  }).strict(),
  aggregation: z.object({
    group_by: z.array(groupBySchema).optional().default([]),
    time: z.object({
      start_date: z.string().optional(),
      end_date: z.string().optional(),
      periods_back: z.coerce.number().int().min(1).max(52).default(4).optional(),
    }).optional(),
  }).optional(),
  sort: z.object({
    field: z.string().optional(),
    direction: z.enum(['asc', 'desc']).optional(),
  }).optional(),
  select_fields: z.array(z.string()).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100).optional(),
}).strict();
```

#### 2. **Tool-Specific Schema**
```typescript
const toolSpecificSchema = z.object({
  match_type: z.enum(['exact', 'contains', 'starts_with']).default('exact').optional(),
  weak_leader_detection: z.object({
    max_leader_conversion_share: z.coerce.number().min(0).max(1).optional(),
    min_search_volume: z.coerce.number().min(0).optional(),
  }).strict().optional(),
  min_click_share: z.coerce.number().min(0).max(1).optional(),
  min_search_volume: z.coerce.number().min(0).optional(),
}).strict();
```

#### 3. **Root Input Schema**
```typescript
const inputSchema = z.object({
  query: querySchema,
  tool_specific: toolSpecificSchema.optional(),
}).strict();
```

### Validation Execution

```typescript
execute: async (args, context) => {
  const parsed = inputSchema.parse(args);  // ← Throws ZodError on invalid input
  const query = parsed.query as QueryInput;
  const toolSpecific = parsed.tool_specific as ToolSpecific | undefined;
  // ... rest of handler
}
```

### Validation Guarantees
- **`.strict()`** — rejects unknown properties
- **Type coercion** — `z.coerce.number()` converts strings to numbers
- **Enum validation** — `z.enum(['a', 'b'])` enforces fixed values
- **Range validation** — `.min(1).max(200)` enforces numeric bounds
- **Array constraints** — `.min(1).max(200)` enforces cardinality
- **Nullable fields** — `z.string().nullable().optional()` allows `null` or omission

### Schema Files

**Location**: `tool.json` — Tool registry spec (loaded at startup)

**Example**:
```json
{
  "name": "brand_analytics_get_search_term_momentum",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "object",
        "properties": {
          "filters": {
            "properties": {
              "company_ids": {
                "type": "array",
                "items": { "type": "integer", "minimum": 1 },
                "minItems": 1
              }
            },
            "required": ["company_ids"],
            "additionalProperties": false
          }
        }
      }
    }
  }
}
```

---

## 4. Error Handling Approach

### Current Error Handling Framework

#### **1. Input Validation Errors**
- **Mechanism**: Zod schema validation (`.parse()` throws `ZodError`)
- **Scope**: Caught at tool handler boundaries
- **Response**: Error bubbles up as AppError → JSON-RPC error response
- **Details Captured**: Field name, expected vs actual, validation rule violated

**Example (missing required field)**:
```typescript
// User input: { query: { filters: {} } }  ← missing company_ids
const parsed = inputSchema.parse(args);
// ✗ Throws ZodError: "Required: company_ids in filters"
```

#### **2. Permission Denial Errors**
- **Mechanism**: Permission check against neonPanelRequest OAuth groups
- **Response**:
  ```typescript
  if (permittedCompanyIds.length === 0 || allowedCompanyIds.length === 0) {
    return { items: [] };  // Empty result, no error field
  }
  ```
- **Details Captured**: None (implicit denial by empty result)
- **⚠️ Gap**: No explicit error message; caller must infer permission denied from empty result

#### **3. Athena Query Execution Errors**
- **Mechanism**: `runAthenaQuery()` in `src/clients/athena.ts` throws `AppError`
- **Error Cases**:
  ```typescript
  // Query failed/cancelled
  if (state === 'FAILED' || state === 'CANCELLED') {
    const reason = execution.QueryExecution?.Status?.StateChangeReason;
    throw new AppError(
      `Athena query ${state.toLowerCase()} (QueryExecutionId: ${queryExecutionId}). Reason: ${reason}`,
      {
        status: 502,
        code: 'athena_query_failed',
        details: { queryExecutionId, state, reason },
      }
    );
  }
  
  // Query timeout (default 60s)
  if (Date.now() > deadline) {
    throw new AppError('Athena query timed out waiting for completion.', {
      status: 504,
      code: 'athena_query_timeout',
      details: { queryExecutionId, waitedMs: maxWaitMs },
    });
  }
  ```
- **Details Captured**:
  - `queryExecutionId` — Athena query ID for logs
  - `state` — Query state (FAILED, CANCELLED, etc.)
  - `reason` — Athena error message (if available)
  - `waitedMs` — How long we waited before timeout

#### **4. Write Operation Errors (Dry-Run Validation)**
- **Mechanism**: Schema parsing validates each write item before execution
- **Response Structure**:
  ```typescript
  {
    dry_run: true,
    action: "write",
    accepted: writes.length,   // Items validated
    written: 0,                // No persistence in dry_run mode
    message: "Dry run: 5 tracked search term row(s) validated. Set dry_run=false to persist."
  }
  ```

#### **5. Write Operation Errors (Execution)**
- **Example** (from `write_tracked_search_terms/register.ts`):
  ```typescript
  if (writes.length === 0) {
    return {
      dry_run: dryRun,
      action,
      accepted: 0,
      written: 0,
      error: `writes array is required for action=${action}.`,
    };
  }
  
  const authorized = await isAuthorizedForCompany(companyId, context);
  if (!authorized) {
    return {
      dry_run: dryRun,
      action,
      accepted: 0,
      written: 0,
      error: 'Not authorized for this company.',
    };
  }
  ```
- **Response Fields**: `dry_run`, `action`, `accepted`, `written`, `deactivated`, `message/error`

---

### **Current Error Response Format**

**Successful Query Response**:
```typescript
{
  items: [
    { search_term: "ring", my_click_share: 0.25, wow_delta: 0.02, ... },
    { search_term: "ring stand", my_click_share: 0.15, wow_delta: -0.01, ... }
  ],
  _unrecognized_fields?: ["nonexistent_field"],  // If select_fields projection failed
  _available_fields?: ["search_term", "my_click_share", ...]  // Available columns
}
```

**Write Tool Dry-Run Response**:
```typescript
{
  dry_run: true,
  action: "write",
  accepted: 5,
  written: 0,
  message: "Dry run: 5 tracked search term row(s) validated. Set dry_run=false to persist."
}
```

**Write Tool Error Response**:
```typescript
{
  dry_run: true,
  action: "write",
  accepted: 0,
  written: 0,
  error: "Not authorized for this company."
}
```

---

### **Gaps in Current Error Reporting**

| Gap | Impact | Example |
|-----|--------|---------|
| **No request_id in response** | Caller cannot correlate errors to logs | Permission denied returns empty items[] with no ID |
| **No HTTP status capture** | Caller doesn't know if error is client/server fault | Athena timeout (504) caught but not propagated to response schema |
| **Empty result vs. permission denied** | Ambiguous: can't distinguish "no data" from "no access" | `{ items: [] }` for both cases |
| **No query execution timestamp** | Can't diagnose slow queries without logs | Query took 30s but no timing in response |
| **Athena QueryExecutionId not in response** | Caller can't link to Athena console | Returned in thrown AppError, not in successful response |
| **Field validation errors silent** | Invalid select_fields silently dropped | `select_fields: ["typo_field"]` returns all fields with hint instead of error |
| **SQL render errors caught broadly** | Hard to diagnose template issues | SQL syntax errors from renderSqlTemplate caught as generic AppError |

---

## 5. `group_by` Implementation

### Location
[get_search_term_momentum/register.ts](get_search_term_momentum/register.ts#L70-L99) and [query_grouped.sql](get_search_term_momentum/query_grouped.sql#L1-L50)

### Input Schema
```typescript
aggregation: z.object({
  group_by: z
    .array(groupBySchema)
    .optional()
    .default([]),  // ← Empty = detail rows (no grouping)
})

const groupBySchema = z.enum([
  'intent',           // primary_intent_id
  'search_term',      // search_term
  'marketplace',      // marketplace_country_code
  'company',          // company_id
  'brand',            // my_brand
  'product_family',   // product_family
  'category',         // rank_1_department
  'asin'              // asin
]);
```

### Max Items
```typescript
.array(...).maxItems(3)
```
**Constraint**: User can group by maximum 3 dimensions

### Accepted Values
```
"intent"          → Group by primary_intent_id (intent clustering)
"search_term"     → Group by search_term (portfolio aggregation per keyword)
"marketplace"     → Group by marketplace_country_code
"company"         → Group by company_id
"brand"           → Group by my_brand
"product_family"  → Group by product_family
"category"        → Group by rank_1_department
"asin"            → Group by asin (ASIN-level aggregation)
```

### Dimension Mapping

**Location**: [get_search_term_momentum/register.ts](get_search_term_momentum/register.ts#L100-L115)

```typescript
const dimensionMap: Record<GroupByField, DimensionConfig> = {
  intent: { expression: "COALESCE(aw.primary_intent_id, '__UNCLASSIFIED__')", alias: 'primary_intent_id' },
  search_term: { expression: 'aw.search_term', alias: 'search_term' },
  marketplace: { expression: 'aw.marketplace', alias: 'marketplace' },
  company: { expression: 'aw.company_id', alias: 'company_id' },
  brand: { expression: "COALESCE(aw.my_brand, '__UNKNOWN__')", alias: 'my_brand' },
  product_family: { expression: "COALESCE(aw.product_family, '__UNKNOWN__')", alias: 'product_family' },
  category: { expression: "COALESCE(aw.category, '__UNKNOWN__')", alias: 'category' },
  asin: { expression: 'aw.asin', alias: 'asin' },
};
```

### SQL Rendering

**Location**: [query_grouped.sql](query_grouped.sql#L100-L120) (grouped mode)

```sql
weekly_grouped AS (
  SELECT
    MAX(aw.primary_intent_label) AS primary_intent_label,
    {{group_by_select_clause}},  -- ← Injected dimensions SELECT
    aw.week_start AS period_start,
    MAX(aw.search_volume) AS search_volume,
    LEAST(1.0, SUM(COALESCE(aw.my_click_share, 0.0))) AS portfolio_click_share,
    -- ... 20+ computed fields
  FROM asin_weekly aw
  GROUP BY {{group_by_clause}}, aw.week_start  -- ← Injected GROUP BY
)
```

### Example Usage

**Request**:
```json
{
  "query": {
    "filters": { "company_ids": [103] },
    "aggregation": {
      "group_by": ["search_term", "marketplace"]
    }
  }
}
```

**SQL Rendered** (simplified):
```sql
GROUP BY 
  aw.search_term,
  aw.marketplace_country_code,
  aw.week_start
```

**Response** (grouped rows):
```
[
  {
    "search_term": "ring",
    "marketplace": "US",
    "period_start": "2026-05-15",
    "portfolio_click_share": 0.45,  -- Aggregated across all ASINs
    "asin_count": 3,
    "avg_asin_click_share": 0.15,
    ...
  },
  {
    "search_term": "ring",
    "marketplace": "UK",
    "period_start": "2026-05-15",
    "portfolio_click_share": 0.22,
    "asin_count": 2,
    ...
  }
]
```

### Detail Mode (No Grouping)

**Request**:
```json
{
  "query": {
    "filters": { "company_ids": [103] },
    "aggregation": { "group_by": [] }  // ← Empty or omitted
  }
}
```

**Response** (detail rows, one per search_term × ASIN × marketplace):
```
[
  {
    "search_term": "ring",
    "marketplace": "US",
    "asin": "B0AAAA1111",
    "my_click_share": 0.25,
    "period_start": "2026-05-15",
    ...
  },
  {
    "search_term": "ring",
    "marketplace": "US",
    "asin": "B0BBBB2222",
    "my_click_share": 0.20,
    "period_start": "2026-05-15",
    ...
  }
]
```

### Key Differences (Detail vs. Grouped)

| Aspect | Detail Mode | Grouped Mode |
|--------|------------|--------------|
| **Grain** | search_term × ASIN × marketplace × week | User-defined dimensions × week |
| **search_volume** | Per ASIN (can vary) | MAX(search_volume) de-duped |
| **my_click_share** | Per ASIN | SUM across ASINs (capped at 1.0) |
| **SQL Query** | query.sql | query_grouped.sql |
| **Row Count** | More rows (one per ASIN) | Fewer rows (one per dimension combo) |

---

## 6. Response Format

### Successful Read Tool Response

**Location**: [get_search_term_momentum/register.ts](get_search_term_momentum/register.ts#L330) + [select-fields.ts](select-fields.ts)

```typescript
{
  items: [
    {
      search_term: "ring",
      marketplace: "US",
      asin: "B0AAAA1111",
      my_click_share: 0.25,
      portfolio_click_share: 0.45,
      wow_delta: 0.02,
      avg_share_l4w: 0.23,
      avg_share_l12w: 0.21,
      momentum_signal: "accelerating",
      search_volume: 15000,
      rank_1_asin: "B0XXXX0000",
      rank_1_clickshare: 0.40,
      rank_1_conversionshare: 0.08,
      is_weak_leader: true,
      leader_conversion_share: 0.08,
      displacement_opportunity_score: 142.5,
      period_start: "2026-05-15",
      period_end: "2026-05-21",
      primary_intent_id: "defend_position",
      // ... 40+ fields depending on tool
    }
  ],
  _unrecognized_fields?: ["nonexistent_field"],
  _available_fields?: [
    "search_term",
    "marketplace",
    "asin",
    "my_click_share",
    // ... all available columns
  ]
}
```

### Write Tool Response (Dry-Run)

**Location**: [write_tracked_search_terms/register.ts](write_tracked_search_terms/register.ts#L180-L200)

```typescript
{
  dry_run: true,
  action: "write",
  accepted: 5,      // ← Items validated
  written: 0,       // ← No persistence
  message: "Dry run: 5 tracked search term row(s) validated. Set dry_run=false to persist."
}
```

### Write Tool Response (Committed)

```typescript
{
  dry_run: false,
  action: "write",
  accepted: 5,
  written: 5,       // ← Rows persisted
  message: "5 tracked search term row(s) written for company_id=103."
}
```

### Write Tool Response (Reset Action)

```typescript
{
  dry_run: false,
  action: "reset",
  accepted: 0,      // ← No input writes (entire table reset)
  written: 0,
  deactivated: -1,  // ← All entries deactivated
  message: "All tracked search term entries for company_id=103 have been deactivated."
}
```

### Field Projection Response

**Location**: [select-fields.ts](select-fields.ts)

When user provides `select_fields` parameter with invalid field names:

```typescript
{
  items: [
    { search_term: "ring", my_click_share: 0.25 }  // ← Only valid fields
  ],
  _unrecognized_fields: ["typo_field", "nonexistent"],
  _available_fields: [
    "search_term", "marketplace", "asin", "my_click_share", 
    "wow_delta", "avg_share_l4w", "momentum_signal", ...
  ]
}
```

**Purpose**: Allows caller to self-correct without error.

---

## 7. Current Gaps & Recommendations

### Critical Gaps

| Gap | Severity | Recommendation |
|-----|----------|-----------------|
| **Missing request_id** | High | Add `request_id` to every response (UUID generated in tool handler) for tracing |
| **No HTTP status in schema** | High | Extend response schema to include `http_status` (200, 400, 403, 500, 504) |
| **Permission denial ambiguous** | High | Return explicit `{ error: "Insufficient permissions for company_id=103" }` instead of empty items[] |
| **Athena QueryExecutionId not returned** | Medium | Include `query_execution_id` in successful response for audit trail |
| **No query timing in response** | Medium | Include `execution_stats.engineExecutionTimeInMillis` in successful response |
| **SQL render errors silent** | Medium | Catch renderSqlTemplate errors separately, return user-friendly message |
| **Field projection hides errors** | Low | Consider making unrecognized fields an error (HTTP 400) instead of warning |
| **No structured error details** | Medium | Extend error response schema: `{ error: string, code: string, details?: object, request_id: string }` |

### Suggested Response Schema Enhancement

```typescript
// Current
{ items: [...] }

// Proposed
{
  request_id: "550e8400-e29b-41d4-a716-446655440000",  // UUID
  http_status: 200,
  items: [...],
  
  // Optional error/warning fields
  error?: {
    code: "insufficient_permissions" | "validation_error" | "query_timeout" | ...,
    message: string,
    details?: {
      field?: string,
      constraint?: string,
      query_execution_id?: string,
      waited_ms?: number,
    }
  },
  
  // Optional metadata
  query_execution_id?: string,
  execution_stats?: {
    data_scanned_bytes?: number,
    engine_execution_time_ms?: number,
    total_execution_time_ms?: number,
  }
}
```

---

## 8. Summary Table: Tool Categories

| Category | Count | Purpose | Examples |
|----------|-------|---------|----------|
| **Read (Analysis)** | 20 | Query Brand Analytics data | `get_search_term_momentum`, `get_competitive_landscape`, `get_keyword_funnel_metrics` |
| **Write (Data Ops)** | 5 | Persist company-specific data | `write_tracked_search_terms`, `write_ryg_thresholds` |
| **List (Reference)** | 4 | List configuration/metadata | `list_ryg_thresholds`, `list_tracked_search_terms` |
| **Cluster (ML/Analytics)** | 1 | Intent clustering | `cluster_search_terms` |

---

## Key Takeaways

✅ **Strengths**:
- Zod validation framework is robust and type-safe
- Permission model via OAuth token + neonPanelRequest
- SQL template rendering with SQL injection prevention
- Dry-run mode for write operations
- Grouped aggregation with flexible dimensions

⚠️ **Weaknesses**:
- No request_id for tracing
- Permission denial returns empty results (ambiguous)
- Athena query IDs not in response
- Error response schema not standardized
- Field projection warnings not actionable errors
- No HTTP status in response schema
