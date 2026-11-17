# Supply Chain Replenishment Tools — Calculation Guide

This guide documents the exact calculation algorithms used by the supply-chain
replenishment MCP tools. Last verified against the code on **2026-07-03**.

Tools covered:

| Tool | Purpose |
|---|---|
| `supply_chain_list_po_placement_candidates` | When to place a supplier purchase order (PO) |
| `supply_chain_list_fba_replenishment_candidates` | When to ship replenishment into FBA |
| `supply_chain_list_stock_replenishment_risk_items` | Stockout / days-of-supply risk with probabilistic inbound arrival |
| `supply_chain_list_fulfillment_warehouses` | Which own (non-FBA) warehouses fulfil invoices, with volume, channels and lead-time history |
| `supply_chain_list_warehouse_restock_candidates` | When and how much to ship (or assemble) into a non-FBA fulfillment warehouse |

The planned-velocity logic is intentionally aligned with the
**"60.0 Inventory Planning" QuickSight analysis** (fields `ArrivalMonthIndex`,
`EffectiveCoverageMonths`, `TotalDemandCoverage`, `CoverageDays`) so both
surfaces report comparable numbers. Intentional differences are listed at the
end of this document.

---

## 1. Data sources

| Source | Contents | Freshness |
|---|---|---|
| `inventory_planning.inventory_planning_snapshot_iceberg` | Per-SKU snapshot: realized daily averages (`avg_units_30d/7d/3d`), Amazon restock report fields (`available`, `inbound`, `fc_transfer`, `fc_processing`, `units_sold_last_30_days`), warehouse balances, planning parameters (`lead_time_days`, `safety_stock_days`, `fba_lead_time_days`, `fba_safety_stock_days`, `daily_unit_sales_target`) | Latest snapshot partition (year/month/day) is selected automatically |
| `fc_forecasting_prod.fc_sales_forecast_iceberg` | Monthly sales plan (`units_sold` per `forecast_period`) | Latest forecast run per company/inventory: highest `calc_period`, then highest `updated_at`; rows with `dataset = 'actual'` are excluded. The first 12 forecast months are used (`plan_monthly_units`). |

Realized daily averages in the snapshot (`avg_units_30d` etc.) are computed
upstream from `sp_api.sales_and_traffic_by_sku_daily` and **average only over
in-stock days** (days where the Amazon restock report shows `available > 0`),
so out-of-stock periods do not deflate the demand rate.

---

## 2. Sales velocity (units/day)

Every recommendation is driven by a daily sales velocity. The mode is chosen
with the `sales_velocity` input parameter.

### 2.1 `current` — realized demand

**PO tool** (default: `planned`):

```
current_units_per_day = COALESCE(avg_units_30d,
                                 units_sold_last_30_days / 30.0,
                                 0)
```

Plain trailing 30-day average (in-stock days only), falling back to the Amazon
restock report total divided by 30. This matches the QuickSight
`Actual Daily Sales` field exactly.

**FBA tool** (default: `current`):

```
current_units_per_day = weight_30d * avg_units_30d
                      + weight_7d  * avg_units_7d
                      + weight_3d  * avg_units_3d
```

Default weights are **0.5 / 0.3 / 0.2** (30d/7d/3d), so recent 7-day and 3-day
trends adjust the 30-day baseline. Override with the `velocity_weighting`
input:

```json
{ "velocity_weighting": { "weight_30d": 1, "weight_7d": 0, "weight_3d": 0 } }
```

`1/0/0` reproduces the plain 30-day average used by the QuickSight dashboard.
The resolved weights are always returned in `meta.velocity_weighting_used` and
restated in each row's `reason` field — **AI clients should tell the user which
weights were applied and that custom weights can be supplied.**

### 2.2 `target` — manual goal

```
sales_velocity = daily_unit_sales_target
```

The manually maintained units/day target from the inventory item settings.

### 2.3 `planned` — forecast, arrival-anchored window average

Uses the monthly sales plan, anchored to when the replenishment actually
arrives rather than to today. This mirrors the QuickSight
`ArrivalMonthIndex` / `EffectiveCoverageMonths` / `Planned Daily Unit Sales`
calculation.

Step 1 — arrival month (1-based index into the 12-month plan):

```
arrival_month_index = 1 + floor(lead_time_days / 30)
-- clamped to [1, length(plan_monthly_units)]
```

The PO tool uses `lead_time_days`; the FBA tool uses `fba_lead_time_days`.

Step 2 — window length in months:

