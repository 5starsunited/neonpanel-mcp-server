# Chapter 1: Search Query Performance (SQP)
## The Foundation Report — Full Deep-Dive

---

## What This Report Actually Is

The SQP report shows you **your brand's share of the shopper funnel** for any given search term on Amazon, compared to every other seller competing for that same term.

The critical word is **share**. This is not just your numbers in isolation. It is your numbers *as a percentage of all activity* on that term across the entire Amazon marketplace. That is what makes it unlike anything in Seller Central, unlike any third-party tool, and why it is the most strategically important report Amazon has ever released to sellers.

Amazon only shows terms where **your brand had at least one click** during the selected period. This means your report is not the full market — it is the subset of the market where you already have some presence.

---

## The Four Columns and What They Actually Measure

### Column 1: Search Query Volume
**Definition:** The total number of times shoppers searched this exact term on Amazon during the period.

**What it is NOT:** It is not your impressions, your clicks, or anything related to your brand. It is the raw market demand for that term.

**Why it matters:** This is the size of the prize. Before you do anything else with a term, you must know if it is worth your attention. A term where you have 1% click share but the volume is 500 searches/week is a different priority than a term where you have 1% click share and the volume is 500,000 searches/week.

**How to use it:** Sort your entire export by Search Query Volume descending. This instantly ranks all terms by market importance. Do all subsequent analysis in this order.

**But volume alone is not priority.** A high-volume term where your margin is razor-thin and the segment is dominated by a single entrenched brand is a different investment decision than a moderate-volume term where you already convert well and margin is strong. After sorting by volume, mentally assign each of your top terms to one of four tiers:

| Tier | Definition | Implication |
|---|---|---|
| 1 | High volume + you already convert well | Protect, dominate, defend at all cost |
| 2 | High volume + you are underperforming | High upside — diagnose and fix the funnel |
| 3 | Lower volume + strong conversion efficiency | Profit-dense terms — harvest efficiently |
| 4 | Low volume + weak performance | Ignore or deprioritise until higher tiers are solved |

Most teams spend the majority of their analysis time on Tier 2 terms — large addressable market, clear underperformance, fixable if you diagnose correctly. Tier 1 is where you play defense. Tier 3 is often where the real profit lives but gets overlooked because the volumes look unimpressive.

---

### Column 2: Brand Impression Share (BIS)
**Definition:** The percentage of all impressions on this search term that showed *any of your brand's ASINs* — organic or sponsored.

**Formula:** Your brand's total impressions ÷ Total impressions on that term across all sellers

**What it is NOT:** It is not clicks. It is not sales. It is not rank. It is purely *how often your brand appeared on the screen* when someone searched this term. A shopper could have seen your listing and scrolled past without registering as a click.

**The two reasons your BIS can be low:**
1. **Organic rank is low** — you are on page 2, 3, or below, so most searches never see you
2. **No sponsored coverage** — you have no ads running for this term, or bids are too low to win impressions

**Benchmark:** On your most important terms (top 20 by volume), you want BIS above 15–20% if you are a serious player in your category. Above 30% is dominant. Below 5% on a high-volume term means you are essentially invisible.

---

### Column 3: Brand Click Share (BCS)
**Definition:** The percentage of all clicks on this search term that went to *any of your brand's ASINs*.

**Formula:** Your brand's total clicks ÷ Total clicks across all sellers on that term

**What it is NOT:** It is not conversions. Someone clicking your listing counted here even if they immediately bounced.

**The relationship between BIS and BCS is the most important ratio in this report.** Think of it this way:

- If BIS is 20% (you appeared 20% of the time) and BCS is 20% (you got 20% of clicks), you are converting impressions to clicks at exactly the market average rate. Neutral.
- If BIS is 20% and BCS is 8%, you are appearing 20% of the time but only winning 8% of clicks. **You are losing the visual competition.** Shoppers see you and choose someone else.
- If BIS is 8% and BCS is 20%, you appear rarely but when you do appear, shoppers click you at an above-average rate. **Your listing is strong but you lack visibility.**

This ratio — BCS ÷ BIS — is your **click-through efficiency**. Calculate it for every term. It tells you whether you have a visibility problem or a creative/relevance problem.

---

### Column 4: Brand Conversion Share (BCVS)
**Definition:** The percentage of all purchases on this search term that were of *any of your brand's ASINs*.

**Formula:** Your brand's total purchases ÷ Total purchases across all sellers on that term

**What it is NOT:** It is not your conversion rate (units sold ÷ sessions). It is your share of the market's purchasing activity.

**The relationship between BCS and BCVS mirrors what BIS:BCS tells you:**

