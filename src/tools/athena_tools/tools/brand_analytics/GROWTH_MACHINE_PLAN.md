# Growth Machine — Build Plan

Synergetic Brand Analytics tool that fuses **SQP + SCP + PPC** at the right catalog grain, backed by supporting tools for screenshot ingestion and per-company tracking configuration.

Source of the framework: *Chapter 2 — The Brand Analytics Trio and the RYG Framework*.

---

## Locked decisions

| # | Decision |
|---|----------|
| 1 | All new Iceberg tables live in `brand_analytics_iceberg`. |
| 2 | Screenshot ingest accepts `extracted_json` from the calling agent — no Lambda/Textract. |
| 3 | No watchlist scheduler in v1. `run_watchlist` is manual-trigger only. |
| 4 | Prescription **labels** locked in SQL (fixed enum). Prescription **thresholds** live in the existing `ryg_thresholds` table (company-override + system-default fallback). |
| 5 | Default grain = `child_asin`. `grain` input also allows `parent_asin` or `product_family` for explicit rollups. No `auto` heuristic in v1. |

---

## Component 1 — `brand_analytics_growth_machine_diagnosis`

**Purpose:** one call returns `(keyword × catalog_node × period)` rows fusing SQP market share, SCP funnel diagnosis, PPC efficiency, RYG band, and a deterministic prescription.

### Inputs

- `filters.company_ids` (req), `filters.marketplaces` (req)
- `filters.keywords` + `match_type`, `asins`, `parent_asins`, `product_families`, `brands`, `pareto_abc_class`, `revenue_abcd_class`
- `grain`: `child_asin` (default) | `parent_asin` | `product_family`
- `focus`: `all` | `proven_winners` | `bleeders` | `cannibalization` | `cart_leak` | `weak_leader`
- `aggregation.time`: `periodicity` + (`start_date`/`end_date` OR `periods_back`)
- `sort` (default `revenue_opportunity_usd desc`), `limit` (default 100)
- `use_tracked_search_terms: bool` (auto-populate keyword filter from Component 3)
- `use_competitor_registry: bool` (auto-populate competitor flags from Component 5)

### SQL structure (single query)

1. **`catalog`** CTE — from `last_snapshot_inventory_planning` with hero/sibling window functions. Factored out of `account_lookup_asin_catalog/query.sql` into a reusable `.sql` partial.
2. **`sqp`** CTE — SQP snapshot, joined to `catalog`.
3. **`scp`** CTE — SCP snapshot, joined to `catalog`.
4. **`ppc`** CTE — PPC search terms + `campaign_asin_map`, joined to `catalog`.
5. **`ryg_bands`** CTE — from `ryg_thresholds` where `tool IN ('sqp','scp','global')` (company override ↘ system default fallback, same pattern as `sqp_qs_dataset.sql`).
6. **`gm_rules`** CTE — from `ryg_thresholds` where `tool = 'growth_machine'` (same fallback pattern). Supplies the thresholds the prescription `CASE` evaluates against.
7. **`screenshots`** CTE — from Iceberg table `sqp_query_details_uploads` (Component 2). Left-join so missing screenshots just mean `screenshot_data_available = false`.
8. Final `FULL OUTER JOIN` on `(normalize(keyword), catalog_node_key, period)`. Weighted rollup when `grain ≠ child_asin` (weight by `units_30d` / `revenue_30d`).
9. Prescription `CASE` reading thresholds from `gm_rules` → fixed label enum.

### Outputs (per row)

- Identity: `keyword`, `grain`, `grain_key`, `asin`, `parent_asin`, `product_family`, `brand`, `period_start`, `period_end`
- SQP: `search_query_volume`, `brand_impression/click/cart/purchase_share`, `ryg_band`, `ryg_threshold_used`
- SCP: `asin_funnel_rates`, `leak_scenario` (A/B/C/D), `revenue_lost_usd`
- PPC: `spend`, `attributed_sales`, `acos`, `roas`, `cvr`, `match_type_mix`
- Flags: `is_proven_winner`, `is_bleeder`, `is_cannibalization`, `my_asin_in_top3`, `is_hero`, `is_competitor`, `competitor_won_keyword`
- Enrichment: `seller_central_query_detail_url`, `screenshot_data_available`, `prescription`, `prescription_reason` (from `signal_description`), `revenue_opportunity_usd`, `catalog_snapshot_date`
- Response header: `normalization_match_rate`, `ryg_thresholds_version`

### Prescription enum (locked for v1)

