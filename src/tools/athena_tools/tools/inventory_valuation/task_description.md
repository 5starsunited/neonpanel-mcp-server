# AI Client Test Task: Inventory Valuation Actual vs Calculated Audit

Use this task in an MCP-capable AI client after deployment to verify the inventory valuation tools work together and that the tool descriptions guide the model to the right tool for each job.

## Goal

Validate the full inventory valuation workflow:

1. `inventory_valuation_analyze_inventory_value` returns NeonPanel calculated FIFO inventory quantity and value.
2. `inventory_valuation_analyze_3pl_inventory` returns actual/source-side inventory quantities from `neonpanel_iceberg.inventory_balances`.
3. `inventory_valuation_audit_inventory_balances` compares actual/source quantities against calculated FIFO quantities and flags discrepancies or missing data.

## Test Prompt For The AI Client

Run an inventory reconciliation for company `61` on `2023-03-04`.

Use the inventory valuation tools to answer these questions:

1. What is the NeonPanel calculated inventory quantity and value by destination warehouse for company `61` as of `2023-03-04`?
2. What actual/source inventory quantity was reported in `inventory_balances` by warehouse and source for company `61` on `2023-03-04`?
3. Compare actual/source quantities to calculated FIFO quantities by SKU and warehouse for the same date.
4. Return only rows needing review first, then provide a short summary of matched vs missing vs discrepant data.
5. Explain which tool was used for calculated data, which tool was used for actual/source data, and which tool performed the audit comparison.

## Suggested Tool Calls

Call `inventory_valuation_analyze_inventory_value` with:

```json
{
  "query": {
    "filters": {
      "company_id": [61]
    },
    "aggregation": {
      "group_by": ["destination_warehouse"],
      "time": {
        "periodicity": "total",
        "snapshot_date": "2023-03-04"
      }
    },
    "sort": {
      "field": "balance_quantity",
      "direction": "desc"
    },
    "limit": 50
  }
}
```

Call `inventory_valuation_analyze_3pl_inventory` with:

```json
{
  "query": {
    "filters": {
      "company_id": [61],
      "snapshot_date": "2023-03-04"
    },
    "aggregation": {
      "group_by": ["warehouse", "source"],
      "time": {
        "periodicity": "total"
      }
    },
    "sort": {
      "field": "balance_quantity",
      "direction": "desc"
    },
    "limit": 50
  }
}
```

Call `inventory_valuation_audit_inventory_balances` with:

```json
{
  "query": {
    "filters": {
      "company_id": [61],
      "snapshot_date": "2023-03-04"
    },
    "audit": {
      "quantity_tolerance": 0,
      "only_discrepancies": true
    },
    "sort": {
      "field": "abs_quantity_difference",
      "direction": "desc"
    },
    "limit": 100
  }
}
```

If the audit call returns no items, repeat it with `only_discrepancies: false` and `limit: 25` to confirm the tool returns matched rows.

## Expected Client Behavior

The AI client should:

- Treat `inventory_valuation_analyze_inventory_value` as the calculated FIFO valuation source.
- Treat `inventory_valuation_analyze_3pl_inventory` as the actual/source-side inventory balance source.
- Treat `inventory_valuation_audit_inventory_balances` as the comparison tool.
- Explain audit flags clearly: `quantity_discrepancy`, `missing_calculated_data`, `missing_actual_data`, and `matched_within_tolerance`.
- Avoid claiming source data is a financial valuation. `inventory_balances` stores quantities, while FIFO valuation provides calculated quantity and value.
- Include row counts, date used, and any filters applied in the final answer.

## Pass Criteria

The test passes if:

- All three tool calls complete without schema errors.
- The AI client uses the correct tool for each data relationship.
- Actual/source quantities and calculated FIFO quantities are not mixed together without explanation.
- The final answer identifies discrepancies and missing data using the audit tool flags.