- BCS 20%, BCVS 20%: You are converting at market average. Neutral.
- BCS 20%, BCVS 8%: Shoppers click you but don't buy. **You have a listing conversion problem** — price, images, reviews, bullets, or A+ content is failing at the point of decision.
- BCS 8%, BCVS 20%: You convert at above-market rates when clicked. Your listing is excellent but traffic is the bottleneck.

---

## The Funnel Visualised

Every search term has a funnel. Your job is to own as much of each stage as possible:

```
ALL SEARCHES (Search Query Volume = 100% of market demand)
          │
          ▼
IMPRESSIONS (your Brand Impression Share = your visibility)
          │   ← "Did shoppers even see me?"
          ▼
CLICKS    (your Brand Click Share = your appeal)
          │   ← "Did my listing win the click vs. competitors?"
          ▼
PURCHASES (your Brand Conversion Share = your conversion)
              ← "Did my listing page close the sale?"
```

Each transition is a **filter**. Losing customers at each filter has a different root cause and a different fix.

---

## The Four Diagnostic Scenarios

This is the decision framework. For every important term, identify which scenario you are in:

---

### Scenario A: Low BIS → All other metrics irrelevant
**Pattern:** BIS < 5–8% on a high-volume term

**What it means:** You are barely showing up. Shoppers can't click what they can't see. Your click share and conversion share are low simply because you have no visibility, not because your listing is bad.

**Root causes:**
- Poor organic rank (not enough sales velocity or keyword relevance)
- No sponsored coverage or bids too low
- Listing not indexed for this term (check with keyword rank checker)

**Actions:**
1. Add the term to an exact-match Sponsored Products campaign with an aggressive bid (above suggested bid) to buy impressions
2. Manually verify organic rank — if page 3+, you need a ranking push
3. Verify the term is in your title, bullets, and backend keywords for indexation
4. Check if competitors are spending heavily (use keyword auction data in Campaign Manager)

**Do NOT** yet worry about your listing creative. You have an advertising/SEO problem, not a conversion problem.

---

### Scenario B: Good BIS, Low BCS → Visual competition problem
**Pattern:** BIS is reasonable (10%+), BCS is significantly lower (BCS ÷ BIS ratio < 0.6)

**What it means:** Shoppers are seeing you but choosing to click your competitor instead. You lost the visual comparison before they even visited your listing page.

**Root causes:**
- Main image is weaker than competitors (lighting, lifestyle vs. white background, information density)
- Title is not communicating differentiation in the first 80 characters
- Star rating is lower than visible competitors
- Review count is much lower (social proof comparison)
- Price in search results looks uncompetitive

**Actions:**
1. Open Amazon and search this exact term. Visually compare your main image against the top 5 results at a glance. Ask: "Would I click mine?"
2. Compare your star rating and review count against the top 3 clicked ASINs
3. Test a main image variant (requires A/B testing via Manage Experiments if brand registered)
4. Consider a pricing experiment: lower by 10% for 2 weeks, check if BCS improves
5. Do NOT assume it is the detail page — the shopper never got there

---

### Scenario C: Good BCS, Low BCVS → Listing conversion problem
**Pattern:** BCS is strong (you are winning clicks), BCVS is significantly lower (BCVS ÷ BCS ratio < 0.6)

**What it means:** Shoppers chose you over competitors, arrived at your listing page, and then left without buying. Something on the detail page is failing.

**Root causes:**
- Price is too high *relative to what the detail page shows* (they clicked, saw value, compared price, left)
- Secondary images do not address purchase objections
- Bullet points don't answer the key questions shoppers have
- Reviews contain unresolved concerns (read the 3-star reviews specifically)
- A+ content is absent, generic, or not benefit-focused
- Product has a fatal objection that listing doesn't address (e.g. size confusion, compatibility questions)

**Actions:**
1. Read every 3-star review for this ASIN. Find the most common objection. Address it explicitly in bullet 1 or 2.
2. Audit your secondary images: do you have a sizing image? A lifestyle-in-use image? A comparison chart? A callout image addressing the main objection?
3. Check if Buy Box is consistent — if you are losing Buy Box intermittently, conversion will bleed
4. Add video if absent (video consistently improves conversion 10–20%)
5. Check competitor A+ content — are they significantly better?

---

### Scenario D: Good BIS, Good BCS, Good BCVS → Protect and scale
**Pattern:** All three share metrics are healthy and growing

**What it means:** You have a working funnel on this term. Do not touch the listing. Your job is to defend and expand. Winning terms attract competitor attention — sellers with rank-tracking tools will identify your terms and start bidding against you. Defense is not passive.