```
window_months = round((lead_time_days + safety_stock_days) / 30.41)
-- clamped to >= 1 and to the months remaining in the plan
-- after the arrival month
```

Step 3 — velocity:

```
sales_velocity = sum(plan_monthly_units[arrival_month_index
                                        .. arrival_month_index + window_months - 1])
               / (window_months * 30.41)
```

Rationale: a single forecast month is noisy; a window starting at "now" covers
months the current stock already serves. Averaging a multi-month window that
*starts at arrival* both smooths forecast noise and prices in seasonality for
the period the new inventory will actually be selling.

Diagnostics returned by the PO tool:

- `forecast_month_index` — the arrival month index (window start),
- `forecast_units_extracted` — total plan units summed over the window.

Invariant for verification:
`forecast_units_extracted / sales_velocity == window_months * 30.41`.

Worked example (company 230, validated on prod Athena):
`lead_time_days = 90`, `safety_stock_days = 18` → arrival month `4`
(`1 + floor(90/30)`), window `4` months (`round(108/30.41) = 4`), so velocity =
(sum of forecast months 4–7) / 121.64.

Note: with only 12 forecast months available, SKUs with lead times ≥ ~330 days
degrade to a 1-month window at the last plan month.

---

## 3. PO placement (`supply_chain_list_po_placement_candidates`)

### 3.1 Available inventory

```
total_available_inventory_units =
    total_balance_quantity        -- own warehouse balances (FBA warehouses excluded
                                  --   to avoid double counting with `available`)
  + available                     -- FBA sellable units (Amazon restock report)
  + wip_total_ordered_quantity    -- every order in progress; only if
                                  --   include_work_in_progress=true (default).
                                  --   total_ordered_quantity is NOT added: WIP
                                  --   already covers it (adding both double-counts)
```

Inbound/in-transit units are deliberately **not** counted here (they are
represented in warehouse balances as "In Transfer").

### 3.2 Coverage target

```
effective_safety_stock  = safety_stock_days * ss_multiplier   (class-based, default 1)
target_coverage_days    = lead_time_days + effective_safety_stock + days_between_pos
```

`ss_multiplier` is the revenue-class safety-stock multiplier (A/B/C/D) resolved
per item by the ETL from company settings. `days_between_pos` (PO cadence,
default **30**) adds one reorder cycle of buffer. When `override_default=true`,
the `*_override` inputs replace the per-item parameters and are used as-is
(no multiplier).

Items with missing/zero `lead_time_days` or `safety_stock_days` fall back to
**90 / 60 day defaults** (the same constants the QuickSight 70.0 dataset uses).
`lead_time_days_source` / `safety_stock_days_source` report which path was
taken (`item`, `default_90`/`default_60`, `override`) — AI clients should tell
the user when a default was applied so real values get configured.

### 3.3 Outputs

```
po_days_of_supply      = round(total_available_inventory_units / sales_velocity)
                         (NULL when velocity <= 0)

po_due_in_days         = po_days_of_supply - target_coverage_days
                         (negative => overdue)

po_overdue_days        = max(0, -po_due_in_days)

po_due_date            = CURRENT_DATE + max(0, po_due_in_days)
                         (clamped to today when overdue)

recommended_order_units = ceil(max(0,
    target_coverage_days * sales_velocity
    - total_available_inventory_units))
```

`recommended_order_units` is a standard order-up-to level and uses the same
formula in **all** velocity modes; in `planned` mode the arrival-anchored
window velocity carries the seasonality.

**MOQ**: a positive quantity below the supplier `moq` is bumped up to the MOQ
(the `moq` value is returned per item). Because the tool always plans from the
live snapshot, the MOQ excess shows up in WIP once the order is placed and all
subsequent recommendations adjust automatically — no schedule-level carry-over
is needed. (The QuickSight 70.0 schedule handles the same rule by stretching
the interval between POs to `moq / daily_rate` days.)

Priority: `critical` when `po_due_in_days <= stockout_threshold_days`
(default 7), `low` when velocity ≤ 0, else `high`.

### 3.4 Revenue ABCD class

Items are classified per company+marketplace by cumulative share of 30-day
revenue (`sales_last_30_days`), sorted descending: **A** = top 80%, **B** =
80–95%, **C** = 95–99%, **D** = rest / zero revenue. Filterable via
`revenue_abcd_class`.

---

## 4. FBA replenishment (`supply_chain_list_fba_replenishment_candidates`)

### 4.1 Available FBA inventory

```
total_fba_available_units = inbound + available + fc_transfer + fc_processing
```

