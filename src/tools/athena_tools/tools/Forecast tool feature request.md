# NeonPanel MCP Forecasting Tools – Feature Request Document

**Date:** January 17, 2026  
**Submitted by:** Kio (Sales Forecasting AI Assistant)  
**Priority:** High  
**Category:** API Usability & Performance

---

## Executive Summary

After extensive use of the NeonPanel forecasting MCP tools during a 24-month sales re-plan for Kemford US (Ankle Compression Sleeves family), we identified **3 critical bottlenecks** and **6 enhancement opportunities** that would significantly improve planning workflow efficiency and data accuracy.

**Key Finding:** Single-item limitations and split data access patterns force planners to make 15+ API calls for tasks that should require 1–2 calls.

---

## Identified Issues & Requested Solutions

### **CRITICAL – Issue #1: Compare Tool Single-Item Limitation**

**Current Behavior:**
- `forecasting_compare_sales_forecast_scenarios_mcp_neonpanel` accepts only **one SKU** at a time
- Cannot retrieve actuals for product family / multiple SKUs in batch

**Impact:**
- To get 15-month historical actuals for top 10 SKUs = **10 separate API calls**
- To calculate seasonality index across family = **manual aggregation** after 10 calls
- Estimated waste: **45 minutes of API calls** for what should be 2 minutes of data retrieval

**Requested Solution:**
Add optional array support: sku: ["SKU1", "SKU2", "SKU3"]
Returns: {item_ref, rows[]} where rows are grouped by period/sku
OR
Add family-level comparison: product_family: "Ankle Compression Sleeves"
Returns: aggregated actuals + scenarios for entire family
**Expected Benefit:** 90% reduction in API calls for family-level re-planning

---

### **CRITICAL – Issue #2: Forecast List Tool Returns Plan-Only, Not Historical Actuals**

**Current Behavior:**
- `forecasting_list_latest_sales_forecast_mcp_neonpanel` with `horizon_months=24` returns **forecast array only**
- No access to month-by-month historical actuals through this tool
- Actuals only available via compare tool (single-item at a time)

**Impact:**
- Cannot pull "show me what happened + what we forecast" in one call
- Planners must use compare tool (slower, single-item) instead of list tool (faster, batch)
- Inconsistent data flows: forecast via list, actuals via compare

**Requested Solution:**
Add parameters to list tool:
include_actuals_history: true (default false)
actuals_date_range: {start_date: "2024-10-01", end_date: "2026-01-01"}
Returns rows with both:
series_type: "actual" | "forecast"
period: "2024-10", "2024-11", ..., "2026-01", etc.
units_sold: number

**Expected Benefit:** 
- Single unified call for historical + forward data
- Backward compatible (default false)
- Enables real-time variance analysis

---

### **CRITICAL – Issue #3: Append-Only Write Behavior Unclear & Produces Duplicates**

**Current Behavior:**
- Writing forecast for same (SKU, period) creates **new record, not replacement**
- System now contains duplicate entries for 2026-03 & 2026-04 (both old + new values)
- Unclear from documentation whether writes are append-only or replace-if-exists

**Impact:**
- Audit trail confusing (2 values per month for adjusted periods)
- Query complexity increases (must filter by `run_updated_at` to get latest)
- No way to cleanly update a forecast without creating duplicates

**Requested Solution:**
Add write parameter:
write_mode: "append" (default, current behavior) | "replace"
If write_mode="replace":
Deletes prior record for (sku, marketplace, forecast_period, scenario)
Writes new record
Maintains audit trail via audit table (not main forecast table)
Document clearly:
Default behavior is append-only (immutable)
Replace mode requires explicit opt-in
Audit trail preserved in separate table

**Expected Benefit:**
- Clean forecast iterations without duplicates
- Clear semantics for re-planning workflows

---

## HIGH PRIORITY – Enhancement Requests

### **Enhancement #4: Bulk Actuals Export Endpoint**

**Current Behavior:**
- No bulk actuals retrieval; must use compare tool one-at-a-time

**Requested Endpoint:**
POST /api/v1/forecasting/get-actuals-bulk
Input:
company_id: 103
sku_array: ["SKU1", "SKU2", ...]
date_range: {start: "2024-01-01", end: "2026-01-31"}
grouping: "sku" | "product_family" | "both"Output:
{
item_summary: [{sku, product_family, units_total, revenue_total}],
monthly_detail: [{period, sku, units_sold, sales_amount, currency}],
meta: {query_duration_ms, row_count}
}
**Use Case:** Planning workflows always start with "show me what happened"  
**Expected Benefit:** 10x faster data retrieval for re-planning

---

### **Enhancement #5: Built-In Seasonality Index**

**Current Behavior:**
- Must manually calculate: seasonality_index = actual_units / baseline_units for each month
- Time-consuming for families with 20+ SKUs

**Requested Enhancement:**
Add optional parameter to compare/list tools:
include_seasonality_index: true
Returns additional column per row:
{
period: "2025-07",
units_sold: 2378,
seasonality_index: 1.91,  // 2378 / 1244 (monthly baseline)
seasonality_label: "PEAK"  // calculated range
}
**Use Case:** Every re-plan uses seasonality; should be first-class  
**Expected Benefit:** Eliminate manual calculation; improve accuracy

---

### **Enhancement #6: Explicit Unit Price Field**

