# Engineering Specification: `brand_analytics_run_cluster_setup`

**Version:** 1.0
**Date:** 2026-05-19
**Audience:** Implementing engineer / Copilot code agent
**Tech Stack:** Athena + Iceberg, Node 18 (MCP server), Anthropic Claude Sonnet 4.x

---

## 1. Purpose

Bootstrap and maintain semantic intent clusters for a single `(company_id, brand)` scope (optionally narrowed to one `product_family`) by:

1. Aggregating distinct search terms from **SQP**, **SQT** and **PPC** datasets over a recent partition-pruned window.
2. Ranking terms by weighted commercial signal (purchases, orders, clicks, volume).
3. Asking an LLM (Claude Sonnet 4.x) to either **fit new terms into existing intents** or **propose new intents** for the residual.
4. Persisting the result into the existing `user_intents` + `search_term_to_intent` + `intent_cluster_audit` tables.

Replaces the manual workflow of `cluster_search_terms` → `create_user_intent_cluster` for the common case where the caller just wants the system to set things up.

---

## 2. Scope rules (call boundaries)

One call ⇒ one bounded job.

| Param | Required | Notes |
|---|---|---|
| `company_id` | ✅ | exactly one |
| `brand` | ✅ | exactly one; required even if the company has a single brand |
| `product_family` | conditional | exactly one of `product_family` or `ignore_product_family=true` must be set |
| `ignore_product_family` | conditional | `true` ⇒ cluster across all families for `(company_id, brand)` |

Validation: error if both `product_family` and `ignore_product_family=true` are set, or if neither.

---

## 3. No new tables — reuse existing 3

| Table | Role |
|---|---|
| `brand_analytics_iceberg.user_intents` | Final intent rows. New rows get `source='cluster_setup_auto'`, `clustering_run_id` = audit `id`, `status='active'`. |
| `brand_analytics_iceberg.search_term_to_intent` | Term→intent mappings. New rows get `source='cluster_setup_auto'`. |
| `brand_analytics_iceberg.intent_cluster_audit` | One row per call. `operation_type='cluster_setup'`. `output_mapping` JSON stores: scope, parameters, ranking stats, LLM I/O, full result. |

No DDL changes. No new infra.

---

## 4. Modes

```
mode: "update" | "replace"   (default "update")
```

### `update` (default)

1. Load active existing intents in scope (manual + auto).
2. Pull ranked candidate terms from SQP+SQT+PPC over the lookback window.
3. Drop terms already in `search_term_to_intent` for `(company_id, brand)` → "new terms".
4. LLM call (Sonnet) does both:
   - **Task A — Assignment:** assign each new term to an existing intent (with confidence) or flag `needs_new_intent`.
   - **Task B — New intents:** cluster the residual into ≤ `target_clusters` new intents; below `min_new_intent_size` (default 5) terms remain unassigned.
5. Writes:
   - Insert mappings into `search_term_to_intent` (assignments to existing intents) where confidence ≥ `min_assignment_confidence`.
   - Insert new `user_intents` rows + their term mappings.
   - Never touches existing rows (no archive, no update).

### `replace`

1. Find active `user_intents` in scope where `source='cluster_setup_auto'`. Manual intents are **not** touched.
2. `UPDATE user_intents SET status='archived' WHERE id IN (...)`.
3. Run the full ranking + clustering on **all** candidate terms (skip the "already mapped" filter — old auto mappings remain in `search_term_to_intent` but their parent intents are archived; they are effectively dead).
4. Insert new intents and mappings.

---

## 5. Data sources & partition pruning

| Source | Table | Partition col | Required predicate |
|---|---|---|---|
| SQP | `brand_analytics_iceberg.search_query_performance_snapshot` | `week_start` | `week_start BETWEEN start_date AND end_date` |
| SQT | `brand_analytics_iceberg.search_term_smart_snapshot` | `week_start` | `week_start BETWEEN start_date AND end_date` |
| PPC | `amazon_ads_reports_iceberg.sp_search_term` | `report_date` | `report_date BETWEEN start_date AND end_date` |

All sources additionally filter `company_id = {{company_id}}` (bucket partition) and, where the column exists, `brand = {{brand}}` and `product_family = {{product_family}}`.

