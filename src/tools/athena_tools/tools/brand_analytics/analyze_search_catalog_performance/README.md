# Search Catalog Performance — User Guide

This tool analyzes **Brand Analytics Search Catalog Performance** to understand catalog‑level engagement and conversion by ASIN (and optionally parent ASIN). It returns KPIs, trend deltas, and simplified RYG signals to guide decisions.

## What this tool does
- Reads from **brand_analytics_search_catalog_performance_report**
- Supports **child** and **parent** ASIN rows
- Computes KPI rates and WoW / last‑4 / last‑12 deltas
- Provides 4 signals: **Strength**, **Weakness**, **Opportunity**, **Threshold**
- Adds delivery‑speed CVR comparisons (same‑day / one‑day / two‑day)

## Key KPIs
- `kpi_click_rate`
- `kpi_cart_add_rate`
- `kpi_purchase_rate`
- `kpi_sales_per_click`
- `kpi_sales_per_impression`

## Signals (RYG)
Each signal is a JSON string with `{color, code, description}`:

- **strength_signal** — engagement + conversion strength
- **weakness_signal** — engagement or conversion decline / low rates
- **opportunity_signal** — fast‑delivery uplift or scale‑traffic opportunity
- **threshold_signal** — nearing a conversion ceiling

## Filters
Common filters include:
- `company_id` (required)
- `asins` / `parent_asins`
- `marketplace`
- `row_type` (`child` or `parent`)
- `revenue_abcd_class` (defaults to A/B)
- `pareto_abc_class`
- signal color filters and trend color filters

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

### 2) Fast‑delivery opportunity only
```json
{
  "query": {
    "filters": {
      "company_id": [103],
      "opportunity_colors": ["green"]
    },
    "aggregation": {
      "time": { "periods_back": 4 }
    }
  }
}
```

### 3) Red trend in conversion
```json
{
  "query": {
    "filters": {
      "company_id": [103],
      "purchase_trend_colors": ["red"]
    },
    "aggregation": {
      "time": { "periods_back": 6 }
    }
  }
}
```

## Notes
- `company_id` is required for security and partition pruning.
- Trend signals use ±2% thresholds across WoW / last‑4 / last‑12.
- Snapshot refresh weekly for consistent trend analysis.
