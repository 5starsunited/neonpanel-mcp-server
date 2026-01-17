# Forecasting Improvement Plan

**Scope focus (Phase 1):** schema standardization + write tool replace mode + scenario naming. Historical actuals tooling is explicitly out of scope (separate tool set).

## Goals
1) Standardize forecast JSON schema across list/compare tools (period-based, no month index).
2) Add write tool replace mode and user-defined scenario naming.
3) Preserve backward compatibility where possible (default append mode).

---

## Phase 1 (Immediate) — Schema + Write Improvements

### P0: Canonical forecast row schema
- **Row shape** (forecast + actual):
  - `series_type` (forecast|actual)
  - `period` (YYYY-MM)
  - `units_sold`
  - `unit_price`
  - `sales_amount`
  - `currency` (row-level)
  - `seasonality_index`
  - `seasonality_label`
  - `scenario_name` (forecast rows)
  - `run_updated_at` (forecast rows)
  - `unit_price_source`
- **List tool** returns `forecast_series[]` (forecast-only rows) with `forecast_horizon_start`, `forecast_horizon_end`, `forecast_run_period`, `forecast_run_updated_at`.
- **Compare tool** aligns to the same row schema.

### P0: Write tool replace mode + scenario naming
- Add input: `write_mode: append | replace` (default append).
- Replace mode deletes existing rows for `(company_id, sku, marketplace, forecast_period, scenario_uuid)` prior to insert.
- Force **dataset = "manual"** for all writes.
- Store **user-provided scenario name** into `scenario_uuid` (per requirement).
- Update tool docs to clarify behavior.

---

## Phase 2 (Next)

### P1: Unit price support in responses
- Add `unit_price` + `unit_price_source` to list/compare outputs.
- Accept `unit_price` in write tool and validate `sales_amount`.

### P1: Hierarchical grouping
- Support `group_by: ["product_family", "sku"]` to return subtotal + SKU rows.

---

## Out of Scope (Separate Tools)
- Historical actuals and bulk actuals export.
- Seasonality index computation based on historical actuals (separate tool set).
- Actuals data lag metadata.

---

## Acceptance Criteria (Phase 1)
- List/compare tools return period strings (`YYYY-MM`) instead of month index.
- Write tool supports replace mode and scenario naming per requirement.
- Dataset field fixed to `manual` in writes; scenario name stored in `scenario_uuid`.
- No breaking changes for existing append workflows.