**Expansion actions:**
1. Increase bid/budget on this term to capture even more impression share — push BIS toward 30%+ if margins allow
2. Add Sponsored Brands (headline ads) and Sponsored Display campaigns for this term to occupy multiple placement types simultaneously, making it harder for competitors to get consistent visibility
3. Use this ASIN's listing as the template when launching new ASINs in the same category

**Defensive actions:**
4. Pull the same period comparison every 4 weeks specifically for your Scenario D terms. Any BIS or BCS decline on a term where you made no changes means a competitor is gaining traction. Do not wait until it is obvious.
5. When a Scenario D term shows declining BCS (impressions holding but fewer clicks), a competitor has likely improved their main image or price. Search the term immediately and identify who has gained prominence.
6. When a Scenario D term shows declining BCVS (clicks holding but fewer purchases), a competitor has likely improved their detail page or is undercutting your price. Check the top 3 competitor ASINs for price and review changes.
7. For your top 5 highest-volume Scenario D terms, maintain a "last known state" snapshot (your BIS, BCS, BCVS, and the top 2 competitor ASINs) so you have a baseline to compare against when numbers move. This transforms SQP from a snapshot into an early-warning system.

---

## What Good Benchmarks Look Like

These are general benchmarks. Your real benchmarks are your own best-performing terms — use those as internal targets.

| Metric | Struggling | Average | Strong | Dominant |
|---|---|---|---|---|
| Brand Impression Share | < 5% | 5–15% | 15–30% | > 30% |
| Click-Through Efficiency (BCS÷BIS) | < 0.5 | 0.5–0.8 | 0.8–1.2 | > 1.2 |
| Conversion Efficiency (BCVS÷BCS) | < 0.5 | 0.5–0.9 | 0.9–1.2 | > 1.2 |

A click-through or conversion efficiency above 1.2 means you are **outperforming** the market average on that term — you get more clicks or more purchases per unit of visibility than your average competitor. This is a signal of genuine listing strength.

---

## Keyword Segmentation: Not All Terms Interpret the Same

Before applying the diagnostic framework, you must know what type of term you are looking at. The same BIS or BCS number means completely different things depending on term type. Mixing all term types into one undifferentiated analysis is one of the most common ways teams draw wrong conclusions from SQP.

There are four types, and each has a different benchmark, a different strategic goal, and a different acceptable failure mode:

---

### Type 1: Branded Terms (your brand name, or brand + product)
**Examples:** "[YourBrand] yoga mat", "[YourBrand] 12oz tumbler"

**Expected profile:** Very high BIS (you should dominate), very high BCS (shoppers searching your brand name intend to buy from you), very high BCVS.

**The threat:** A low BCS on a branded term means either (a) competitors are running conquest campaigns against your brand name and winning clicks, or (b) you have lost the Buy Box on your own ASIN. Both require immediate action. A branded term with BCS below 70% is a serious problem — you are losing customers who already know you.

**Goal:** 80%+ BIS, 70%+ BCS, 70%+ BCVS. Anything below this on a branded term is a defense failure.

---

### Type 2: Generic / Category Terms (no brand name, describe the product)
**Examples:** "yoga mat", "stainless travel mug", "non-slip bath mat"

**Expected profile:** Lower BIS (you are one of many competing), BCS ÷ BIS ratio is where the real competition plays out, BCVS varies widely.

**The context:** These are the terms that Chapter 1's framework is primarily built for. The 15–30% BIS benchmark, the efficiency ratios, the four scenarios — all are calibrated for generic terms. This is where market share is won or lost.

**Goal:** Grow BIS on high-volume Tier 1/2 generic terms over time. A brand with 5% BIS on a major generic term this year should target 10% next year.

---

### Type 3: Competitor Brand Terms (competitor's brand name, or competitor brand + product)
**Examples:** "[CompetitorBrand] yoga mat", "[CompetitorBrand] vs [YourBrand]"

