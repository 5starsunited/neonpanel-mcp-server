# Copilot filtering + wrapper rules (NeonPanel MCP)

This repo uses an **Option‑1 query envelope** for “portfolio/list” tools:

- Preferred tools accept:
  - `query`: shared filters/limit/sort/projection
  - `tool_specific`: legacy tool parameters (back-compat)
- Preferred tools are **wrappers** that map `query.*` into a legacy Athena tool input schema, then run the legacy SQL.

This document captures the required behavior so Copilot/agents implement tools consistently.

## Non‑negotiable contracts

1. **If a filter is advertised as supported, it must be applied** (typically in Athena SQL WHERE).
2. **If a caller filters on a field, the tool must return that field** in each row.
   - Example: if the user filters on `query.filters.product_family`, each output row must include `product_family`.
3. **Unsupported filters must be explicit**:
   - Prefer `meta.warnings[]` for “ignored” filters.
   - Use a hard `meta.error` when the user input is ambiguous and could lead to incorrect results.

## How wrappers should work

Wrappers live under:
- `src/tools/athena_tools/tools/supply_chain_list_*/*`

Pattern:

- Validate `query` with a shared Zod schema.
- Validate `tool_specific` against the legacy tool’s input schema (usually `.partial()` in the wrapper).
- Merge inputs with precedence:
  1. Explicit `tool_specific.*` wins
  2. Else, use `query.filters.*`
  3. Else, keep defaults

### Company selection rule (no fuzzy names)

When `query.filters.company` is present:
- Accept only **numeric strings** (treated as `company_id`).
- If it is not numeric, return an error instructing the caller to:
  1. call `neonpanel_listCompanies`
  2. pick the correct company
  3. pass `query.filters.company_id`

This prevents silent mismatches like `"5 stars united"` vs `"5 Stars United LLC"`.

## Where filtering must be implemented

For Athena-backed tools, the only reliable way is:

- Add array parameters in the SQL template `WITH params AS (...)`.
- Add `WHERE` clauses of the form:

```sql
AND (cardinality(p.brands) = 0 OR contains(p.brands, pil.brand))
```

- Add the filtered columns to the output `SELECT`.

### Naming convention for SQL template params

- `*_array` in TypeScript → `{{*_array}}` placeholder in SQL.
- Use `CAST(ARRAY[] AS ARRAY(VARCHAR))` for “no filter” empty arrays.

Examples used in this repo:
- `asins_array`
- `parent_asins_array`
- `brands_array`
- `product_families_array`

## Supported vs unsupported filters (current)

For the two supply-chain wrappers:

Supported now:
- `query.filters.asin` (maps to legacy `target_asins`, returns `child_asin`)
- `query.filters.parent_asin` (maps to legacy `parent_asins`, returns `parent_asin`)
- `query.filters.brand` (returns `brand`)
- `query.filters.product_family` (returns `product_family`)
- `query.filters.sku`
- `query.filters.revenue_abcd_class` (returns `revenue_abcd_class` plus `revenue_abcd_class_description`)

Returned classification fields (even when not used as filters):
- `revenue_abcd_class_description` (human-readable description of the ABCD bucket)
- `pareto_abc_class` (A/B/C Pareto bucket derived from the same cumulative revenue thresholds)

Not supported yet:
- `query.filters.tags` (no tags column in snapshot)
- `query.filters.pareto_abc_class`

## Quick checklist when adding a new filter

- [ ] Add the field to the legacy Zod input schema.
- [ ] Pass it into the SQL template renderer as an array parameter.
- [ ] Add it to the SQL `params` CTE and to the `WHERE` filters.
- [ ] Add the field to the final `SELECT` output.
- [ ] Update wrapper merge logic to treat it as supported (no warnings).
- [ ] Update `tool.json` description(s) to match behavior.
