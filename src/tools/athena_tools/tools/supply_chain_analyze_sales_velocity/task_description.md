Below is a **developer-facing task description** rewritten to be **implementation-clear**, **unambiguous**, and **free of product/strategy language**.
This is suitable for a Jira ticket / GitHub issue / internal tech spec.

---

# Task: Implement `supply_chain_analyze_sales_velocity`

## Purpose

Implement a **read-only analytical tool** that analyzes sales velocity across multiple data sources for a set of items defined by filters, compares those sources, detects inconsistencies, and produces **recommended sales velocity values** for different supply-chain use cases.

The tool must support:

* analysis of **any resolved set of items** (from 1 SKU to large filtered groups)
* **per-item detailed analytics**
* optional **aggregated summary output**
* **no side effects**

There is **no concept of separate modes**.
The tool always analyzes items the same way; only the **output shape** varies.

---

## 1. Item selection (input behavior)

The tool receives **filters** that define which items to analyze.

Examples:

* single SKU / ASIN
* list of ASINs
* all items where `revenue_abcd_class IN (A, B)`
* Pareto A items in a product family
* any combination of standard filters (company, brand, marketplace, tags, etc.)

**Developer rule**

> Internally, always resolve filters → item list → analyze each item identically.

No special handling for “problem detector” vs “targeted” use cases.

---

## 2. Output control (key design decision)

The only behavioral difference is **output shape**, controlled by a parameter such as:

```
output_mode = "detail_only" | "total_only" | "detail_plus_total"
```

### Semantics

* `detail_only`

  * Return per-item analysis rows only
* `total_only`

  * Return aggregated summary only
  * No per-item rows
* `detail_plus_total`

  * Return both per-item rows and aggregated summary

The **analysis logic is identical** in all cases.

---

## 3. Data sources to use

### 3.1 Realized (historical) sales — scalar velocities

Computed as **units per day**:

* `traffic_3d`
* `traffic_7d`
* `traffic_30d`
* `restock_30d`

These represent **actual historical sales**.

---

### 3.2 Planned sales — time series (NOT a scalar)

Sales plan must be returned as **monthly unit quantities**, not velocity:

```json
"plan": {
  "months": [
    { "yyyy_mm": "2026-01", "planned_units": 420 },
    { "yyyy_mm": "2026-02", "planned_units": 600 },
    { "yyyy_mm": "2026-03", "planned_units": 650 }
  ]
}
```

Important:

* No currency
* No implicit velocity
* 1–5 months ahead is sufficient

---

## 4. Derived metrics (must be computed)

### 4.1 Recent realized velocity

Compute a derived velocity such as:

* `traffic_weighted_recent`

  * weighted combination of 3d / 7d / 30d

Weights may be configurable.

---

### 4.2 Plan-derived horizon velocity

Convert plan monthly quantities into a **units/day velocity** for a specific horizon:

```
planning_horizon_days =
  lead_time_days + safety_stock_days
  OR coverage_days_override
```

Output:

* total planned units in horizon
* units_per_day_in_horizon

This value is used for **PO placement decisions**.

---

## 5. Recommended velocity (decision outputs)

For each analyzed item, the tool must return **two explicit recommendations**:

### 5.1 FBA replenishment

* Default source: recent realized demand
* Output:

  * `units_per_day`
  * `source`
  * `confidence`

### 5.2 PO placement

* Default source: plan-derived horizon velocity
* Output:

  * `units_per_day`
  * `source`
  * `planning_horizon_days`
  * `confidence`

**Important**

> These recommendations must explicitly state their source.
> Raw velocity inputs must NOT carry source metadata.

---

## 6. Diagnostics & anomaly detection (required)

For each item, detect and flag situations such as:

* plan increasing while recent sales decreasing
* large plan vs actual divergence
* sudden demand drops or spikes
* high disagreement across velocity sources
* insufficient data volume

Each issue must produce:

* alert code
* severity (`info | warn | critical`)
* human-readable explanation

---

## 7. Aggregated summary (when requested)

When `output_mode` includes totals:

* compute summary metrics **from per-item results**
* examples:

  * item count
  * alert counts by severity
  * median / average plan vs actual ratio
  * average confidence levels
  * number of high-risk items

No separate aggregation logic paths.

---

## 8. Guardrails (do NOT implement)

* ❌ No order creation
* ❌ No shipment creation
* ❌ No silent override of plan or actual data
* ❌ No single “sales velocity” without explanation
* ❌ No special logic branches for “scanner” vs “targeted”

---

## Developer summary (one paragraph)

> Implement a read-only analyzer that, for any filtered set of items, computes multiple sales velocity sources, derives plan-based horizon velocity, detects inconsistencies, and returns explainable recommended velocities for replenishment and PO placement. Item selection is filter-based; analysis is always the same; only the output shape (detail vs summary) varies.