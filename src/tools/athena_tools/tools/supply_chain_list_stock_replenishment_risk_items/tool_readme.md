# Supply Chain: Stock Replenishment Risk Analysis Tool

## Overview

The **Stock Replenishment Risk Analysis** tool identifies inventory items at risk of stockout or insufficient days-of-supply. It analyzes current FBA inventory, warehouse stock, inbound shipments with probabilistic arrival timelines, and sales velocity trends to provide actionable replenishment recommendations.

This tool is essential for supply chain teams to proactively manage inventory positions, avoid stockouts, and optimize replenishment decisions before critical supply situations arise.

## Key Features

### Dual Risk Dimensions
The tool analyzes two independent risk factors:

1. **Stockout Risk**: Will physical FBA inventory run out before inbound arrives?
   - Accounts for 50th, 80th, and 95th percentile arrival scenarios
   - Helps teams understand worst-case supply depletion

2. **Days-of-Supply Buffer Risk**: Is inventory below minimum target days?
   - Compares available supply + inbound against configurable minimum threshold (default: 28 days)
   - Ensures safety stock for demand fluctuations

### Probabilistic Arrival Analysis
- Inbound shipments are modeled with three confidence levels: p50 (median), p80, and p95
- Each level calculates distinct days-of-supply scenarios
- Accounts for delivery delays via configurable buffer (default: 0 days)
- Provides visibility into risk sensitivity across supply timing

### Weighted Sales Velocity
- Combines three precalculated windows: 30-day (trend), 7-day (recent), 3-day (spikes)
- Three preset modes:
  - **Balanced** (0.5/0.3/0.2): Default long-term focus with recent trend weighting
  - **Conservative** (0.7/0.2/0.1): Heavy long-term bias, dampens recent spikes
  - **Aggressive** (0.2/0.3/0.5): Emphasizes recent demand surges, good for volatile products
- Customizable weights for tailored risk profiles

### Actionable Replenishment Guidance
- **Warehouse Transfer Options**: Ranked list of warehouse sources with available quantity, lead times, and buffer impact
- **Purchase Order Recommendations**: Suggested PO quantity with urgency tier (immediate/urgent/soon/planned)
- **Critical Velocity Thresholds**: Velocity benchmarks (units/day) at which items transition between risk tiers
- **Integrated with PO Placement Tool**: Recommendations link directly to purchase order execution workflow

### Enterprise Inventory Scope
- Default filter: Revenue class A+B items (80% of sales value)
- Supports filtering by: brand, product family, ASIN, SKU, marketplace, revenue class
- Scoped authorization: Results limited to user's permitted companies
- Partition-aware queries: Automatic data pruning for performance

## Use Cases

### 1. Daily Inventory Health Check
Supply chain manager runs tool at start of shift:
```
Company: 42, Revenue class: A+B (default)
Filter: All high/moderate risk items
Output: 5 items need attention
```
→ Identify critical issues before they impact customer service

### 2. Proactive Replenishment Planning
Demand planner uses aggressive velocity weighting to catch rapid demand surges:
```
Velocity mode: aggressive
Min days-of-supply: 28
Supply buffer risk: high + moderate
```
→ Catch surging items before they turn critical

### 3. Warehouse Rebalancing
Logistics team checks warehouse options to avoid PO placement delays:
```
Include warehouse stock: true
Include inbound details: true
```
→ Route emergency transfers from nearby warehouses

### 4. Seasonal Prep Planning
Planning manager reviews upcoming Q4 with conservative velocity (dampens short-term noise):
```
Velocity mode: conservative
Min days-of-supply: 60 (seasonal buffer)
Revenue class: A+B+C (expanded scope)
```
→ Ensure adequate supply for holiday demand ramp

### 5. Low-Velocity Tail Management
Supply chain analyst monitors D-class items with minimal risk:
```
Revenue class: D (override default)
Supply buffer risk: ok (exclude critical/moderate)
```
→ Optimize cash flow by reducing safety stock on slow movers

## How It Works

### Data Sources
- **Inventory Planning Snapshot**: Latest FBA stock, warehoused units, sales history (30d/7d/3d windows)
- **FBA Inbound Shipments JSON**: Shipment details with p50/p80/p95 arrival likelihood in days
- **Warehouse Stock Tables**: Non-FBA inventory availability and lead times
- **Revenue Classification**: Precalculated ABCD segments based on 30-day sales

### Analysis Pipeline

1. **Snapshot Selection**: Fetch latest inventory partition for authorized companies
2. **Inventory Aggregation**: Combine FBA stock (available + fc_transfer + fc_processing) + warehouse stock
3. **Inbound Parsing**: Extract shipment counts, quantities, and arrival confidence levels
4. **Velocity Weighting**: Apply user-configured weights to 30d/7d/3d windows
5. **Days-of-Supply Calculation**: Compute three scenarios (p50/p80/p95) accounting for inbound arrivals
6. **Risk Classification**: Assign stockout risk and buffer risk tiers based on calculated days-of-supply
7. **Velocity Thresholds**: Derive critical velocity benchmarks (units/day) for each risk boundary
8. **Warehouse Ranking**: Identify viable warehouse transfers and PO alternatives
9. **Output Enrichment**: Add recommendations and risk summary