PPC has no `product_family` column → attribute by inner-joining to SQP/SQT-resolved `(company_id, asin) → product_family` map. When `ignore_product_family=true`, no family filter is applied; PPC inclusion is by `(company_id, brand)` via ASIN→brand map.

**Lookback:** `lookback_weeks` default **4**, hard cap **13**. Computed as `start_date = date_add('week', -lookback_weeks, current_date)`, `end_date = current_date`.

---

## 6. Ranking SQL (single Athena query, executed before LLM)

Returns `top_n_terms` rows for the scope, deterministic ordering.

```sql
WITH params AS (
  SELECT
    CAST({{company_id}} AS BIGINT)        AS company_id,
    {{brand_literal}}                      AS brand,
    {{product_family_literal_or_null}}     AS product_family,   -- NULL when ignore_product_family
    date_add('week', -{{lookback_weeks}}, current_date) AS start_date,
    current_date                           AS end_date
),

-- ASINs in scope (for PPC attribution & family filtering)
scope_asins AS (
  SELECT DISTINCT s.asin, s.product_family
  FROM "{{catalog}}"."brand_analytics_iceberg"."search_query_performance_snapshot" s
  CROSS JOIN params p
  WHERE CAST(s.company_id AS BIGINT) = p.company_id
    AND s.brand = p.brand
    AND s.week_start BETWEEN p.start_date AND p.end_date
    AND (p.product_family IS NULL OR s.product_family = p.product_family)
),

sqp_terms AS (
  SELECT
    lower(trim(s.searchquerydata_searchquery)) AS search_term,
    SUM(coalesce(s.searchquerydata_searchqueryvolume, 0)) AS sqp_volume,
    SUM(coalesce(s.purchasesdata_totalpurchases, 0))      AS sqp_purchases
  FROM "{{catalog}}"."brand_analytics_iceberg"."search_query_performance_snapshot" s
  CROSS JOIN params p
  WHERE CAST(s.company_id AS BIGINT) = p.company_id
    AND s.brand = p.brand
    AND s.week_start BETWEEN p.start_date AND p.end_date
    AND (p.product_family IS NULL OR s.product_family = p.product_family)
  GROUP BY 1
),

sqt_terms AS (
  SELECT
    lower(trim(s.search_term)) AS search_term,
    SUM(coalesce(s.search_volume, 0)) AS sqt_volume
  FROM "{{catalog}}"."brand_analytics_iceberg"."search_term_smart_snapshot" s
  JOIN scope_asins a ON a.asin = s.asin
  CROSS JOIN params p
  WHERE CAST(s.company_id AS BIGINT) = p.company_id
    AND s.week_start BETWEEN p.start_date AND p.end_date
  GROUP BY 1
),

ppc_terms AS (
  SELECT
    lower(trim(st.search_term)) AS search_term,
    SUM(coalesce(st.clicks, 0))            AS ppc_clicks,
    SUM(coalesce(st.purchases_7d, 0))      AS ppc_orders,
    SUM(coalesce(st.sales_7d, 0))          AS ppc_sales
  FROM "{{catalog}}"."amazon_ads_reports_iceberg"."sp_search_term" st
  JOIN scope_asins a ON a.asin = st.advertised_asin
  CROSS JOIN params p
  WHERE CAST(st.company_id AS BIGINT) = p.company_id
    AND st.report_date BETWEEN p.start_date AND p.end_date
  GROUP BY 1
),

unioned AS (
  SELECT search_term, sqp_volume,            0 AS sqt_volume, 0 AS sqp_purchases, 0 AS ppc_clicks, 0 AS ppc_orders, 0e0 AS ppc_sales FROM sqp_terms
  UNION ALL
  SELECT search_term, 0,                     sqt_volume,     0,                  0,              0,              0e0           FROM sqt_terms
  UNION ALL
  SELECT search_term, 0,                     0,              0,                  ppc_clicks,     ppc_orders,     ppc_sales     FROM ppc_terms
),

aggregated AS (
  SELECT
    search_term,
    SUM(sqp_volume)     AS sqp_volume,
    SUM(sqt_volume)     AS sqt_volume,
    SUM(sqp_purchases)  AS sqp_purchases,
    SUM(ppc_clicks)     AS ppc_clicks,
    SUM(ppc_orders)     AS ppc_orders,
    SUM(ppc_sales)      AS ppc_sales
  FROM unioned
  WHERE search_term IS NOT NULL AND length(search_term) BETWEEN 2 AND 120
  GROUP BY 1
),

scored AS (
  SELECT
    a.*,
    (
      {{w_sqp_purchases}} * a.sqp_purchases +
      {{w_ppc_orders}}    * a.ppc_orders    +
      {{w_ppc_sales}}     * a.ppc_sales     +
      {{w_ppc_clicks}}    * a.ppc_clicks    +
      {{w_sqp_volume}}    * ln(1 + a.sqp_volume) +
      {{w_sqt_volume}}    * ln(1 + a.sqt_volume)
    ) AS score
  FROM aggregated a
)

SELECT
  search_term,
  sqp_volume, sqt_volume, sqp_purchases, ppc_clicks, ppc_orders, ppc_sales,
  score
FROM scored
ORDER BY score DESC, search_term
LIMIT {{top_n_terms}};
```

