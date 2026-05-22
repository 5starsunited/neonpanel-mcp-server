# Root Cause Analysis: Why AI Client Used Wrong Intent Parameter

## Summary
The AI client used `group_by: ["primary_intent_id"]` instead of `group_by: ["intent"]` because:

1. **Inconsistent output column naming** across similar tools
2. **Documentation doesn't specify output column names** for aggregation parameters
3. **Internal column names leak into API responses**, confusing users about parameter names

---

## Root Cause: The Pattern Inconsistency

### Tool 1: `get_search_term_momentum` ❌ INCONSISTENT
```typescript
// register.ts line 123
const dimensionMap: Record<GroupByField, DimensionConfig> = {
  intent: { expression: "COALESCE(aw.primary_intent_id, '__UNCLASSIFIED__')", alias: 'primary_intent_id' }
  // ^^^^^^ User-facing parameter      ^^^^^^^^^^^^^^^^^^^^ Internal column
  //                                   ^^^^^^^ OUTPUT ALIAS (exposes internal name!)
};
```

**Response output:**
```json
{ "primary_intent_id": "beginner_kit_shopping" }
```

### Tool 2: `get_keyword_funnel_metrics` ✅ CONSISTENT
```typescript
// register.ts line 230
const dimMap: Record<string, { select: string; group: string }> = {
  intent: { select: 'w.primary_intent_id AS intent_id, w.primary_intent_label AS intent_label', ... }
  // ^^^^^^ User-facing parameter      ^^^^^^^^^^^^^^^^^^^ Internal column
  //                              ^^^^^^^^^ Clearer output name!
};
```

**Response output:**
```json
{ "intent_id": "beginner_kit_shopping", "intent_label": "Beginner Kit Shopping" }
```

### Tool 3: `get_competitive_landscape` ✅ CONSISTENT
```typescript
// register.ts line 201
const dimMap = {
  intent: { select: 'e.primary_intent_id AS intent_id', ... }
  // ^^^^^^ User-facing parameter      ^^^^^^^^^^^^^^^^^^^ Internal column
  //                              ^^^^^^^^^ Clear output name!
};
```

---

## Why This Happened

| Layer | Issue | Severity |
|-------|-------|----------|
| **Internal Design** | Some tools use `primary_intent_id` (internal) as output alias; others alias to `intent_id` (clearer) | Medium |
| **Documentation** | tool.json describes `group_by: ["intent"]` but never says "returns intent_id and intent_label columns" | HIGH |
| **Client Behavior** | AI sees `primary_intent_id` in response from one tool, assumes parameter is `group_by: ["primary_intent_id"]` | Expected |

---

## Documentation Gap in tool.json

### Current documentation (keyword_funnel_metrics):
```json
{
  "group_by": {
    "type": "array",
    "enum": ["intent", "company", "marketplace", "keyword", "week", "month"],
    "description": "Optional. When non-empty, returns weighted aggregations bucketed by these dimensions (max 3)..."
  }
}
```

❌ **Missing:** What columns are returned when you use each enum value!

### What it SHOULD say:
```json
{
  "group_by": {
    "type": "array",
    "enum": ["intent", "company", "marketplace", "keyword", "week", "month"],
    "description": "Optional. Aggregate by dimensions (max 3). \n\nReturned columns:\n- 'intent' → intent_id + intent_label\n- 'company' → company_id\n- 'marketplace' → marketplace\n- 'keyword' → keyword\n- 'week' → week (date)\n- 'month' → month (date)"
  }
}
```

---

## Pattern Comparison: All Brand Analytics Tools

| Tool | group_by Enum | Output Column (intent) | Consistency |
|------|---------------|------------------------|----|
| get_search_term_momentum | intent, search_term, ... | `primary_intent_id` | ❌ Internal name leaked |
| get_keyword_funnel_metrics | intent, company, ... | `intent_id` + `intent_label` | ✅ Clear alias |
| get_competitive_landscape | intent, marketplace, ... | `intent_id` | ✅ Clear alias |
| analyze_search_query_performance | intent, company, ... | `intent_id` + `intent_label` | ✅ Clear alias |

**3 out of 4 use `intent_id`; 1 uses `primary_intent_id`** → Inconsistent pattern!