**Expected profile:** Your BIS will naturally be low (the competitor's own brand dominates). Even 5–10% BIS on a competitor brand term is meaningful — it means your sponsored ads are capturing some of the competitor's demand.

**The strategy:** These terms are offensive. You are not trying to dominate — you are trying to intercept undecided shoppers who searched the competitor but are open to alternatives. A BCS of even 3–5% on a high-volume competitor term can represent significant incremental revenue.

**Goal:** Profitable BCS at any level, monitored against TACoS (profitability context covered in Chapter 9). Do not benchmark these against generic term standards.

**Important:** Never conflate competitor brand terms with generic terms in your analysis. A 4% BCS is catastrophic on a generic term but excellent on a competitor brand term.

---

### Type 4: Long-Tail / Specific Terms (high-specificity, lower volume)
**Examples:** "purple non-slip yoga mat 6mm", "wide mouth 20oz stainless mug with handle"

**Expected profile:** Lower absolute Search Query Volume, but shoppers have very high purchase intent. Click-through efficiency and conversion efficiency should both be above 1.0 — these shoppers know exactly what they want.

**The opportunity:** Long-tail terms are often the most profitable terms in your entire SQP export. They surface rarely in volume-sorted views, but a term with 2,000 searches/week and a BCVS of 30% may be delivering more actual profit than a term with 200,000 searches/week and a BCVS of 0.5%.

**Goal:** High efficiency ratios, not high absolute share. Focus on making sure these terms are indexed (they often are not) and have at least minimal sponsored coverage so they appear in your SQP data.

---

**Practical application:** When you export SQP data, add a column for term type before doing any ratio analysis. Your benchmarks, your acceptable performance thresholds, and your action priorities are all type-dependent. A single analysis that mixes branded, generic, competitor, and long-tail terms without flagging the type will produce conclusions that are wrong for at least two of the four groups.

---

## The Three Questions to Ask for Every Term

Reduce all of the above into three yes/no questions. Walk every term through this:

```
1. Can shoppers SEE me?      (Is BIS meaningful for this term's volume?)
   NO  → Advertising/SEO fix. Stop here.
   YES → Continue to question 2.

2. Do shoppers CHOOSE me?    (Is BCS ÷ BIS ≥ 0.8?)
   NO  → Visual/creative fix on search results. Stop here.
   YES → Continue to question 3.

3. Do shoppers BUY from me?  (Is BCVS ÷ BCS ≥ 0.8?)
   NO  → Listing page conversion fix.
   YES → Protect, scale, defend.
```

Every single week, your team should ask these three questions for your top 20–30 terms by volume.

---

## What This Report Cannot Tell You

Being equally clear about limitations prevents misdiagnosis:

- **It does not show which ASIN drove the result.** If you have multiple ASINs, all impressions/clicks/purchases are aggregated at the brand level. You need Search Catalog Performance (Chapter 2) to split by ASIN.
- **It does not separate organic from sponsored.** A high BIS could mean strong organic rank, heavy ad spend, or both. You need Campaign Manager data alongside this.
- **It does not show absolute numbers well.** A 50% conversion share on a 10-searches/week term is meaningless. Always weight by Search Query Volume.
- **It is backward-looking by 2–3 days.** Do not use it for same-day decisions.
- **It only shows terms where you got at least one click.** You have blind spots on terms where you have zero presence.
- **It is a snapshot, not a trend.** A single period's SQP data tells you your current state but not whether things are getting better or worse. A BIS of 18% means very different things if it was 12% last month (winning) versus 28% last month (losing). The report has no built-in trend view — you must export and compare periods manually. Weekly or monthly period-over-period tracking of your top 20–30 terms is the minimum to turn SQP from a diagnostic snapshot into an early-warning system. Share erosion is almost always gradual and invisible unless you track it actively.

---

## Common Misreading Mistakes

| Mistake | Why it happens | Why it is wrong |
|---|---|---|
| "Our click share is 40%, great!" | Looks at BCS alone | If BIS is 80%, efficiency is 0.5 — you are underperforming |
| "BIS dropped, our rank must have dropped" | Assumes organic | Could be a competitor increased ad spend, pushing you down in paid positions |
| "Low conversion share means bad listing" | Skips the funnel check | May be a visibility problem — check BIS first |
| Treating all terms equally | Doesn't sort by volume | A 2% share on a 1M volume term is worth more than 50% on a 100 term |
| Making listing changes when BIS is low | Confuses the diagnosis | Fix visibility first, then evaluate whether listing needs work |
| Applying generic-term benchmarks to branded or competitor terms | Doesn't segment by term type | A 4% BCS is a disaster on a generic term but a win on a competitor brand term; 60% BCS is weak on a branded term. Always interpret BCS in context of what type of term it is. |
| Analysing SQP once and filing it | Treats it as a report, not a tracking system | A single snapshot tells you today's state. Without period-over-period comparison, you will miss share erosion until it becomes a revenue problem. |

---

## Chapter 1 Summary

The SQP report answers one meta-question: **"Where in the funnel am I losing customers, and on which terms?"**

It does not answer it directly. You have to calculate the ratios, segment by volume, and apply the scenario framework. That is the skill. Once your team internalises impression→click→purchase as a multi-stage filter with a different fix at each stage, they will stop making the most expensive mistake in Amazon PPC: **spending more money on terms where the problem is actually the listing, not the bids.**

---

*Next: Chapter 2 — Search Catalog Performance (splitting everything above to the individual ASIN level)*
