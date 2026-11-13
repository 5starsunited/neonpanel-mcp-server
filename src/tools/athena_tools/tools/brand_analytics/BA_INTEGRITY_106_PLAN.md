# BA data-integrity check — company 106 (5SU), US — findings & improvement plan

Checked 2026-11-12 against live MCP (prod) plus source in this repo. Repro params are the ones from the ticket.
ETAs are estimates for work that has not started. "MCP" = this repo. "BA ingest" = the SP-API Brand Analytics
→ ClickHouse loader (clickhouse_etl). "Ads ingest" = the Amazon Ads → Athena pipeline.

## DoD — one line per item

| # | Item | Verdict | Owner | Fix ETA |
|---|------|---------|-------|---------|
| 1 | PPC never joins in diagnosis | **Upstream data gap + tool bug.** No keyword×ASIN PPC source exists (the CH feed was dropped 2026-10-08; the Athena `sp_search_term` feed stopped 2026-02-14). The tool hard-codes an empty PPC relation and still emits DEFEND_ORGANIC without saying PPC was never evaluated | MCP (disclosure), Ads ingest (feed) | MCP disclosure: 1 day. Interim PPC from `ads_dataset` targets: 3–4 days. Real search-term feed: Ads ingest to commit |
| 2 | brand / family = "unknown" on US rows | **Upstream data bug (tenant attribution).** 106's SCP feed contains ASINs that belong to company 103 (KEMFORD). They can't match 106's catalog, so they come back as "unknown". This is not US-only: CA and AU have the same rows. A tool bug on parent rows makes it worse | BA ingest (attribution), MCP (parent roll-up) | MCP: 1 day. Ingest: BA ingest to commit |
| 3 | B07X4HLHL2 = D / C despite 139k impressions | **Same root cause as #2, plus a tool bug.** It's a KEMFORD ASIN: class **A** under company 103, 12.9% revenue share. Under 106 it has no class row, so the tool **fills in 'D'/'C'** instead of NULL. Separately, parent rows use `max()` on the class letter, so the worst class wins | MCP | 1 day |
| 4 | `screenshot_data_available = false` everywhere | **Expected:** 106 has zero uploads (verified, including inactive rows). **Tool bug in the deep link:** keyword isn't URL-encoded, host is always `.com`, no week parameter | MCP | 0.5 day |
| + | "167-keyword scope" | **Expected but misleading.** It isn't a scope. With no tracked terms and no overrides, nothing filters the keywords (5,707 rows, ~4.3k keywords). 167 is just the number of distinct keywords in the 200 rows returned by the default `limit` | MCP (docs + header) | 0.5 day |

---

## 1. PPC layer — evidence

- `growth_machine_diagnosis/query.sql:291-303`: `ppc_weekly` is a `SELECT … WHERE 0` stub. `etl.ba_ppc_search_terms_weekly`
  was dropped with the Ads ClickHouse retirement (2026-10-08). `ppc_attributed_rows = 0` is therefore guaranteed for **every** company.
  The register.ts comment (line 284) still blames an empty `promoted_asin`, which is stale.
- Ad data **does** exist for 106: `advertising_analyze_campaign_performance`, US, 2026-10-04→11-08 shows ~$370k spend,
  attributed per `advertised_asin` (top: B07HD8B9SP $75.5k, B0B61478T9 $66.0k).
- `advertising_analyze_search_terms` for the same window returns `[]`. The Athena search-term report stopped loading on 2026-02-14.
  So no **customer-search-term × ASIN** PPC exists anywhere for this window. Marketplace and currency normalisation are therefore moot,
  because there are no rows to normalise.
- Prescription impact. Grouped repro: 1,039 DEFEND_ORGANIC / 4,668 EVALUATE_OR_SKIP, with 0 of every PPC signal.
  The default `limit=200` call returns **200/200 DEFEND_ORGANIC**, because ORDER BY ranks DEFEND above EVALUATE and nothing else can fire.
  All of these come from `sig_defend` (SQP only), so the cannibalization branch of DEFEND was never tested. The caller can't tell that.