---

## Is the Pattern Different from Other Tools?

### Yes, inconsistency detected:

**Similar tools that aggregate by dimensions:**
- `get_search_term_momentum` — uses internal name `primary_intent_id` as output
- `get_keyword_funnel_metrics` — aliases to `intent_id` (clearer)
- `get_competitive_landscape` — aliases to `intent_id` (clearer)

**Why the inconsistency?**
- Likely historical: `get_search_term_momentum` was built first, using the internal CTE column name directly
- Later tools (`get_keyword_funnel_metrics`, etc.) aliased for clarity
- Never normalized/fixed the first tool

---

## Impact Assessment

| Scenario | Impact | Probability |
|----------|--------|------------|
| AI tries `get_search_term_momentum` first | Sees `primary_intent_id` column | Medium |
| AI then tries `get_keyword_funnel_metrics` | Assumes same parameter, tries `group_by: ["primary_intent_id"]` | **HIGH** |
| User manually compares two tools | Confused by different output column names for same logical dimension | **HIGH** |
| New tool developer copies pattern | Propagates inconsistency to new tools | **HIGH** |

---

## Recommended Fixes (Priority Order)

### 1. **Standardize Output Column Names** (Required)
Rename `primary_intent_id` → `intent_id` in `get_search_term_momentum` output.

**File:** `src/tools/athena_tools/tools/brand_analytics/get_search_term_momentum/register.ts` (line 123)

```typescript
// BEFORE:
intent: { expression: "COALESCE(aw.primary_intent_id, '__UNCLASSIFIED__')", alias: 'primary_intent_id' }

// AFTER:
intent: { expression: "COALESCE(aw.primary_intent_id, '__UNCLASSIFIED__')", alias: 'intent_id' }
```

**Impact:** Breaking change for clients expecting `primary_intent_id` column, but necessary for consistency.

### 2. **Enhance tool.json Documentation** (Required)
Add column name mappings to all brand analytics tools with `group_by` parameter.

**Template:**
```json
{
  "group_by": {
    "description": "... existing text ...\n\nOutput columns by dimension:\n- 'intent' → intent_id, intent_label\n- 'company' → company_id\n- 'marketplace' → marketplace\n- 'keyword' → keyword\n- 'week' → week\n- 'month' → month"
  }
}
```

**Files to update:**
- `get_keyword_funnel_metrics/tool.json`
- `get_search_term_momentum/tool.json`
- `get_competitive_landscape/tool.json`
- `analyze_search_query_performance/tool.json`
- Any other tool with `group_by` parameter

### 3. **Add Validation Error Enhancement** (Part of Error Capture Plan)
When user submits invalid `group_by` value, provide suggestion:

```
error: "Invalid group_by parameter"
message: "group_by value 'primary_intent_id' is not recognized. Did you mean 'intent'? Valid values: intent, company, marketplace, keyword, week, month"
details: {
  provided: "primary_intent_id",
  valid_values: ["intent", "company", "marketplace", "keyword", "week", "month"],
  hint: "Use 'intent' as the parameter. Output columns will be: intent_id, intent_label"
}
```

---

## Success Criteria

✅ All brand analytics tools with `group_by` use consistent output column names  
✅ tool.json documents which columns each enum value produces  
✅ Error messages clarify the parameter vs output column distinction  
✅ No leaking of internal column names (e.g., `primary_intent_id`) into API responses  

---

## Files to Check/Fix

### High Priority
- [ ] `get_search_term_momentum/register.ts` (line 123) — Change `primary_intent_id` alias to `intent_id`
- [ ] `get_search_term_momentum/tool.json` — Add column mapping docs
- [ ] `get_keyword_funnel_metrics/tool.json` — Add column mapping docs
- [ ] `get_competitive_landscape/tool.json` — Add column mapping docs

### Medium Priority
- [ ] All other tools with `group_by` — Add column mapping docs
- [ ] Error handling wrapper (from fix plan) — Include "did you mean" suggestions

### Documentation
- [ ] Brand analytics README or API guide — Explain the "parameter vs output column" distinction
- [ ] Example workflows — Show what columns are returned when grouping by intent

