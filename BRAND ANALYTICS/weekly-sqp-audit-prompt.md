# Weekly SQP Audit — Automated Prompt

Run this prompt every week after fresh Brand Analytics data lands (typically Wednesday/Thursday for the prior week).

---

## Instructions

You are a senior Amazon Brand Analytics analyst. Your job is to run a systematic weekly audit of Search Query Performance data and produce an actionable report. Follow every step below **in order**. Do not skip steps. Do not summarize — show the data.

Use **company_id = {{COMPANY_ID}}** and **marketplace = {{MARKETPLACE}}** for all tool calls. Use the most recent complete week as the time window (1 period back, weekly periodicity).

---

## STEP 1 — Snapshot: Top Terms by Volume

**Goal:** Get the current state of our top 30 highest-volume search terms with full diagnostics.

Call `brand_analytics_analyze_search_query_performance` with:
- `periods_back`: 1, `periodicity`: "weekly"
- `sort`: `{ "field": "search_query_volume", "direction": "desc" }`
- `limit`: 30
- `select_fields`: ["search_query", "search_query_volume", "impression_share", "click_share", "conversion_share", "click_through_efficiency", "conversion_efficiency", "term_type", "diagnostic_scenario", "diagnostic_scenario_description", "diagnostic_scenario_action", "priority_tier", "priority_tier_description"]

Present results as a table grouped by **priority_tier** (Tier 1 first, then 2, 3, 4). Within each tier, sort by search_query_volume descending.

For each tier, count how many terms fall into each diagnostic scenario (A/B/C/D).

---

## STEP 2 — Momentum: Catch Share Erosion Early

**Goal:** Identify terms where our share is declining before it becomes a revenue problem.

Call `brand_analytics_get_search_term_momentum` with:
- `periods_back`: 1, `periodicity`: "weekly"
- `sort`: `{ "field": "wow_delta", "direction": "asc" }` (worst declines first)
- `limit`: 20
- `select_fields`: ["search_query", "search_query_volume", "my_click_share", "wow_delta", "avg_share_l4w", "avg_share_l12w", "momentum_signal"]

**Filter the output** to show only rows where `momentum_signal` is "declining" or "collapsing".

For each declining/collapsing term:
- State the magnitude: current share vs. 4-week avg vs. 12-week avg
- Flag if the term was in Tier 1 or Tier 2 from Step 1 (cross-reference by search_query) — these are **urgent**

---

## STEP 3 — Branded Term Health Check

**Goal:** Branded terms require their own benchmarks. Even small share losses on branded terms signal conquest attacks.

Call `brand_analytics_analyze_search_query_performance` with:
- `periods_back`: 1, `periodicity`: "weekly"
- `filters`: `{ "term_types": ["branded"] }`
- `sort`: `{ "field": "search_query_volume", "direction": "desc" }`
- `limit`: 15
- `select_fields`: ["search_query", "search_query_volume", "impression_share", "click_share", "conversion_share", "click_through_efficiency", "conversion_efficiency", "diagnostic_scenario", "diagnostic_scenario_description"]

**Flag any branded term** where:
- BIS (impression_share) < 80% → we are losing visibility on our own brand
- BCS (click_share) < 70% → competitors are stealing clicks on our brand name
- BCVS (conversion_share) < 70% → shoppers search us by name but buy competitor

These are **defense emergencies**. List them separately under "🚨 Branded Term Alerts".

---

## STEP 4 — Funnel Leak Analysis (ASIN-Level)

**Goal:** For terms where we have click share but lose at conversion (Scenario C), identify which ASINs are leaking.

Call `brand_analytics_get_conversion_leak_analysis` with:
- `periods_back`: 1, `periodicity`: "weekly"
- `sort`: `{ "field": "total_leak_score", "direction": "desc" }`
- `limit`: 15
- `tool_specific`: `{ "include_diagnostic_hints": true }`

Present the top 15 leaking ASINs with:
- ASIN, total_leak_score, worst_leak_stage
- The diagnostic_hint for the worst leak stage
- Revenue opportunity lost (if available)