- `FIX_CART_LEAK_CUT_PPC`
- `INJECT_INTO_SEO`
- `NEGATIVE_EXACT`
- `DEFEND_ORGANIC`
- `DISPLACE_WEAK_LEADER`
- `EVALUATE_OR_SKIP`

### Risks handled

- **Keyword normalization drift** between SQP/PPC → server-side `LOWER(TRIM(regexp_replace(...)))` + `normalization_match_rate` in header.
- **Current-state catalog vs historical window** → expose `catalog_snapshot_date` in output.
- **Variant cannibalization** → weighted rollups when grain is parent/family.

### Seller Central enrichment language (reused convention)

Tool description must include:

> **IMPORTANT — Data enrichment opportunity:** Amazon does NOT expose Search Query Details (total impressions, total clicks, click rate, per-ASIN impressions, price, and up to 10 competing ASINs) via API. Each result row includes a `seller_central_query_detail_url` deep link. If `screenshot_data_available = false` for a priority keyword, ask the user to open the URL, screenshot the page, and upload it via `brand_analytics_upload_sqp_query_details`. Subsequent diagnoses will read the persisted data from Iceberg.

---

## Component 2 — `brand_analytics_upload_sqp_query_details`

**Purpose:** capture UI-only fields Amazon withholds from API so subsequent diagnoses can read them from Iceberg instead of re-asking the user.

### Iceberg table: `brand_analytics_iceberg.sqp_query_details_uploads`

| Column | Type | Notes |
|---|---|---|
| `company_id` | BIGINT | |
| `marketplace` | STRING | |
| `keyword` | STRING | normalized |
| `period_start` | DATE | |
| `period_end` | DATE | |
| `total_impressions` | BIGINT | |
| `total_clicks` | BIGINT | |
| `total_click_rate` | DOUBLE | |
| `competitors` | ARRAY<ROW<asin STRING, impressions BIGINT, clicks BIGINT, click_rate DOUBLE, price_median DOUBLE, rank INT>> | up to 10 |
| `uploaded_by` | STRING | |
| `uploaded_at` | TIMESTAMP | |
| `source_screenshot_s3_uri` | STRING | nullable |
| `raw_extracted_json` | STRING | agent's original JSON payload |

Dedup on `(company_id, marketplace, keyword, period_start)`; keep `uploaded_at` history via Iceberg snapshots.

### Tool

- Name: `brand_analytics_upload_sqp_query_details`
- `isConsequential: true`
- Inputs: `company_id`, `marketplace`, `keyword`, `period_start`, `period_end`, `extracted_json` (required, agent-produced).
- Description prompts the user flow:
  - Call `brand_analytics_growth_machine_diagnosis` first.
  - If a priority row has `screenshot_data_available = false`, open `seller_central_query_detail_url`.
  - Screenshot the page, have the agent extract the fields into JSON matching the schema, then call this tool.

### Paired read tool

- `brand_analytics_list_sqp_query_details_uploads` — filter/list stored uploads for debug and audit.

---

## Component 3 — Tracked search terms (per-ASIN keyword cores)

**Purpose:** each company has 30–200 keywords that matter. Persist the `ASIN → tracked search terms` mapping so the diagnostic tool can auto-scope without re-listing keywords every call.

### Iceberg table: `brand_analytics_iceberg.tracked_search_terms`

| Column | Type | Notes |
|---|---|---|
| `company_id` | BIGINT | |
| `marketplace` | STRING | |
| `asin` | STRING | nullable (null = company-wide) |
| `parent_asin` | STRING | nullable |
| `product_family` | STRING | nullable |
| `keyword` | STRING | |
| `priority` | INT | 1–5 |
| `intent` | STRING | `defend` / `attack` / `evaluate` / `branded` |
| `added_by` | STRING | |
| `added_at` | TIMESTAMP | |
| `notes` | STRING | nullable |

### Tools

- `brand_analytics_write_tracked_search_terms` (consequential, upsert/delete, batch)
- `brand_analytics_list_tracked_search_terms` (filter by company + optional asin/parent/family)

### Integration

Component 1 accepts `use_tracked_search_terms: bool` (default `false`). When `true`, keyword filter auto-populates from this table, scoped to the request's asins / parent_asins / product_families.

---

## Component 4 — Analytics watchlist

**Purpose:** named cores for what to analyze on what cadence — e.g. `(ASIN1, ASIN2, ASIN3) weekly`, `(product_family_A) monthly`. No scheduler in v1; `run_watchlist` is manual.

### Iceberg table: `brand_analytics_iceberg.analytics_watchlist`