All four are Amazon-reported (restock report). `fba_quantity_in_transit` is a
NeonPanel control metric used elsewhere for validating Amazon's inbound number.

### 4.2 Coverage target

```
target_coverage_days = fba_lead_time_days + fba_safety_stock_days
                     + days_between_shipments
```

`days_between_shipments` (shipment cadence, default **14**).

### 4.3 Outputs

Same shapes as the PO tool, against FBA quantities:

```
fba_days_of_supply     = round(total_fba_available_units / sales_velocity)
shipment_due_in_days   = fba_days_of_supply - target_coverage_days
shipment_overdue_days  = max(0, -shipment_due_in_days)   (alias: days_overdue)
shipment_due_date      = CURRENT_DATE + max(0, shipment_due_in_days)

recommended_ship_units = max(0, ceil(
    target_coverage_days * sales_velocity - total_fba_available_units))
```

`recommended_by_amazon_replenishment_quantity` passes through Amazon's own
recommendation for comparison.

---

## 5. Stock replenishment risk (`supply_chain_list_stock_replenishment_risk_items`)

Uses a weighted realized velocity (same `velocity_weighting` convention,
defaults 0.5/0.3/0.2; presets: `conservative` 0.7/0.2/0.1, `aggressive`
0.2/0.3/0.5):

```
weighted_velocity = w30 * avg_units_30d + w7 * avg_units_7d + w3 * avg_units_3d
dos_fba           = current_fba_stock / weighted_velocity   (999 when velocity <= 0)
```

where `current_fba_stock = available + fc_transfer + fc_processing` (no
inbound). Risk tiers compare days of supply against probabilistic inbound
arrival days (p50/p80/p95) and against `min_days_of_supply` (default 28).

---

## 5a. Fulfillment warehouses (`supply_chain_list_fulfillment_warehouses`)

Source: ClickHouse `etl.fulfillment_warehouses` (migration 0088). A
fulfillment warehouse is a warehouse referenced by invoice stock outflows
(Invoice V1/V2 documents in the company FIFO mode in
`app.inventory_transactions_v3`) — Shopify, wholesale, other channels and FBM
Amazon orders.

```
is_planning_eligible_type = NOT (name starts with 'Amazon FBA' OR name = 'Lost & Found'
                                 OR type IN (FBA, AWD, Transit, Transfer, Lost & Found)
                                 OR deleted)
is_fulfillment            = is_planning_eligible_type AND units_sold_90d > 0
```

Default output is `is_fulfillment = 1` rows only, ordered by `units_sold_90d`
desc; `include_non_eligible = true` returns every invoice-referenced
warehouse. Each row carries `sales_channels_90d` (from the invoice sales
channel), 30/90-day units and lead-time history (`lead_time_events_365d`,
`median_lead_time_days`, `p80_lead_time_days`) plus the planning defaults
(lead time 30, safety stock 10, cadence 14).

---

## 5b. Warehouse restock (`supply_chain_list_warehouse_restock_candidates`)

Source: ClickHouse `etl.inventory_planning_warehouse`, grain company ×
fulfillment warehouse × top-level inventory item. The view stores outputs for
the default parameters; the tool recomputes them from the raw columns so every
input parameter takes effect. FBA is out of scope (see section 4).

### 5b.1 Velocity

```
current = (w30*avg_units_30d + w7*avg_units_7d + w3*avg_units_3d) / (w30 + w7 + w3)
          defaults 0.5 / 0.3 / 0.2 (velocity_weighting)
planned = planned_units_arrival_month / days_in_arrival_month
          planned_units_arrival_month = sum over channels of
            channel forecast (month of today + lead_time) x warehouse share of that channel
            (90-day item-level share, else company-level share)
target  = daily_unit_sales_target
rate    = mode rate + dependent_daily_units   (component demand of assemblies built here)
```

Realized averages are invoice outflows at that warehouse (calendar days, no
in-stock adjustment). `velocity_by_channel` is the 30-day unit split per sales
channel; `sales_channels` keeps rows whose 30-day split contains any given
channel (case-insensitive). `dependent_daily_units` is taken from the view
(parent velocity blended with the default 0.5/0.3/0.2 weights). With
`planned`, `lead_time_days_override` does not move the forecast month (the
view picks it with its own lead time); the tool warns about this.

### 5b.2 Parameters

