# Test Prompt: Updated SQP Tool + New Conversion Leak Analysis Tool

Run these tests sequentially. For each test, show the **full raw output** (all fields). Flag any errors, nulls in computed fields, or unexpected values.

Use **company_id = 103** and **marketplace = US** for all calls unless stated otherwise.

---

## TEST 1 — SQP: New Computed Fields (Efficiency Ratios)

Call `brand_analytics_analyze_search_query_performance`:
- `periods_back`: 1, `periodicity`: "weekly"
- `sort`: `{ "field": "search_query_volume", "direction": "desc" }`
- `limit`: 10
- `select_fields`: ["search_query", "search_query_volume", "impression_share", "click_share", "conversion_share", "click_through_efficiency", "conversion_efficiency"]

**Verify:**
- `click_through_efficiency` ≈ click_share ÷ impression_share for each row (allow rounding)
- `conversion_efficiency` ≈ conversion_share ÷ click_share for each row
- Neither field is NULL
- Values are reasonable (typically 0.1 – 3.0 range; edge cases possible on very low denominators)

---

## TEST 2 — SQP: Term Type Classification

Call `brand_analytics_analyze_search_query_performance`:
- `periods_back`: 4, `periodicity`: "weekly"
- `sort`: `{ "field": "search_query_volume", "direction": "desc" }`
- `limit`: 30
- `select_fields`: ["search_query", "search_query_volume", "term_type"]

**Verify:**
- Every row has a `term_type` value (not NULL)
- Values are only: "branded", "generic", or "long_tail"
- Branded terms actually contain the brand name
- Long-tail terms have 4+ words
- Generic terms are 1-3 words without brand names

---

## TEST 3 — SQP: Term Type Filter

Call `brand_analytics_analyze_search_query_performance`:
- `periods_back`: 4, `periodicity`: "weekly"
- `filters`: `{ "term_types": ["branded"] }`
- `sort`: `{ "field": "search_query_volume", "direction": "desc" }`
- `limit`: 10
- `select_fields`: ["search_query", "term_type", "impression_share", "click_share"]

**Verify:**
- ALL returned rows have `term_type` = "branded"
- No generic or long_tail terms leak through

Then repeat with `"term_types": ["long_tail"]` and verify all rows are long_tail.

---

## TEST 4 — SQP: Diagnostic Scenarios (A/B/C/D)

Call `brand_analytics_analyze_search_query_performance`:
- `periods_back`: 1, `periodicity`: "weekly"
- `sort`: `{ "field": "search_query_volume", "direction": "desc" }`
- `limit`: 30
- `select_fields`: ["search_query", "search_query_volume", "impression_share", "click_share", "conversion_share", "click_through_efficiency", "conversion_efficiency", "diagnostic_scenario", "diagnostic_scenario_description", "diagnostic_scenario_action"]

**Verify:**
- `diagnostic_scenario` is one of: "A_visibility", "B_creative", "C_conversion", "D_protect"
- `diagnostic_scenario_description` is a non-empty string containing actual metric values (not a static template)
- `diagnostic_scenario_action` is a non-empty string with specific recommendations
- The scenario assignment makes sense:
  - A_visibility: should have low impression_share
  - B_creative: should have decent impression_share but click_through_efficiency < threshold
  - C_conversion: should have decent click_share but conversion_efficiency < threshold
  - D_protect: all metrics healthy
- Show 1 example row for each scenario found

---

## TEST 5 — SQP: Diagnostic Scenario Filter

Call `brand_analytics_analyze_search_query_performance`:
- `periods_back`: 4, `periodicity`: "weekly"
- `filters`: `{ "diagnostic_scenarios": ["A_visibility", "B_creative"] }`
- `sort`: `{ "field": "search_query_volume", "direction": "desc" }`
- `limit`: 10
- `select_fields`: ["search_query", "diagnostic_scenario", "impression_share", "click_through_efficiency"]

**Verify:**
- ALL returned rows have `diagnostic_scenario` in ["A_visibility", "B_creative"]
- No C_conversion or D_protect rows leak through

---

## TEST 6 — SQP: Priority Tiers

Call `brand_analytics_analyze_search_query_performance`:
- `periods_back`: 1, `periodicity`: "weekly"
- `sort`: `{ "field": "search_query_volume", "direction": "desc" }`
- `limit`: 30
- `select_fields`: ["search_query", "search_query_volume", "conversion_efficiency", "priority_tier", "priority_tier_description"]

**Verify:**
- `priority_tier` is 1, 2, 3, or 4 for every row
- `priority_tier_description` is non-empty and matches the tier number
- Tier 1 terms generally have higher volume × conversion_efficiency than Tier 4 terms
- The distribution is roughly even (NTILE-based)

---

## TEST 7 — SQP: Priority Tier Filter

Call `brand_analytics_analyze_search_query_performance`:
- `periods_back`: 1, `periodicity`: "weekly"
- `filters`: `{ "priority_tiers": [1, 2] }`
- `sort`: `{ "field": "search_query_volume", "direction": "desc" }`
- `limit`: 15
- `select_fields`: ["search_query", "priority_tier", "priority_tier_description", "search_query_volume"]

