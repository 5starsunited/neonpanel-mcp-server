# Athena SQL Tooling Guide (NeonPanel MCP)

This guide standardizes how we build Athena-backed tools (SQL + TypeScript) in this repo.

Scope:
- How to describe tools, shape inputs/outputs, and enforce access controls
- How to implement filtering and aggregation in SQL safely
- Iceberg as the source-of-truth and the “latest snapshot” semantics
- The recommended CTE layout for readable and optimizable SQL
- The “double SQL” approach (detail vs aggregate) and when to split

Non-goals:
- Teaching Athena/Trino SQL basics
- Replacing dataset/ETL ownership: business logic belongs in curated datasets/views

---

## 1) Tool Architecture (Files + Responsibilities)

Each Athena tool lives in:

- `src/tools/athena_tools/tools/<tool_name>/`
  - `tool.json`
    - Discovery metadata: name/description
    - JSON Schema for `inputSchema` and (optionally) `outputSchema`
    - Examples
  - `query.sql`
    - SQL template (only `{{token}}` substitutions)
    - Should be safe + deterministic
  - `register.ts`
    - Zod schemas (runtime validation)
    - Permission gating + allowed company IDs
    - SQL rendering and execution via `runAthenaQuery`

**Key principle:**
- `tool.json` is for discovery.
- `register.ts` is authoritative for validation + enforcement.
- SQL is fixed templates (no AI-generated joins / dynamic SQL beyond vetted tokens).

---

## 2) Tool Description Standards

A tool description should be:
- **User-facing**: what question it answers
- **Explicit about semantics**: “latest snapshot”, “latest run”, currency, units
- **Clear on limitations**: unsupported filters/sorts/pagination

Recommended description template:
- One sentence purpose
- One sentence “latest” semantics
- One sentence output granularity (detail vs aggregate)
- Optional: “Next best tool” suggestion (non-executing hint)

---

## 3) Input Contract: Query Envelope + tool_specific

We standardize tool inputs as:

- `query` (shared envelope)
  - `filters` (arrays for most dimensions)
  - `sort` (often ignored server-side; warn if provided)
  - `aggregation` (usually not implemented; warn if provided)
  - `limit` (hard-capped in server)
  - `cursor` (not implemented yet; warn if provided)
- `tool_specific`
  - Tool-specific options not suitable for the generic envelope

### 3.1 Filtering conventions

- Prefer **array filters** (even for single selection):
  - `brand: string[]`, `marketplace: string[]`, `parent_asin: string[]`, etc.
- Empty array = **no filter**.
- Normalize all filter values to strings before rendering into SQL.

### 3.2 Aggregation conventions

- Generic `query.aggregation` is treated as “future”; most tools should ignore it.
- For real aggregation support, implement:
  - `tool_specific.aggregate: boolean`
  - `tool_specific.aggregate_by: enum` (keep it small and explicit)

### 3.3 Safety + compatibility note (ChatGPT/Bedrock)

Discovery schemas must remain conservative:
- Avoid `$ref`/`definitions` in `tools/list` responses (we flatten schemas in the registry)
- Avoid root-level `anyOf` in tool schemas (some adapters reject it)
- Prefer simple object schemas with `additionalProperties: false`

---

## 4) Authorization and Company Scoping (Mandatory)

Every Athena tool must enforce company scoping:

1) Determine permitted companies from NeonPanel permissions:
- Call `GET /api/v1/permissions/{permission}/companies`

2) Compute `allowedCompanyIds`:
- If user requested a company, intersect it with permitted IDs
- If no company requested, use all permitted IDs

3) SQL must filter by company partition key:
- Always include `company_id IN (allowedCompanyIds)` (or `contains(array, company_id)`)

**Never** trust client-provided company IDs for authorization.

---

## 5) Iceberg as the Source (Architecture + Implications)

We query Iceberg-backed datasets stored in S3 and cataloged in Glue/Athena.

### 5.1 Why Iceberg