```
lead_time_days        = item median (>= 3 shipment/PO events into the warehouse in 365 days)
                        else warehouse median (>= 3 events) else 30
                        source: history_item | history_warehouse | default | override
safety_stock_days     = 10 (or safety_stock_days_override), source default | override
safety_stock_days_eff = safety_stock_days (flat 10 days in v1; ss_multiplier is informational)
rate (current)        = 0.5/0.3/0.2 blend of 30/7/3-day invoice units, or units_90d / 90 when units_30d = 0
cadence               = days_between_shipments (default 14)
```

Lead-time events: arrived shipments (min(created, shipped) -> arrived) and
received purchase orders (PO date -> received) into the warehouse.

### 5b.3 Outputs

```
available            = on_hand + in_transit + open_po
effective_available  = available + buildable_at_wh_units (assembled at this warehouse only)
days_of_supply       = effective_available / rate             (99999 when rate <= 0)
ship_due_in_days     = floor(days_of_supply - safety_stock_days_eff - lead_time_days)
ship_due_date        = today + max(0, ship_due_in_days);  days_overdue = max(0, -ship_due_in_days)
need                 = max(0, rate x (lead_time + safety_stock_eff + cadence) - effective_available)
recommended_ship_qty = ceil(need / box_quantity) x box_quantity (ceil(need) without box qty);
                       0 when assembled at the warehouse
recommended_assembly_units = ceil(need) when assembled at the warehouse, else 0
priority             = no_demand (rate <= 0) | critical (due <= 0)
                       | high (due <= stockout_threshold_days, default 7)
                       | normal (due <= cadence) | ok
```

Rows are sorted by priority severity, then `ship_due_in_days` ascending.
`planning_base`: `needs_replenishment` (default; ship or assembly qty > 0),
`actively_sold_only` (units sold in 30 days or component demand), `all`.
`planning_source` is `SHIP`, `ASSEMBLE_AT_WAREHOUSE` (assembly orders at this
warehouse in 365 days) or `COMPONENT` (needed only as a component here;
`include_components = false` drops these). `typical_origin_warehouse_*` and
`origin_on_hand_units` show the usual shipment source and its stock.

When no rows come back and the company has no fulfillment warehouse,
`meta.warnings` points to `supply_chain_list_fulfillment_warehouses`.

---

## 6. Parity with the QuickSight "60.0 Inventory Planning" analysis

| Aspect | QuickSight | MCP tools | Note |
|---|---|---|---|
| Actual/current daily sales | "By actual sales data": `coalesce(avg_units_30d, Units Sold Last 30 Days/30)` | PO tool `current`: identical. FBA tool `current`: blended — pass `velocity_weighting` `1/0/0` to match this mode | |
| Blended daily sales | "By actual blended 30/7/3 days": `(blended30d*avg_30d + blended7d*avg_7d + blended3d*avg_3d) / sum(weights)`, defaults 50/30/20; falls back to actual daily sales when `avg_units_30d` is null | FBA tool `current` with default `velocity_weighting` 0.5/0.3/0.2: same blend (nulls treated as 0, no whole-field fallback) | defaults aligned on both surfaces |
| Planned daily sales | window average anchored at arrival month (`ArrivalMonthIndex`, ~30.41-day months) | identical algorithm | QuickSight plan series holds 6 months; MCP uses 12 |
| Days of supply | `Available Quantity / rate`, `99999` when rate = 0 | same division, `NULL` when rate ≤ 0 | sentinel differs |
| Due-date threshold | `days_of_supply − safety_stock − lead_time` | additionally subtracts reorder cadence (`days_between_pos` 30 / `days_between_shipments` 14) | **MCP flags items due ~2–4 weeks earlier by design** — set the cadence parameter to `0` for dashboard-comparable output |
| Inbound in the numerator | switchable via the `IncludeInbound` control | PO tool: never counts inbound; FBA tool: always counts `inbound` | fixed composition per tool |

---

## 7. Change log

- **2026-11-17** — Added `supply_chain_list_fulfillment_warehouses` and
  `supply_chain_list_warehouse_restock_candidates` (non-FBA warehouse
  replenishment on ClickHouse `etl.fulfillment_warehouses` /
  `etl.inventory_planning_warehouse`, migration 0088). See sections 5a and 5b.

- **2026-07-03** — `planned` velocity re-anchored from a single forecast month
  (FBA: month 1; PO: arrival month only) to an arrival-anchored multi-month
  window average (`sum(window) / (window_months * 30.41)`), matching the
  QuickSight analysis. `recommended_order_units` unified to
  `target_coverage_days × velocity − available` in all modes. FBA `current`
  blend weights exposed as `velocity_weighting` (defaults unchanged) and
  reported back in `meta.velocity_weighting_used` and each row's `reason`.