| Column | Type | Notes |
|---|---|---|
| `company_id` | BIGINT | |
| `marketplace` | STRING | |
| `watchlist_name` | STRING | |
| `grain` | STRING | `child_asin` / `parent_asin` / `product_family` / `brand` |
| `entity_ids` | ARRAY<STRING> | |
| `cadence` | STRING | `weekly` / `monthly` / `quarterly` |
| `focus` | STRING | same enum as Component 1's `focus` |
| `owner` | STRING | |
| `last_run_at` | TIMESTAMP | updated by `run_watchlist` |
| `is_active` | BOOLEAN | |
| `created_at`, `updated_at` | TIMESTAMP | |

### Tools

- `brand_analytics_write_analytics_watchlist` (consequential, CRUD)
- `brand_analytics_list_analytics_watchlist`
- `brand_analytics_run_watchlist` — takes `watchlist_name`, reads config, calls Component 1 with the right filters/grain/time window, updates `last_run_at`

---

## Component 5 — Competitor ASIN registry

**Purpose:** make "who are my competitors?" an explicit, persistent set — for filtering, flagging, and weak-leader scoring.

### Iceberg table: `brand_analytics_iceberg.competitor_asins`

| Column | Type | Notes |
|---|---|---|
| `company_id` | BIGINT | |
| `marketplace` | STRING | |
| `competitor_asin` | STRING | |
| `competitor_brand` | STRING | nullable |
| `competitor_label` | STRING | free text |
| `against_my_asin` | STRING | nullable |
| `against_my_product_family` | STRING | nullable |
| `priority` | INT | 1–5 |
| `added_by` | STRING | |
| `added_at` | TIMESTAMP | |
| `is_active` | BOOLEAN | |

### Tools

- `brand_analytics_write_competitor_asins` (consequential, CRUD, batch)
- `brand_analytics_list_competitor_asins`

### Integration

- Component 1 adds output flags `is_competitor` and `competitor_won_keyword` when a tracked competitor is in top-3 clicked ASINs.
- `brand_analytics_get_competitive_landscape` gets optional `use_competitor_registry` to auto-scope `competitor_asins` input.

---

## Cross-cutting work

### Reuse `ryg_thresholds` for prescription rules

The existing `brand_analytics_iceberg.ryg_thresholds` table is general-purpose enough to drive the prescription logic — no new rules table needed.

- Extend `tool` enum: add `'growth_machine'`.
- Extend `signal_group` enum: add `'proven_winner'`, `'bleeder'`, `'cannibalization'`, `'cart_leak'`, `'weak_leader'`, `'defend'`.
- Seed defaults (~15 rows) in `ryg_thresholds/seed_defaults.sql` tagging each row with its `signal_code` = prescription label.
- Company overrides, dedup, and default fallback all work unchanged.
- `company_threshold_report.sql` automatically reports the effective prescription thresholds per company.

### Update existing tools

- `brand_analytics_write_ryg_thresholds/tool.json` — extend `tool` and `signal_group` enums.
- `brand_analytics_list_ryg_thresholds` — already works, no change.
- `brand_analytics/tools_group_user_guide.md` — append section on the 5 new tools + Day-1 onboarding.

### Centralized helpers

- Seller Central URL builder (`sellercentral.amazon.com/brand-analytics/...`) factored into a shared helper used by `get_competitive_landscape`, Component 1, and Component 2.
- Catalog hero/sibling CTE factored out of `account_lookup_asin_catalog/query.sql` into a reusable `.sql` partial.

---

## Execution order

1. **Plumbing** — extract catalog CTE partial + extend RYG `tool` / `signal_group` enums + seed `growth_machine` defaults.
2. **Component 5** — competitor ASINs (simplest CRUD, unblocks flags in Component 1).
3. **Component 3** — tracked search terms (same CRUD shape as #5).
4. **Component 1** — growth machine diagnosis (the core payoff).
5. **Component 2** — screenshot ingest (wires into Component 1's `screenshot_data_available` flag).
6. **Component 4** — analytics watchlist + `run_watchlist` (convenience on top of Component 1).

Each step is independently shippable. Steps 2–5 each follow the same scaffold: Iceberg DDL → `tool.json` → `query.sql` (or write handler) → `register.ts` → user-guide entry.

---

## Day-1 onboarding (post-ship)

1. Calibrate RYG thresholds (including the new `growth_machine` rows) for the company's category.
2. Seed `tracked_search_terms` from the company's current priority keywords.
3. Seed `competitor_asins` from known rivals.
4. Define one `analytics_watchlist` entry per major product family.
5. Run `brand_analytics_run_watchlist` weekly/monthly; feed results back into threshold tuning.