- Strong table abstraction over files
- Snapshot/metadata model (better evolution + maintenance)
- Partitioning and file pruning are critical for cost/latency

### 5.2 Recommended dataset shapes

For “portfolio/list view” style tools:
- One **snapshot table** (daily point-in-time view)
  - Partitioned by date (or `year/month/day`)
  - Partitioned by `company_id` where possible
- One or more **fact tables** (events/time series)
  - Often partitioned by date/time buckets and `company_id`

### 5.3 “Latest snapshot” semantics

Most tools should default to:
- Find latest partition for the requested company IDs
- Filter the snapshot table to that partition

This is typically implemented as a `latest_snapshot` CTE.

---

## 6) SQL Template Standards

### 6.1 Minimal templating

We only substitute `{{token}}` values via `renderSqlTemplate`.
- Tokens must be pre-rendered strings/numbers
- Never inject raw user input without quoting/escaping

### 6.2 Use a `params` CTE

Start every query with:

- `params AS (SELECT ...)`
  - `{{limit_top_n}}`, `{{horizon_months}}`, flags like `{{include_*_sql}}`
  - Filter arrays like `{{brands_array}}`
  - `company_ids_array` (REQUIRED)

This gives:
- A single place to inspect inputs
- Safer expression reuse
- Consistent patterns across tools

### 6.3 Filter pattern (arrays)

Use this pattern consistently:

- `WHERE contains(p.company_ids, t.company_id)`
- `AND (cardinality(p.brands) = 0 OR contains(p.brands, t.brand))`

Why:
- Avoids correlated subquery issues in Athena/Trino
- Reads cleanly

---

## 7) The “Double SQL” Approach (Detail + Aggregate)

Many tools need both:
- **Detail rows** (per SKU / per inventory_id)
- **Aggregate rows** (per parent_asin / product_family)

There are two supported approaches.

### Option A: One SQL file with two branches (UNION ALL)

- `query.sql` returns:
  - Detail branch when `aggregate=false`
  - Aggregate branch when `aggregate=true`

Pros:
- Single template to maintain
- Shared CTEs and consistent filters

Cons:
- Harder to heavily optimize each path independently

### Option B: Two SQL files

- `query.sql` (baseline / supports aggregate)
- `query_optimised.sql` (detail-only, optimized)

Pros:
- You can tune the dominant path without risking aggregate correctness
- Easier to iterate on performance

Cons:
- Requires explicit switching logic in `register.ts`

**Repository recommendation:**
- Use Option B when the tool is hot and detail mode dominates.
- Keep aggregate mode on the stable baseline until you intentionally optimize it.

---

## 8) Recommended CTE Structure for Optimizable SQL

A consistent CTE layout makes optimization straightforward.

Recommended steps (names are conventions; adjust as needed):

1) `params`
- Inputs and filter arrays

2) `latest_snapshot`
- Latest partition selection for snapshot datasets

3) `fact_latest_rows` / `fact_filtered`
- Filter fact table early by company IDs (and date where applicable)

4) `fact_item_plan` / `fact_rollup`
- Per-entity aggregation (e.g., build arrays, compute metadata)

5) `snapshot_core`
- Snapshot rows filtered to latest partition
- Include only the columns needed for filtering/sorting + minimal output

6) `t_core`
- Join snapshot_core to fact rollups
- Compute derived fields and group keys

7) `t_ranked`
- Add window computations only if needed
- Prepare stable sort keys

8) `t_limited`
- Apply `ORDER BY ... LIMIT {{limit_top_n}}` as early as correctness allows

9) Final `SELECT`
- Apply output flags (include/exclude large fields)
- Cast types consistently

---

## 9) Window Functions: When to Use, How to Contain Cost

Window functions are powerful but can be expensive.

### 9.1 Common use cases

- “latest run per entity”:
  - `row_number()` or `dense_rank()` over `(company_id, entity_id)` ordered by `(period desc, updated_at desc)`
- “share within group”:
  - `value / sum(value) over (partition by group_key)`

### 9.2 Containment strategy