### Risk Tier Definition

#### Stockout Risk (Physical Inventory Depletion)
- **High**: `days_of_supply(p50) < 0` – Will stockout even at median inbound arrival
- **Moderate**: `days_of_supply(p50) ≥ 0` but `days_of_supply(p80) < 0` – Risky if inbound is delayed
- **Low**: `days_of_supply(p80) ≥ 0` but `days_of_supply(p95) < 0` – Only at-risk in optimistic scenarios
- **OK**: `days_of_supply(p95) ≥ 0` – All scenarios positive, healthy position

#### Days-of-Supply Buffer Risk (Below Minimum Threshold)
- **High**: `days_of_supply(p50) < min_days_of_supply` – Below target even at median
- **Moderate**: `days_of_supply(p50) ≥ min_days` but `days_of_supply(p80) < min_days` – At risk if delayed
- **Low**: `days_of_supply(p80) ≥ min_days` but `days_of_supply(p95) < min_days` – Marginal in pessimistic scenarios
- **OK**: `days_of_supply(p95) ≥ min_days` – All scenarios above target

### Velocity Weighting Modes

**Balanced (0.5 / 0.3 / 0.2)** [Default]
- Recommended for: Most inventory decisions, standard demand patterns
- Behavior: Long-term trend dominates, recent activity modulates

**Conservative (0.7 / 0.2 / 0.1)**
- Recommended for: Seasonal items, high-value SKUs, supply-constrained markets
- Behavior: Dampens spikes, assumes recent surges are temporary

**Aggressive (0.2 / 0.3 / 0.5)**
- Recommended for: Fast-moving items, trend-sensitive categories, viral products
- Behavior: Emphasizes recent velocity, reacts quickly to demand changes

**Custom Weights**
- Set individual weights for fine-tuned risk profiles (must sum to 1.0 for optimal interpretation)

## Input Parameters

### Query Filters (Optional)
- `company_id` (required): Numeric company identifier
- `sku`, `asin`, `parent_asin`: SKU or product ASIN filters (array, OR logic)
- `brand`, `product_family`: Product grouping filters
- `marketplace` (or `country_code`): Geographic filters
- `revenue_abcd_class`: Revenue tiers (default: A+B for high-impact focus)

### Risk Analysis Settings (Tool-Specific)
- `min_days_of_supply`: Target minimum days of supply (default: 28)
- `p80_arrival_buffer_days`: Safety buffer applied to inbound estimates (default: 0, range: 0–30)
- `include_warehouse_stock`: Include non-FBA inventory in supply calc (default: true)
- `include_inbound_details`: Include detailed FBA inbound info (default: true)
- `velocity_weighting_mode`: Preset mode (balanced/conservative/aggressive) or custom weights
- `stockout_risk_filter`: Return only specific stockout risk tiers
- `supply_buffer_risk_filter`: Return only specific buffer risk tiers

### Output Controls
- `sort`: Sort by field (e.g., days_of_supply_p80, stockout_risk_tier) and direction
- `limit`: Max items to return (default: 50, max: 500)
- `select_fields`: Project specific output columns (optional)

## Output Structure

### Per-Item Fields

**Inventory Identity**
- `inventory_id`, `sku`, `child_asin`, `parent_asin`, `brand`, `product_family`, `product_name`, `country_code`

**Stock Levels**
- `current_fba_stock`: Available FBA units (ready-to-ship + in-transfer + processing)
- `warehouse_stock`: Non-FBA warehouse/3PL units (if `include_warehouse_stock=true`)
- `total_available_stock`: Sum of FBA and warehouse stock

**Sales Velocity**
- `sales_velocity_30d`, `sales_velocity_7d`, `sales_velocity_3d`: Units per day (precalculated windows)
- `weighted_velocity`: Blended velocity per user's weighting mode

**Inbound Supply**
- `inbound_units`: Total units in active FBA shipments
- `inbound_p50_days`, `inbound_p80_days`, `inbound_p95_days`: Arrival likelihood (days)
- `inbound_shipment_count`: Number of in-flight shipments

**Days-of-Supply Scenarios**
- `days_of_supply_p50`: DOS at 50th percentile (median) inbound arrival
- `days_of_supply_p80`: DOS at 80th percentile inbound arrival
- `days_of_supply_p95`: DOS at 95th percentile (optimistic) arrival

**Risk Classification**
- `stockout_risk_tier`: high / moderate / low / ok
- `supply_buffer_risk_tier`: high / moderate / low / ok