- Bonus defect found while checking. `sig_defend` / `sig_proven_winner` / `sig_cannibalization` read `sqp_brand_purchase_share`,
  which is `total_purchase_rate`, the **market** conversion rate (query.sql:21-24, 219). The real `asin_purchase_share` is in the
  same staging table and goes unused. In other words, "Organic brand purchase share ≥ 15%" in tool.json actually means "market CVR ≥ 15%".
- Bonus defect (other tool). `advertising_analyze_campaign_performance` grouped by `target_keyword` returns
  `attributed_sales_usd = 0` / `conversions = 0` on every row, even though the same window has $258k sales per ASIN. Grouping by target
  loses attribution. If this isn't fixed, any target-based PPC substitute will flag every keyword as a "bleeder".
- Also: `product_family` / `brand` are null on every row of that campaign tool.

**Plan**
1. *(MCP, now)* Add `header.ppc_source_status = 'unavailable'` plus a `warnings[]` entry. Return `sig_bleeder / sig_cart_leak /
   sig_proven_winner / sig_cannibalization` as **NULL** rather than `false`, and add `ppc_evaluated: false` per row. In the grouped
   path, return NULL rather than 0 for `total_ppc_*` (query_grouped.sql:608-610). Drop the stale `promoted_asin` comments.
2. *(MCP, now)* Switch the share-based signals to `asin_purchase_share`, and keep `sqp_brand_purchase_share` as a deprecated alias
   for one release. This moves the DEFEND_ORGANIC population, so diff the before/after counts for 106 and announce the change.
3. *(MCP, interim)* Rebuild the PPC leg from Athena `amazon_ads.ads_dataset`, keyed on SP **EXACT-match targeting keyword ×
   advertised_asin × week**, with USD conversion as in the search-terms tool. Exclude BROAD/PHRASE/auto/ASIN targets: a target isn't a
   search term. Label it `ppc_source = 'targeting_exact'`. Blocked on the target-level attribution bug above; fix that first.
   The diagnosis is ClickHouse while ads are Athena, so this needs a two-query merge in register.ts.
4. *(Ads ingest)* Restore a search-term-report feed (SP-API `spSearchTerm` report v3) to CH or Athena, at keyword × advertised ASIN
   grain. That's the only full fix for `NEGATIVE_EXACT` and `INJECT_INTO_SEO`.

## 2 + 3. Brand / class attribution — evidence

- B07X4HLHL2 has **identical numbers** under both tenants for week 2026-11-01: 139,075 impressions, 102 purchases.
  - company 103 → brand KEMFORD, family Ankle Compression Sleeves, parent B0F9TP6P6J, class **A**, revenue_share 0.129
  - company 106 → brand "unknown", parent = itself, class **D / C**, revenue_share null
- `account_lookup_asin_catalog` lists B07X4HLHL2 and B07X5LJVPD only under company 103. B0CGXLLVPX (also KEMFORD) appears in
  106's **CA** SCP. So one Brand Analytics report (probably a shared seller account or brand registry) is loaded into both
  `company_id`s without filtering by the tenant's own ASINs.
- The ticket premise is only partly right: CA and AU also have many "unknown" rows. 106's own ASINs are populated in every marketplace.
- Fallbacks (`analyze_search_catalog_performance/query.sql`):
  - brand / family → `'unknown'` (lines 75-76). title → NULL on child rows, NULL on parent rows; the serialiser emits `""`.
    `row_type` survives correctly (child and parent both present).
  - class → `ifNull(cls.revenue_abcd_class,'D')`, `ifNull(cls.pareto_abc_class,'C')` (lines 73-74). This contradicts the
    `asinClassJoinSql` contract in `_clickhouse.ts:308-312` ("unclassified ASIN must return … a NULL class").
    `classification_as_of` **is** exposed, but there's nothing to show the class was invented.
  - Parent roll-up (lines 209-212): `max(revenue_abcd_class)` picks the **worst** class ('D' > 'A'), and `max(brand)` picks
    `'unknown'` over `'5 STARS UNITED'` ('u' > '5'). Live example: parent B0F5P8T343, revenue_share **0.19**, class **D**.
  - Unmatched ASINs have `parent_asin` fall back to the ASIN itself, so every foreign ASIN also gets a duplicate "parent" row.
  - `sort` is accepted but ignored: the final `ORDER BY f.week_start DESC` is hard-coded (line 545).
