# Engineering Specification: Intent Clustering Tool Suite
**Version:** 1.0  
**Date:** 2026-05-19  
**Audience:** Claude Opus (Copilot) Code Agent  
**Tech Stack:** Athena + Iceberg

---

## Overview

Implement 3 intent clustering tools that transform raw search terms into semantic customer intent clusters. These tools are the foundation for making NeonPanel "intent-native."

---

## Data Model (Athena/Iceberg)

### Table 1: `user_intent`
Stores intent definitions per brand.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| user_id | UUID | Foreign key |
| brand_id | UUID | Foreign key |
| intent_id | TEXT | Unique per brand (lowercase_with_underscores) |
| intent_name | TEXT | "Plantar Fasciitis Relief" |
| customer_need | TEXT | "What problem does this solve?" |
| status | TEXT | 'active' \| 'archived' \| 'merged' |
| search_term_count | INT | Cached count of mapped terms |
| source | TEXT | 'manual' \| 'llm_proposed' \| 'imported' |
| created_at | TIMESTAMP | ISO format |
| created_by | UUID | User ID |

**Constraints:** UNIQUE(user_id, brand_id, intent_id)

---

### Table 2: `search_term_to_intent`
N:M mapping of search terms to intents with confidence scores.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| brand_id | UUID | Foreign key |
| search_term | TEXT | Exact search term |
| intent_id | UUID | Foreign key to user_intent |
| confidence | FLOAT | 0.0-1.0, how well term maps to intent |
| contribution_pct | FLOAT | 0.0-1.0, % of this term that goes to this intent |
| source | TEXT | 'manual' \| 'llm_proposed' |
| created_at | TIMESTAMP | ISO format |
| created_by | UUID | User ID |

**Constraints:** UNIQUE(brand_id, search_term, intent_id)

---

### Table 3: `intent_cluster_audit`
Audit trail of all clustering operations.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| user_id | UUID | Foreign key |
| brand_id | UUID | Foreign key |
| operation_type | TEXT | 'cluster_with_llm' \| 'manual_create' |
| status | TEXT | 'completed' \| 'failed' |
| input_search_terms_count | INT | Number of input terms |
| output_intents_count | INT | Number of proposed intents |
| output_mapping | JSON | Full response from LLM |
| llm_model | TEXT | 'claude-opus-4-6' |
| llm_input_tokens | INT | For cost tracking |
| llm_output_tokens | INT | For cost tracking |
| created_at | TIMESTAMP | ISO format |

---

## Tool Specifications

### Tool 1: `cluster_search_terms_with_llm`

**Purpose:** Main MVP. Takes search terms, uses Claude to propose intent clusters.

**Input:**
```json
{
  "brand_id": "string",
  "search_terms": ["string"],
  "product_category": "string (optional)",
  "target_cluster_count": "int (optional, 6-12)"
}
```

**Output:**
```json
{
  "status": "success | partial_success | failed",
  "intents": [
    {
      "intent_name": "string",
      "intent_id": "string",
      "customer_need": "string",
      "search_terms": [
        {
          "term": "string",
          "confidence": 0.0-1.0
        }
      ]
    }
  ],
  "metrics": {
    "total_search_terms_analyzed": "int",
    "intents_identified": "int",
    "coverage_pct": "float",
    "high_confidence_terms": "int"
  },
  "clustering_run_id": "UUID"
}
```

**Behavior:**
1. Accept 50-1000 search terms
2. Call Claude API with clustering prompt
3. Parse JSON response
4. Store full response in intent_cluster_audit
5. Return structured output (don't auto-save intents, user reviews first)

**Error Handling:**
- Invalid input (empty list, >1000 terms) → return error
- LLM API failure → return error with retry guidance
- Parse failure → return error with raw response for inspection

---

### Tool 2: `create_user_intent_cluster`

**Purpose:** Create a new intent (manual or from LLM proposal).

**Input:**
```json
{
  "brand_id": "string",
  "intent_id": "string (must be unique per brand)",
  "intent_name": "string",
  "customer_need": "string",
  "search_terms": [
    {
      "term": "string",
      "confidence": "float (default 0.95)"
    }
  ]
}
```

**Output:**
```json
{
  "id": "UUID",
  "intent_id": "string",
  "intent_name": "string",
  "search_term_count": "int",
  "created_at": "timestamp"
}
```

**Behavior:**
1. Validate intent_id uniqueness within brand
2. Create user_intent row
3. Create search_term_to_intent rows (if terms provided)
4. Update search_term_count cache
5. Return created intent

---

### Tool 3: `list_user_intent_clusters`

**Purpose:** List all intents for a brand with optional filters.

**Input:**
```json
{
  "brand_id": "string",
  "status": "active | archived | all (default: active)",
  "limit": "int (default 50, max 500)",
  "offset": "int (default 0)"
}
```

**Output:**
```json
{
  "intents": [
    {
      "id": "UUID",
      "intent_id": "string",
      "intent_name": "string",
      "customer_need": "string",
      "search_term_count": "int",
      "avg_confidence": "float",
      "created_at": "timestamp"
    }
  ],
  "total_count": "int",
  "limit": "int",
  "offset": "int"
}
```

**Behavior:**
1. Query user_intent with filters
2. Enrich with search_term_count & avg_confidence (from search_term_to_intent)
3. Return paginated results

---

## Integration with Existing Tools

### Extend: `analyze_search_query_performance`

Add optional parameter: `group_by: "intent" | "search_term" | "both"`

When `group_by="intent"`:
- Join with search_term_to_intent
- Aggregate metrics by intent_id
- Multiply by contribution_pct for proportional contribution

**Example:**
```
Before: "compression sleeve" → 1000 searches
After (grouped by intent):
  "arm_compression_general" → 1800 searches (includes "compression sleeve" + "arm compression" + others)
```

---

## Acceptance Criteria

### Code Ready When:
- [ ] 3 tables created in Athena/Iceberg
- [ ] 3 tools implemented (cluster_with_llm, create_intent, list_intents)
- [ ] Tools accept specified input schemas, return specified output schemas
- [ ] Error handling for: empty input, invalid intent_id, LLM failures, parse errors
- [ ] Integration: `group_by="intent"` works in analyze_search_query_performance
- [ ] Unit tests pass (MVP: happy path + error cases)
- [ ] E2E test passes: upload 74 terms → cluster → create 9 intents → list intents → verify

### Integration Ready When:
- [ ] LLM audit trail stored (clustering_run_id)
- [ ] User can batch-create intents from LLM output
- [ ] Intent analytics accessible via analyze_search_query_performance

---

## Example Workflow

```
Input: 74 search terms from Kemford CSV

1. cluster_search_terms_with_llm(search_terms=[...])
   → Returns: 9 proposed intents, clustering_run_id=abc123

2. User reviews proposals (frontend handles UI)

3. create_user_intent_cluster × 9
   → Creates 9 intents + 74 search_term_to_intent mappings

4. list_user_intent_clusters(brand_id=kemford)
   → Returns: 9 intents with search_term_count, avg_confidence

5. analyze_search_query_performance(
     brand_id=kemford,
     group_by="intent"
   )
   → Returns: metrics rolled up by intent (not keyword)
```

---

## Notes for Copilot

- Use Iceberg for all tables (CRUD operations, time travel)
- Athena queries should be efficient (proper partitioning, indexes)
- LLM prompt is in existing codebase or pass to Copilot separately
- No dashboard/UI needed yet — focus on API & data layer
- Copilot handles all implementation details, testing, error handling
- Store full LLM JSON response in intent_cluster_audit for audit & debugging

---

**Status:** Ready for Copilot Intake