**Current Behavior:**
- Unit price used in `sales_amount = units_sold × unit_price` but field not returned
- Planners must reverse-engineer: `unit_price = sales_amount / units_sold`
- Hidden assumptions = hidden forecast risks

**Requested Solution:**
Add to forecast responses (list/compare):
{
period: "2025-07",
units_sold: 2378,
sales_amount: 22937,
unit_price: 9.65,  // NEW
unit_price_source: "snapshot" | "estimate" | "manual",
currency: "USD"
}Add to write requests:
{
sku: "KMF-AS-M-BE",
forecast_period: "2026-01",
units_sold: 435,
unit_price: 15.00,  // explicit
sales_amount: 6525,  // calculated as check
currency: "USD"
}
**Use Case:** Price assumptions change; planners need transparency  
**Expected Benefit:** Forecast accuracy audit; clear price tracking

---

### **Enhancement #7: Aggregation with SKU Breakdown**

**Current Behavior:**
- `aggregate=true` sums everything (lose individual SKU share)
- `aggregate=false` returns SKUs (lose family total)
- No way to get both in one call

**Requested Solution:**
Enhance group_by parameter:
group_by: ["product_family"]  // returns family total only
group_by: ["product_family", "sku"]  // returns family + per-SKU breakdown (hierarchical)
Returns rows at both levels:
[
{product_family: "Ankle Compression Sleeves", sku: null, units_sold: 46137, sales_amount: 488129},  // subtotal
{product_family: "Ankle Compression Sleeves", sku: "KMF-AS-M-BE", units_sold: 9206, sales_amount: 138090},
{product_family: "Ankle Compression Sleeves", sku: "KMF-AS-L-BE", units_sold: 8299, sales_amount: 124155},
...
]
**Use Case:** Calculate revenue shares for dispersal to SKUs  
**Expected Benefit:** One call instead of two; cleaner data flow

---

### **Enhancement #8: Recent Actuals Data Lag Documentation**

**Current Behavior:**
- Actuals available through Dec 2025 (for 2026 forecast created on Jan 16)
- Unclear whether this is expected or lag

**Requested Solution:**
API Response Meta:
{
meta: {
actuals_latest_period: "2025-12",
actuals_data_lag_days: 17,
forecast_horizon_start: "2026-01",
note: "Actuals finalize ~14 days after period close"
}
}
**Use Case:** Planners need to know data freshness  
**Expected Benefit:** Clear expectations; reduced confusion

---

## Implementation Priority & Effort Estimate

| Priority | Issue | Est. Effort | Business Impact |
|----------|-------|-------------|-----------------|
| **P0** | #1: Compare batch SKU support | 2 days | 90% API call reduction |
| **P0** | #2: List tool actuals history | 3 days | Unified data flow |
| **P0** | #3: Write mode clarity | 1 day | Eliminate duplicates |
| **P1** | #4: Bulk actuals endpoint | 2 days | 10x faster workflows |
| **P1** | #5: Seasonality index | 1 day | Built-in KPI |
| **P2** | #6: Explicit unit price | 1 day | Transparency & audit |
| **P2** | #7: Hierarchical grouping | 1 day | Cleaner aggregation |
| **P2** | #8: Data lag documentation | 2 hours | UX clarity |
| **TOTAL** | | ~11 days | Major workflow improvement |

---

## Success Metrics

After implementation, re-planning workflows should:

- ✅ Require **≤5 API calls** (vs. current ~25)
- ✅ Complete family-level analysis in **<2 minutes** (vs. current ~15 min)
- ✅ Return **both actuals + forecast** in single unified dataset
- ✅ Support **batch operations** (10+ SKUs, multiple families)
- ✅ Provide **clear audit trail** with no duplicates
- ✅ Include **transparent unit pricing** in all forecasts

---

## Additional Notes

### Positive Feedback
- Write tool's dry_run validation is **excellent** for governance
- Append-only audit trail design is **sound** (just needs clarity)
- Scenario comparison modes are **powerful** once you understand precedence
- React artifact support enables **stunning data visualization**

### Quick Wins (Minimal Effort)
1. **Add precedence documentation** to scenario selection (5 min read improvement)
2. **Include unit_price in responses** (1-day dev, massive UX win)
3. **Document data lag** in meta field (2-hour dev, huge clarity win)

### Long-Term Vision
- Add AI-native re-planning endpoint (batch seasonality + growth application)
- Build scenario management UI (compare, approve, deploy forecasts)
- Enable webhook notifications (forecast variance alerts)

---

## Contact & Questions

For implementation questions or clarifications on this feature request, please reach out to:
- **Submitter:** Kio (Sales Forecasting AI Assistant)
- **Use Case:** Kemford US, Ankle Compression Sleeves, 24-month re-plan
- **Real-world impact:** 216 forecast records written, 43+ SKUs dispersed

---

**End of Feature Request Document**


DISCOVERY: Audit metadata is stripped from write operations

Current behavior:
- reason field: DISCARDED ❌
- author.type field: DISCARDED ❌
- idempotency_key: DISCARDED ❌
- Only author_name + updated_at saved ✅

Requested: Persist full audit context

Either:
A) Extend forecast table schema to include:
   - reason (255 char)
   - author_type (enum: user/ai/system)
   - author_id (uuid)
   
B) Create audit_log table (forecast_id → reason/author_type/idempotency)

C) Clearly document that audit metadata is write-only (request logs) 
   not persisted (forecast snapshots)

Impact: Without full audit trail, stakeholders can't understand 
forecast change history.