**Critical Velocity Thresholds**
- `stockout_critical_velocity`: {p50_units_per_day, p80_units_per_day, p95_units_per_day}
  - Velocity (units/day) at which physical stockout occurs
- `supply_buffer_critical_velocity`: {p50_units_per_day, p80_units_per_day, p95_units_per_day}
  - Velocity at which inventory falls below min_days_of_supply target

**Replenishment Guidance**
- `warehouse_replenishment_options`: Array of warehouses with available qty, lead time, and buffer impact
- `purchase_order_recommendation`: {recommended_po_qty, rationale, urgency, lead_time_estimate_days}
- `recommendation`: Human-readable action summary

### Metadata
- `risk_distribution`: Counts by risk tier for both dimensions
- `applied_sort`: Sort parameters used
- `included_fields`: List of returned columns
- `warnings`: Non-fatal issues (e.g., unsupported filters)

## Examples

### Example 1: Critical Items (High Stockout Risk)
```json
{
  "query": {
    "filters": {
      "company_id": 42,
      "revenue_abcd_class": ["A", "B"]
    },
    "limit": 20
  },
  "tool_specific": {
    "stockout_risk_filter": ["high"]
  }
}
```
→ Returns 3 items that will stockout within 24 hours even at median inbound arrival

### Example 2: Approaching Minimum Buffer (Proactive Planning)
```json
{
  "query": {
    "filters": {
      "company_id": 42,
      "brand": ["Nike", "Adidas"]
    },
    "sort": {
      "field": "days_of_supply_p80",
      "direction": "asc"
    },
    "limit": 50
  },
  "tool_specific": {
    "min_days_of_supply": 28,
    "velocity_weighting_mode": "balanced",
    "supply_buffer_risk_filter": ["high", "moderate"]
  }
}
```
→ Returns items below 28-day buffer sorted by urgency; sorted by increasing DOS for prioritization

### Example 3: Aggressive Velocity Mode (High-Growth Items)
```json
{
  "query": {
    "filters": {
      "company_id": 42,
      "product_family": ["Electronics", "Accessories"]
    },
    "limit": 30
  },
  "tool_specific": {
    "velocity_weighting_mode": "aggressive",
    "include_warehouse_stock": true,
    "p80_arrival_buffer_days": 2,
    "supply_buffer_risk_filter": ["high"]
  }
}
```
→ Returns fast-moving items with high buffer risk (emphasizing recent velocity spikes); includes warehouse alternatives; assumes 2-day delivery safety margin

### Example 4: Warehouse Rebalancing Check
```json
{
  "query": {
    "filters": {
      "company_id": 42
    },
    "limit": 15
  },
  "tool_specific": {
    "include_warehouse_stock": true,
    "include_inbound_details": true,
    "stockout_risk_filter": ["high", "moderate"]
  }
}
```
→ Returns items at stockout/moderate risk with full warehouse stock visibility and inbound ETA; supports emergency transfer planning

## Integration with Other Tools

### Supply Chain: Place Purchase Order
When `warehouse_replenishment_options` are insufficient, use the PO placement tool to execute recommended purchase orders.
- Input: `purchase_order_recommendation` from this tool
- Output: PO confirmation and supplier lead time commitment

### Supply Chain: Warehouse Transfer Optimization
Warehouse options provided by this tool can be routed to the transfer optimization tool for cost/time balancing.
- Input: `warehouse_replenishment_options`
- Output: Optimal transfer route and timing

### Forecasting: List Latest Sales Forecast
Cross-reference replenishment items with current forecast to detect demand changes:
- Filter by items flagged as high/moderate risk
- Compare forecast vs. historical velocity trends

### Forecasting: Compare Sales Forecast Scenarios
Use scenario comparison to validate PO quantities against demand scenarios:
- Input: SKU + risk tier
- Output: Scenario-based supply adequacy assessment

## Best Practices

1. **Daily Health Checks**: Run at start of shift focused on high/moderate items to catch emerging issues
2. **Velocity Mode Selection**: Match to your inventory profile:
   - Standard/seasonal → balanced
   - High-value/constrained → conservative
   - Fast-moving/trendy → aggressive
3. **Buffer Day Tuning**: Increase `p80_arrival_buffer_days` if suppliers frequently miss estimated arrivals
4. **Warehouse Integration**: Always include warehouse stock for emergency response planning
5. **Revenue Class Filtering**: Focus on A+B by default; weekly reviews of C; monthly of D
6. **Metric Trending**: Track risk_distribution over time to identify systemic supply issues
7. **PO Automation**: Feed critical/urgent recommendations to automated PO workflows

## Performance Notes

- Queries optimized for partition pruning (company_id filtering required)
- Results capped at 500 items; use filters to narrow scope if needed
- Typical query time: <5 seconds for 50-item result set
- Large scopes (all items, company-wide): 10–30 seconds

## Support & Questions

For questions on replenishment logic, velocity weighting, or integration, contact your Supply Chain Analytics team.