- Run windows on the smallest possible row set
  - Prefer: filter fact table by company first
  - Prefer: reduce columns before windowing if it helps
- Compute optional windows behind flags
  - e.g. `include_item_sales_share`

### 9.3 Alternatives (when you need them)

- “Key selection + join back” (two-pass) can be faster in some shapes, but scans more logic.
- Best long-term option is data modeling:
  - store a `forecast_run_id` or `is_latest_run` indicator

---

## 10) Output Shaping and Type Discipline

Athena often returns everything as strings through the SDK; still:
- Cast numeric outputs in SQL for correctness and downstream typing
- Use `try_cast(...)` when source columns may contain mixed types

Conventions:
- Use `CAST(NULL AS DOUBLE)` / `CAST(NULL AS VARCHAR)` in CASE expressions to keep types consistent
- For arrays/json output:
  - `json_format(CAST(array_expr AS JSON))`

---

## 11) Testing, Explain, and Regression Safety

Recommended tooling:
- An EXPLAIN script per hot query (baseline + optimised)
- A compare script that runs both queries with identical params and diffs results

Efficiency measurement notes:
- Athena timings vary; compare medians across multiple runs
- Track `DataScannedInBytes` and `TotalExecutionTimeInMillis`

---

## 12) Practical Checklist (Per Tool)

- [ ] Zod schema rejects unexpected inputs (`.strict()`)
- [ ] Permission gating + `allowedCompanyIds` is enforced
- [ ] SQL filters by company partition key
- [ ] All optional filters follow the `(cardinality=0 OR contains(...))` pattern
- [ ] Limit is capped server-side
- [ ] Aggregate behavior is explicit (`tool_specific.aggregate`)
- [ ] SQL uses `params` + `latest_snapshot` CTEs when querying snapshot tables
- [ ] Types are consistent in CASE/UNION branches
- [ ] Compare harness passes for at least 2–3 real filter combinations

---

## 13) Example: Skeleton Query Layout

This is a minimal skeleton you can adapt:

```sql
WITH params AS (
  SELECT
    {{limit_top_n}} AS top_results,
    {{company_ids_array}} AS company_ids,
    {{brands_array}} AS brands
),
latest_snapshot AS (
  SELECT year, month, day
  FROM "{{catalog}}"."{{database}}"."{{table}}" t
  CROSS JOIN params p
  WHERE contains(p.company_ids, t.company_id)
  GROUP BY 1,2,3
  ORDER BY CAST(year AS INTEGER) DESC, CAST(month AS INTEGER) DESC, CAST(day AS INTEGER) DESC
  LIMIT 1
),
snapshot_core AS (
  SELECT t.*
  FROM "{{catalog}}"."{{database}}"."{{table}}" t
  CROSS JOIN params p
  CROSS JOIN latest_snapshot s
  WHERE contains(p.company_ids, t.company_id)
    AND t.year = s.year AND t.month = s.month AND t.day = s.day
    AND (cardinality(p.brands) = 0 OR contains(p.brands, t.brand))
)
SELECT *
FROM snapshot_core
ORDER BY COALESCE(try_cast(sales_last_30_days AS DOUBLE), 0.0) DESC
LIMIT {{limit_top_n}};
```

---

## 14) Notes for Future: Adding More Sources (Sales history, etc.)

When integrating additional datasets (sales history, ads, returns, etc.):
- Prefer curated Iceberg tables/views aligned with QuickSight semantics
- Join at the correct grain (SKU/day vs inventory_id/day)
- Keep heavy columns out of early CTEs unless needed for filtering
- Push computed windows/rollups behind flags and after filtering

If you want to add a new “sales history” tool, start by defining:
- Snapshot anchor (latest snapshot date vs a user-supplied date range)
- Required filters and allowed aggregation
- One curated fact source table and its partitioning strategy

---

If you want, I can also add a short “starter template” folder (copy-paste scaffold) for new tools: `tool.json`, `query.sql`, and `register.ts` with the standard patterns.