- The 07:00 UTC `etl.asin_revenue_class_daily` rebuild isn't at fault: 103's row is current and correct. The metric behind the class is
  30-day revenue share within (company, marketplace). Note the class filter runs *before* the parent roll-up, so a filtered parent row
  only sums the children that passed the filter.

**Plan**
1. *(MCP)* Unmatched class → NULL, plus a `class_source: 'classified' | 'unclassified'` field. Make `revenue_abcd_class` filters
   match NULL only on an explicit `'unclassified'` value.
2. *(MCP)* Parent roll-up: take the class from the parent's summed revenue share (or the best child class via `min()`), and take
   brand/family with `anyIf(x, x != 'unknown')`.
3. *(MCP)* Add a `catalog_match: bool` column and a header count `rows_not_in_company_catalog`. Add an opt-in
   `exclude_foreign_asins` filter (inner join to the company's `ba_asin_attributes`). The diagnosis tool already does this by
   inner-joining the catalog, so foreign ASINs don't reach prescriptions.
4. *(MCP)* Wire `sort.field` / `sort.direction` into the final ORDER BY.
5. *(BA ingest)* When one seller account / brand registry feeds several companies, attribute SCP/SQP rows by ASIN ownership
   (app catalog) instead of copying the report to every company. Then dedup the history for 103/106. Until that's done, all BA
   tools (SQP too) show cross-tenant ASINs for 106, and the reverse probably holds for 103.

## 4. SQP Query Details — evidence

- `brand_analytics_list_sqp_query_details_uploads(company_ids=[106])` → `[]`. Tracked search terms → `[]` and competitor ASINs
  → `[]`, both including inactive rows. So `false` everywhere is correct.
- Deep link (`growth_machine_diagnosis/query.sql:537-543`), from a live row:
  `…query-detail?view-id=query-detail-asin-view&asin=B0DW46P7XV&search-term-freeform=ring sizer&reporting-range=weekly&country-id=US`
  - keyword is not URL-encoded: raw spaces, and keywords with `&` break the query string
    (e.g. "contour legacy leg & knee foam support pillow" is in scope).
  - host is hard-coded to `sellercentral.amazon.com`, which is wrong for UK/EU/JP/AU.
  - no week parameter, so the link opens Seller Central's default week rather than the diagnosed period.
  - I couldn't check the parameter names against a live Seller Central session (no SC login in this check). Someone with access should confirm one link.

**Plan:** use `encodeURLComponent(kw_norm)` and a host map per marketplace in `_clickhouse.ts`, add a week parameter for
`period_end`'s week, and add a unit test with a `&` keyword.

## + Keyword scope — how it's derived

`keyword_scope` = explicit `keywords` ∪ active tracked terms (∩ `intent_ids` if supplied). When that's empty, as for 106,
**no keyword filter applies at all** (query.sql:249-252). Every SQP query for every catalog ASIN in the period is in play.
`header.keywords_in_scope` is computed in register.ts:263-269 *after* the LIMIT: it counts distinct keywords among the returned rows.

**Plan:** add `header.scope_source: 'explicit' | 'tracked' | 'intent' | 'unscoped'` and an exact `keywords_in_scope_total`
(a `count(DISTINCT kw_norm)` before the limit), rename the existing field to `keywords_in_page`, add `truncated: true` when rows >
limit, and document the unscoped fallback in tool.json.

## Proposed order of work (all MCP-side items in one PR)

1. Item 1 disclosure (NULL signals, ppc_source_status, grouped NULLs) and the scope header: these stop the silent misreads.
2. Class / brand fallbacks, parent roll-up, sort, catalog_match.
3. Deep-link encoding and host map.
4. `asin_purchase_share` switch for the defend/cannibalization signals (behaviour change, so ship it separately with a before/after diff).
5. Interim PPC from targeting keywords. Only after the Ads target-attribution bug is fixed.

Tests: extend the existing SQL template tests (`tests/*-sql.test.ts`) with assertions for each fallback and the encoded URL.
Live re-check: re-run the ticket repro and confirm DEFEND_ORGANIC no longer fills the whole first page, B07X4HLHL2 shows
`class_source = unclassified` and `catalog_match = false`, and B0F5P8T343's parent row is class A.