**Verify:**
- ALL returned rows have `priority_tier` in [1, 2]
- No Tier 3 or 4 rows leak through

---

## TEST 8 — SQP: Combined Filters (Stress Test)

Call `brand_analytics_analyze_search_query_performance`:
- `periods_back`: 4, `periodicity`: "weekly"
- `filters`: `{ "term_types": ["generic"], "diagnostic_scenarios": ["B_creative", "C_conversion"], "priority_tiers": [1, 2] }`
- `sort`: `{ "field": "search_query_volume", "direction": "desc" }`
- `limit`: 10
- `select_fields`: ["search_query", "search_query_volume", "term_type", "diagnostic_scenario", "priority_tier", "click_through_efficiency", "conversion_efficiency"]

**Verify:**
- Every row satisfies ALL three filter conditions simultaneously
- This is the intersection (AND logic), so results may be fewer than 10 — that's fine
- If 0 results, loosen to `priority_tiers: [1, 2, 3]` and retry

---

## TEST 9 — SQP: diagnostic_scenario_signal (JSON field)

Call `brand_analytics_analyze_search_query_performance`:
- `periods_back`: 1, `periodicity`: "weekly"
- `sort`: `{ "field": "search_query_volume", "direction": "desc" }`
- `limit`: 5
- `select_fields`: ["search_query", "diagnostic_scenario_signal"]

**Verify:**
- `diagnostic_scenario_signal` is a valid JSON string (or parsed object)
- It contains keys: `scenario`, `description`, `action`
- The values match the individual `diagnostic_scenario`, `diagnostic_scenario_description`, `diagnostic_scenario_action` fields

---

## TEST 10 — Conversion Leak Analysis: Basic Call

Call `brand_analytics_get_conversion_leak_analysis`:
- `periods_back`: 4, `periodicity`: "weekly"
- `sort`: `{ "field": "total_leak_score", "direction": "desc" }`
- `limit`: 10
- `tool_specific`: `{ "include_diagnostic_hints": true }`

**Verify:**
- Returns ASIN-level rows (not search-term level)
- Each row has: `total_leak_score` (0–100), `worst_leak_stage`, per-stage leak fields
- `worst_leak_stage` is one of: "impression_to_click", "click_to_cart", "cart_to_purchase"
- `total_leak_score` = weighted combination of per-stage severity scores
- Diagnostic hints are present and non-empty strings with actionable advice
- Show the top 5 leaking ASINs with their worst_leak_stage and diagnostic_hint

---

## TEST 11 — Conversion Leak Analysis: Filter by ASIN

Pick 2 ASINs from Test 10 results. Call `brand_analytics_get_conversion_leak_analysis` filtered to those ASINs:
- `filters`: `{ "asin": ["<ASIN_1>", "<ASIN_2>"] }`
- `periods_back`: 4, `periodicity`: "weekly"
- `tool_specific`: `{ "include_diagnostic_hints": true }`

**Verify:**
- Returns exactly 2 rows (one per ASIN)
- Metrics match or are very close to Test 10 values for the same ASINs

---

## TEST 12 — Conversion Leak Analysis: Without Diagnostic Hints

Call `brand_analytics_get_conversion_leak_analysis`:
- `periods_back`: 4, `periodicity`: "weekly"
- `sort`: `{ "field": "total_leak_score", "direction": "desc" }`
- `limit`: 5
- `tool_specific`: `{ "include_diagnostic_hints": false }`

**Verify:**
- Diagnostic hint fields are empty/null or absent
- All numeric metrics still present and valid

---

## TEST 13 — Error Handling: Invalid Filters

Call `brand_analytics_analyze_search_query_performance` with an invalid diagnostic_scenario filter value:
- `filters`: `{ "diagnostic_scenarios": ["X_invalid"] }`

**Expected:** Tool should reject with a validation error (zod schema), NOT return empty results silently.

Call `brand_analytics_analyze_search_query_performance` with an invalid term_type:
- `filters`: `{ "term_types": ["competitor"] }`

**Expected:** Tool should reject with a validation error.

Call `brand_analytics_analyze_search_query_performance` with an invalid priority_tier:
- `filters`: `{ "priority_tiers": [5] }`

**Expected:** Tool should reject with a validation error (max is 4).

---

## Summary Checklist

After all tests, fill in:

| Test | Feature | Pass/Fail | Notes |
|------|---------|-----------|-------|
| 1 | Efficiency ratios | | |
| 2 | Term type classification | | |
| 3 | Term type filter | | |
| 4 | Diagnostic scenarios | | |
| 5 | Diagnostic scenario filter | | |
| 6 | Priority tiers | | |
| 7 | Priority tier filter | | |
| 8 | Combined filters | | |
| 9 | diagnostic_scenario_signal JSON | | |
| 10 | Conversion leak basic | | |
| 11 | Conversion leak ASIN filter | | |
| 12 | Conversion leak no hints | | |
| 13 | Error handling | | |