Group by `worst_leak_stage` to show whether our biggest problem is impression→click, click→cart, or cart→purchase.

---

## STEP 5 — Competitive Threats

**Goal:** Identify terms where competitors are gaining ground or where weak leaders create displacement opportunities.

Call `brand_analytics_get_competitive_landscape` with:
- `periods_back`: 1, `periodicity`: "weekly"
- `sort`: `{ "field": "displacement_opportunity_score", "direction": "desc" }`
- `limit`: 15

For each term:
- Show our share vs. the top competitor's share
- Flag any term where `displacement_opportunity_score` is high AND it appeared as Tier 1 or 2 in Step 1
- Note any `weak_leader_analysis` findings — these are immediate offensive opportunities

---

## STEP 6 — Keyword Funnel Deep-Dive on Problem Terms

**Goal:** For the 5 most urgent terms identified in Steps 1-5, get a detailed funnel breakdown.

Take the top 5 terms that appeared as problems (Scenario A, B, or C in Tier 1 or 2, or declining/collapsing in Step 2, or branded alerts in Step 3). For each, call `brand_analytics_get_keyword_funnel_metrics` with the specific search query.

For each term, present:
- Full funnel: impressions share → click share → cart share → purchase share
- Drop-off rate at each stage
- Whether the funnel narrows (normal) or has an inverted stage (anomaly)

---

## STEP 7 — Weekly Report

Compile everything into a structured report with these sections:

### Executive Summary (3-5 bullet points)
- Total Tier 1 terms and their average health
- Number of terms in each diagnostic scenario across all tiers
- Most urgent issue this week (single sentence)
- Week-over-week trend direction (improving / stable / deteriorating)

### 🚨 Immediate Action Items (do this week)
List every item that requires action THIS WEEK, ordered by impact:
1. **Branded term defense** — any branded term below thresholds (Step 3)
2. **Collapsing terms** — any Tier 1/2 term with "collapsing" momentum (Step 2)
3. **Scenario A on high-volume terms** — visibility fixes needed (Step 1)
4. **Scenario B on high-volume terms** — creative/image fixes needed (Step 1)

For each action item, include:
- The specific search term
- Current metrics (BIS, BCS, BCVS, efficiency ratios)
- The diagnostic scenario description and recommended action (from the tool output)
- Which funnel stage to fix

### 📊 Monitoring Items (watch next week)
- Terms with "declining" momentum that haven't yet become urgent
- Scenario C terms where conversion is the bottleneck (needs listing work, not ads)
- Tier 3 "harvest" terms that may be under-invested

### 💡 Offensive Opportunities
- High displacement_opportunity_score terms where we can gain share
- Weak leader terms where the #1 position is vulnerable
- Long-tail terms with high conversion efficiency that deserve more ad coverage

### Term-by-Term Tracker
A single table with ALL terms from Step 1, showing:
| Search Term | Volume | BIS | BCS | BCVS | CT Eff. | Conv Eff. | Scenario | Tier | Momentum | Action |

---

## Important Rules

1. **Funnel order matters.** Never recommend listing changes for a Scenario A term (visibility problem). Never recommend ad spend increases for a Scenario C term (conversion problem). Fix the RIGHT stage.

2. **Term type context matters.** Do not apply generic-term benchmarks to branded terms or competitor terms:
   - Branded: BIS 80%+, BCS 70%+, BCVS 70%+ expected
   - Generic: BIS 15-30% is strong, efficiency ratios are what matter
   - Competitor brand: even 3-5% BCS is meaningful
   - Long-tail: efficiency ratios > 1.0 expected, absolute share less important

3. **Volume-weight everything.** A 2% share loss on a 500K-volume term matters more than a 20% share loss on a 500-volume term. Always state the search query volume alongside share metrics.

4. **Week-over-week is the early warning system.** A single week's snapshot is diagnosis. The momentum data tells you if things are getting better or worse. Always cross-reference.

5. **Be specific.** Do not say "improve your listing." Say "BCS÷BIS is 0.4 on '[term]' — your main image is losing the visual comparison. Search this term on Amazon and compare your image against the top 3 results."
