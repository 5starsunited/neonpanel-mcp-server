# Brand Analytics Tools Group

This set of tools enables AI agents to query Amazon Brand Analytics and Advertising data from an Iceberg data lake. The tools facilitate strategic decisions for organic growth, conversion optimization, competitive positioning, and customer retention.

---

## Available Tools

| Tool | Purpose |
|------|---------|
| `brand_analytics_get_keyword_funnel_metrics` | Search funnel data with brand share vs market, trending, funnel drop-off analysis |
| `brand_analytics_get_conversion_leak_analysis` | ASIN-level funnel diagnostics with leak scoring, revenue opportunity, and diagnostic hints |
| `brand_analytics_get_competitive_landscape` | Top 3 competitor analysis with weak leader detection and displacement opportunity scoring |
| `brand_analytics_get_customer_retention_stats` | Repeat purchase rates, LTV, customer segmentation, retention risk scoring, S&S potential |
| `brand_analytics_get_cross_sell_opportunities` | Market basket analysis with bundle scoring, ad targeting opportunities, portfolio gap detection |
| `brand_analytics_get_ad_efficiency` | Ads Search Term analysis with proven winner harvesting, negative mining, ASIN target analysis |

---

## Advanced Description: brand_analytics_get_competitive_landscape

Use this tool to surface the Top 3 clicked products per search term and identify “weak leader” opportunities where the market leader has low conversion share. It runs against the Brand Analytics Search Terms report and aggregates by week, month, or quarter.

**How to use it (test flow):**
- **Required:** Provide `company_id` and one `marketplace` (e.g., `US`).
- **Optional targeting:** Add `search_terms` for specific keywords, `competitor_asins` to focus on rivals, and `my_asins` to compute your position and share gaps.
- **Time window:** Use `start_date`/`end_date`, or omit them and set `periods_back` + `periodicity` to pull the latest periods automatically.
- **Interpretation:**
	- `top_3_products` lists positions with click and conversion share plus trends.
	- `my_position` shows if your ASIN ranks in the Top 3.
	- `weak_leader_analysis` flags low leader conversion share and provides a displacement opportunity score.
	- `share_gaps` shows how far you are from the leader’s share.

**Success criteria:** A keyword is a strong displacement candidate when `weak_leader_analysis.is_weak_leader=true` and `search_frequency_rank` is high (low numeric rank). Prioritize terms where `share_gaps` is small and your ASIN is already in the Top 3.

## Data Sources

- **Brand Analytics (Market Truth):** Organic + Ads combined performance from Amazon's Search Query Performance, Top Search Terms, Market Basket, and Repeat Purchase reports
- **Ads Search Term Report (Efficiency Truth):** What you paid for—spend, clicks, sales, ROAS, ACoS

---

## Strategic Intentions & Tool Usage

Use the Amazon Ads Search Term report alongside Brand Analytics to bridge paid efficiency with organic opportunity.

---

## 1. Intention: Harvest "Proven Winners" for Organic Dominance

* **What to Analyze:** **Ads Search Term Report**  Filter for terms with >0 sales and an ACoS below your target.
* **How to Analyze:** Take these high-converting ad terms and check your **Search Query Performance (SQP)** report to see your "Organic Share" for them.
* **Criteria for Decision:**
* **The Opportunity:** If a term has a high conversion rate in Ads but you have a **Low Brand Share** in SQP.
* **Decision:** This keyword is a proven winner for you but you are "invisible" organically. **Action:** Move this keyword into your **Product Title** or the first two **Bullet Points** to force organic indexing and ranking.



## 2. Intention: Defend the "Conversion Floor" (Negative Mining)

* **What to Analyze:** **Ads Search Term Report**  Filter for terms with >10 clicks and 0 sales.
* **How to Analyze:** Cross-reference these "bleeders" with the **Top Search Terms** report in Brand Analytics.
* **Criteria for Decision:**
* **The Mismatch:** If the search term is a high-volume market term (low SFR) but you have 0% conversion share.
* **Decision:** You are paying for "curiosity clicks" on a term that doesn't fit your product. **Action:** Add these as **Negative Exact** in your ad campaigns and remove them from your listing’s backend keywords to stop wasting "relevance" signals to the algorithm.



## 3. Intention: Expand into "Adjacent Markets"

* **What to Analyze:** **Ads Search Term Report**  Look for **ASINs** (alphanumeric codes like `B07XXXX`) in the Search Term column (from Auto/Product Targeting).
* **How to Analyze:** Use the **Market Basket Analysis** in Brand Analytics to see if these ASINs are already being bought with your products.
* **Criteria for Decision:**
* **The Discovery:** You find an ASIN in your Ads report that converts well but doesn't show up in your "Market Basket."
* **Decision:** You’ve found a competitor/complementary product the market hasn't linked yet. **Action:** Increase bids on that specific ASIN target and consider creating a **Virtual Bundle** with a similar product of your own.



## 4. Intention: Validate "Long-Tail" Profitability

* **What to Analyze:** **Ads Search Term Report**  Filter for search terms with 3+ words and high ROAS.
* **How to Analyze:** Compare these to your **Search Catalog Performance** to see if these long-tail clicks are more "efficient" (higher Cart-Add rate) than broad terms.
* **Criteria for Decision:**
* **The Shift:** If long-tail terms convert 2x better than broad generic terms.
* **Decision:** Stop fighting the "expensive" head-terms. **Action:** Re-allocate 20% of the broad-match budget into a **Manual Exact** campaign for these long-tail winners to own a niche market profitably.



---

### Integration Table: Ads vs. Brand Analytics

| Goal | Use Ads Report to Find... | Cross-Check in Brand Analytics... | High-Level Action |
| --- | --- | --- | --- |
| **Organic Rank** | Terms with high ROAS | Search Query Performance (Share %) | Inject into Listing SEO (Title/Bullets) |
| **Stop Waste** | Clicks with 0 Sales | Top Search Terms (Market CVR) | Negative Exact + SEO Removal |
| **Catalog Growth** | Converting ASIN Targets | Market Basket Analysis | Launch New Product / Bundle |
| **Bid Strategy** | High Conversion % terms | Search Query Volume | Set "Aggressive Bids" on High-Volume Winners |