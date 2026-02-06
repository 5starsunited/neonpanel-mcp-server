# Search Query Performance (SQP) — User Guide

This tool analyzes Amazon Brand Analytics **Search Query Performance** using a precomputed snapshot table. It returns KPI metrics, trend deltas, and four high‑level signals to quickly interpret performance.

## What this tool does
- Reads from the **search_query_performance_snapshot** table
- Supports **child** and **parent** ASIN analysis
- Provides **KPI metrics** and **WoW / last 4 weeks / last 12 weeks** deltas
- Outputs four simplified signals: **Strength**, **Weakness**, **Opportunity**, **Threshold**

## When to use it
- Weekly performance checks by query
- Identify visibility vs. conversion problems
- Find growth opportunities with strong CTR but low impressions
- Detect ceiling effects when visibility is already maxed

## Key KPIs returned
- `kpi_impression_share`
- `kpi_click_share`
- `kpi_cart_add_rate`
- `kpi_purchase_rate`
- `kpi_ctr_advantage`

Trend deltas are returned for each KPI:
- `*_wow`
- `*_wolast4`
- `*_wolast12`

## Signals (RYG)
Each signal is a JSON string with `{color, code, description}`:

- **strength_signal** — overall performance strength
- **weakness_signal** — likely root cause (visibility loss, offer weakness, funnel leakage, intent mismatch)
- **opportunity_signal** — growth potential (visibility gap)
- **threshold_signal** — visibility ceiling detection

## Filters
Common filters include:
- `company_id` (required)
- `search_terms`
- `parent_asins` / `asins`
- `marketplace`
- `row_type` (`child` or `parent`)
- `revenue_abcd_class` (defaults to A/B)
- `pareto_abc_class`
- signal color filters (`strength_colors`, `weakness_colors`, `opportunity_colors`, `threshold_colors`)

## Example requests
### 1) Parent‑level weekly scan (default A/B)
```json
{
  "query": {
    "filters": {
      "company_id": [103],
      "row_type": ["parent"]
    },
    "aggregation": {
      "time": { "periods_back": 8 }
    },
    "limit": 100
  }
}
```

### 2) Only red weaknesses in US
```json
{
  "query": {
    "filters": {
      "company_id": [103],
      "marketplace": ["US"],
      "weakness_colors": ["red"]
    },
    "aggregation": {
      "time": { "periods_back": 4 }
    },
    "limit": 200
  }
}
```

### 3) Specific query + child ASIN
```json
{
  "query": {
    "filters": {
      "company_id": [103],
      "search_terms": ["donut pillow"],
      "asins": ["B0B61478T9"],
      "row_type": ["child"]
    },
    "aggregation": {
      "time": { "start_date": "2024-10-01", "end_date": "2024-12-31" }
    }
  }
}
```

## Notes
- `company_id` is required for security and partition pruning.
- Signal thresholds can be tuned in the SQL without changing the snapshot.
- Snapshot should be refreshed weekly for best accuracy.