**Default weights** (tunable via params, baked into Zod schema with safe defaults):
```
w_sqp_purchases = 5.0
w_ppc_orders    = 5.0
w_ppc_sales     = 0.05
w_ppc_clicks    = 0.1
w_sqp_volume    = 1.0    (applied to ln(1+x))
w_sqt_volume    = 1.0    (applied to ln(1+x))
```

Volumes go through `ln(1+x)` to dampen long-tail dominance; revenue-proximate signals (purchases, orders, sales) dominate.

---

## 7. Already-mapped filter (mode=update only)

After step 6 returns candidates, run a second small query to drop terms already in `search_term_to_intent` for the scope:

```sql
SELECT lower(trim(search_term)) AS search_term
FROM "{{catalog}}"."brand_analytics_iceberg"."search_term_to_intent"
WHERE company_id = {{company_id}}
  AND search_term IS NOT NULL
```

Filter in-memory in the Node tool. Keeps the LLM input minimal.

---

## 8. Existing-intents load (mode=update only)

```sql
SELECT id, intent_id, intent_name, customer_need, source
FROM "{{catalog}}"."brand_analytics_iceberg"."user_intents"
WHERE company_id = {{company_id}}
  AND status = 'active'
ORDER BY created_at ASC;
```

Note: `user_intents` has no `brand`/`product_family` columns. We load all active intents for the company and rely on the LLM (with explicit prompt context) to recognize off-scope intents. v1 limitation: if scopes share semantically similar intents across brands/families, the LLM may attach a term to a cross-scope intent. Acceptable for now; can be tightened by storing scope hints in `intent_cluster_audit.output_mapping` and joining audit→intents.

---

## 9. LLM contract (Sonnet, single call)

**Model:** `claude-sonnet-4-5` (configurable via env `INTENT_CLUSTER_LLM_MODEL`).
**Max tokens:** 4096 output.
**Temperature:** 0.

**Prompt skeleton:**
```
You are a senior e-commerce search intent analyst.

Scope:
  Company: <id>   Brand: <brand>   Product family: <family|"any">
  Lookback: <N> weeks

Existing intents (assign terms here when they fit):
[ { "intent_id": "...", "name": "...", "customer_need": "..." }, ... ]

New search terms to classify (each with commercial signal):
[ { "term": "...", "score": 1234.5, "sqp_purchases": 12, "ppc_orders": 5, ... }, ... ]

Tasks:
  A. For each term, return either:
       { "term": "...", "existing_intent_id": "...", "confidence": 0.0-1.0 }
     or
       { "term": "...", "needs_new_intent": true }
  B. For the "needs_new_intent" terms, propose up to <target_clusters> new intents.
     Each new intent: { "intent_id": "lowercase_with_underscores", "name": "Human Name",
                        "customer_need": "What does the shopper want?",
                        "search_terms": [ { "term": "...", "confidence": 0.0-1.0 }, ... ] }
     Do NOT create an intent for fewer than <min_new_intent_size> terms; leave the rest unassigned.

Output strict JSON:
{ "assignments": [...], "new_intents": [...], "unassigned_terms": ["...","..."] }
```

**Token estimate:** 150 terms + 10 existing intents ≈ 1.5-2k input, ≤ 1k output ≈ **~$0.02–0.04/call** with Sonnet (≈ 5–10× Haiku, still negligible at expected cadence).

---

## 10. Write phase (Iceberg DML)

All writes scoped to one `(company_id, brand, [family])`. Order matters:

### `mode=replace` only
```sql
UPDATE "{{catalog}}"."brand_analytics_iceberg"."user_intents"
SET status = 'archived'
WHERE company_id = {{company_id}}
  AND source = 'cluster_setup_auto'
  AND status = 'active'
  AND id IN ({{archive_ids}});  -- pre-resolved by Node before write
```

### Both modes — insert new intents
```sql
INSERT INTO "{{catalog}}"."brand_analytics_iceberg"."user_intents"
  (id, company_id, intent_id, intent_name, customer_need, status,
   search_term_count, source, clustering_run_id, created_at, created_by)
VALUES
  ({{id}}, {{company_id}}, '{{intent_id}}', '{{intent_name}}', '{{customer_need}}',
   'active', {{count}}, 'cluster_setup_auto', {{run_id}}, current_timestamp, '{{created_by}}'),
  ...;
```

### Both modes — insert term mappings
```sql
INSERT INTO "{{catalog}}"."brand_analytics_iceberg"."search_term_to_intent"
  (id, company_id, search_term, intent_id, confidence, contribution_pct, source, created_at, created_by)
VALUES
  ({{id}}, {{company_id}}, '{{term}}', '{{intent_id}}', {{conf}}, 1.0,
   'cluster_setup_auto', current_timestamp, '{{created_by}}'),
  ...;
```

### Audit row (always, last)
```sql
INSERT INTO "{{catalog}}"."brand_analytics_iceberg"."intent_cluster_audit"
  (id, company_id, operation_type, status,
   input_search_terms_count, output_intents_count, output_mapping,
   llm_model, llm_input_tokens, llm_output_tokens, created_at, created_by)
VALUES
  ({{run_id}}, {{company_id}}, 'cluster_setup', '{{status}}',
   {{candidates}}, {{intents_total}}, '{{output_json}}',
   '{{model}}', {{in_tok}}, {{out_tok}}, current_timestamp, '{{created_by}}');
```

**ID generation:** monotonic via `cast(to_unixtime(current_timestamp) * 1000 AS BIGINT) * 1000 + rand_offset` (consistent with how the existing `create_user_intent_cluster` generates ids — see its `register.ts`).

**Failure handling:** if any write step fails, write the audit row with `status='failed'` and the error message in `output_mapping`. Partial intent writes that already committed remain; the audit explains why this run is inconsistent. This matches the current `cluster_search_terms` audit behavior.

---

## 11. Tool input/output schemas

### Zod input (register.ts)
```ts
const InputSchema = z.object({
  company_id: z.coerce.number().int().positive(),
  brand: z.string().min(1).max(120),

  product_family: z.string().min(1).max(200).optional(),
  ignore_product_family: z.boolean().default(false),

  sources: z.array(z.enum(["sqp", "sqt", "ppc"]))
              .min(1).default(["sqp", "sqt", "ppc"]),

  lookback_weeks: z.coerce.number().int().min(1).max(13).default(4),
  top_n_terms:    z.coerce.number().int().min(20).max(500).default(150),
  target_clusters: z.coerce.number().int().min(3).max(20).default(8),
  min_new_intent_size: z.coerce.number().int().min(2).max(20).default(5),
  min_assignment_confidence: z.coerce.number().min(0).max(1).default(0.55),

  mode: z.enum(["update", "replace"]).default("update"),
  dry_run: z.boolean().default(true),
})
.refine(v => (v.product_family != null) !== v.ignore_product_family, {
  message: "Set exactly one of product_family or ignore_product_family=true",
});
```

### Output JSON
```jsonc
{
  "run_id": 1779210000123,
  "company_id": 106,
  "brand": "MyBrand",
  "product_family": "Ring Size Adjuster",   // null if ignore_product_family
  "mode": "update",
  "dry_run": false,
  "lookback_weeks": 4,
  "sources_used": ["sqp", "sqt", "ppc"],

  "candidates_total": 150,
  "existing_intents_count": 8,
  "already_mapped_skipped": 137,            // update mode only; 0 in replace
  "new_terms_analyzed": 63,                 // = candidates_total - already_mapped_skipped

  "assigned_to_existing": 41,
  "new_intents_created": 3,
  "new_terms_in_new_intents": 18,
  "unassigned": 4,
  "archived_auto_intents": 0,               // replace mode only

  "details": {
    "assignments": [
      { "term": "ring sizer for arthritis", "intent_id": "comfort_fit_seniors", "confidence": 0.78 }
    ],
    "new_intents": [
      { "intent_id": "lefty_thumb_ring_adjuster", "name": "Left-Handed Thumb Ring Sizing",
        "customer_need": "...", "search_terms": [{ "term": "...", "confidence": 0.9 }] }
    ],
    "unassigned_terms": ["...", "..."]
  },

  "llm": { "model": "claude-sonnet-4-5", "input_tokens": 1820, "output_tokens": 640 },
  "athena": { "query_execution_ids": ["..."], "data_scanned_bytes": 12345678 }
}
```

### `dry_run=true` semantics
- Runs steps 1–3 (existing intents load, ranking SQL, already-mapped filter).
- **Does not** call LLM. **Does not** write.
- Returns `candidates_total`, `existing_intents_count`, `already_mapped_skipped`, `new_terms_analyzed`, plus estimated LLM cost (token estimate × Sonnet rate). `details` omitted.

---

## 12. Tool registration & files

Directory: `src/tools/athena_tools/tools/brand_analytics/run_cluster_setup/`

| File | Content |
|---|---|
| `register.ts` | Handler: Zod, permission check, orchestration (ranking SQL → existing intents query → already-mapped query → LLM → writes → audit), error handling |
| `tool.json` | MCP tool spec; `isConsequential: true` when `dry_run=false`; expose all params from §11 |
| `query_rank.sql` | The §6 ranking template |
| `query_existing_intents.sql` | §8 |
| `query_already_mapped.sql` | §7 |
| `insert_user_intents.sql` | §10 |
| `insert_search_term_to_intent.sql` | §10 |
| `insert_audit.sql` | §10 |
| `archive_auto_intents.sql` | §10 (mode=replace only) |
| `prompt.md` | The §9 prompt template |
| `README.md` | Usage notes for caller |

Register in `src/tools/athena_tools/index.ts`:
```ts
import { registerBrandAnalyticsRunClusterSetup } from "./tools/brand_analytics/run_cluster_setup/register";
registerBrandAnalyticsRunClusterSetup(registry);
```

---

## 13. Permission

Same group as the rest of the brand-analytics write tools (e.g. `view:quicksight_group.sales_and_marketing_new` + a write permission gate — see `create_user_intent_cluster/register.ts` for the exact pattern to copy).

Tool is **consequential** when `dry_run=false`.

---

## 14. Open items (acknowledge before coding)

1. **Cross-brand intent leakage** (§8): `user_intents` has no brand/family column; the LLM gets every active intent for the company. Mitigation: prompt explicitly tells the model the current scope and to prefer creating a new intent when no existing one clearly matches. Long-term fix would be adding scope columns to `user_intents`, but that's out of scope here.
2. **PPC `advertised_asin` column name** — verify against `amazon_ads_reports_iceberg.sp_search_term` DDL during implementation. Adjust §6 accordingly.
3. **SQP purchases column name** — verify (`purchasesdata_totalpurchases` vs alternative) during implementation.
4. **LLM credentials** — confirm AI Gateway / Anthropic API key is already wired into the ECS task env. If not, add `ANTHROPIC_API_KEY` to the CDK task definition.
5. **Concurrent runs of the same scope** — no locking; last writer wins. Acceptable for v1 given expected call cadence.

---

## 15. Out of scope (do not build now)

- Async/background processing (rejected in favor of one bounded sync call per scope).
- Status / cancel tools.
- Cross-company batch tooling.
- Auto-merging similar intents across runs.
- Editing or deleting existing manual intents.
- Adding columns to `user_intents` or `search_term_to_intent`.
