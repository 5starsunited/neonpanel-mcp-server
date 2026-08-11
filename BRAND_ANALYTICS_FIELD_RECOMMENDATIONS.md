# Brand Analytics Field Recommendations

This inventory compares the legacy Athena outputs with the ClickHouse contracts in `clickhouse_etl`. It defines which values can be migrated directly, which must use weighted aggregation, and which require a new source contract.

The verdicts below were revised after a full inventory of existing ClickHouse objects. Most gaps that initially looked like new-pipeline work are already covered by assets in the warehouse; migration `0046_brand_analytics_enrichment.sql` wires Brand Analytics to them without adding any ingestion.

## Rules

- **Direct:** consume the canonical ClickHouse field as-is.
- **Weighted:** aggregate counts first, then divide once. Never use `avg()` over a percentage.
- **Reuse:** the value already exists in another ClickHouse model; join to it through a semantic view.
- **Unsupported:** the warehouse contains no field from which the value can be honestly derived. Remove it from the tool contract or obtain a separate approved source.

## Existing Assets Reused

| Gap | Existing asset | Exposed as |
| --- | --- | --- |
| Marketplace ID to country code | `app.amazon_marketplaces` | `etl.ba_marketplaces`, `country_code` on `etl.ba_asin_attributes` |
| Revenue class, Pareto class, revenue share | `etl.sku_classification_last30_by_marketplace` | `revenue_abcd_class`, `pareto_abc_class`, `revenue_share` on `etl.ba_asin_attributes` |
| Branded-term classification | `etl.sku_dimensions.brand` | `etl.ba_brand_aliases` |
| PPC impressions, clicks, spend, sales, purchases | `analytics.amazon_ads_search_term_v1_current` | `etl.ba_ppc_search_terms_weekly` |
| Own order counts and net revenue per ASIN week | `analytics.order_details_v2026_current` | `etl.ba_orders_asin_weekly` |
| Inventory, lead time, safety stock | `etl.inventory_planning_slots`, `etl.inventory_calculated_balances`, `etl.sku_planning_attributes` | joined per tool |
| Sales velocity for trend context | `etl.sku_sales_velocity_30d`, `etl.order_sales_velocity_30d` | joined per tool |

Two constraints apply to every reuse above:

- **Week alignment.** The BA producer buckets to a Sunday `week_start`. Daily sources (Ads, orders) must use `toStartOfWeek(d, 0)`; any other mode shifts the join by one day.
- **As-of versus point-in-time.** `etl.sku_classification_last30_by_marketplace` is a rolling last-30-day snapshot. It is a valid current attribute of an ASIN. It is not the class that was in effect during a historical report week, and responses must not imply otherwise.

## Search Query Performance

| Legacy field family | Recommendation |
| --- | --- |
| `searchquerydata_searchquery`, `searchquerydata_searchqueryscore`, `searchquerydata_searchqueryvolume`, `week_start`, `asin` | **Direct:** `search_query`, `search_query_score`, `search_query_volume`, `week_start`, `asin`. |
| `impressiondata_asinimpressioncount`, `clickdata_asinclickcount`, `cartadddata_asincartaddcount`, `purchasedata_asinpurchasecount` | **Direct:** use the corresponding `asin_*_count` fields. |
| `impressiondata_totalqueryimpressioncount`, `clickdata_totalclickcount`, `cartadddata_totalcartaddcount`, `purchasedata_totalpurchasecount` | **Weighted:** these repeat for every ASIN. Use `etl.ba_search_query_performance_portfolio_weekly`, or one `max()` per `(company_id, seller, marketplace_id, week_start, search_query)` before rolling up. |
| `kpi_impression_share`, `kpi_click_share`, `kpi_cart_add_rate`, `kpi_purchase_rate` | **Weighted:** use the count-pair ratio for shares only after grouping. `portfolio_*_share` is provided by the portfolio view. Retain Amazon-provided rate fields until the report specification confirms their denominators. |
| `kpi_*_wow`, `kpi_*_wolast4`, `kpi_*_wolast12`, trend colors | **Weighted:** calculate `lag()` or a windowed weighted baseline from the count-derived weekly metric. Derive colors in the handler from `etl.ba_ryg_thresholds_current`; do not persist colors in ETL. |
| `company`, `parent_asin`, `product_family`, `brand`, `title` | **Direct enrichment:** join through `etl.ba_asin_attributes`. |
| `marketplace_country_code` | **Reuse:** `country_code` is now projected on `etl.ba_search_query_performance`; `etl.ba_marketplaces` gives the complete mapping for marketplaces with no catalog coverage. |
| `revenue_abcd_class`, `pareto_abc_class`, `revenue_share` | **Reuse:** projected from `etl.sku_classification_last30_by_marketplace`. Label them as current-state attributes, not per-week classes. |
| `row_type` | **Handler concern:** this is a presentation flag for detail versus subtotal rows. Compute it where the response is assembled; do not add it to a warehouse contract. |
| `term_type`, branded-term classification | **Reuse:** match the normalized search query against `etl.ba_brand_aliases` for the company. Terms that match no alias are generic; do not guess competitor brands. |
| `ctr_advantage` | **Weighted:** the market denominator is in the report, so this is derivable: ASIN CTR (`asin_click_count / asin_impression_count`) against query CTR (`total_click_count / total_query_impression_count`), aggregated count-first. The legacy value came from the precomputed `search_query_performance_snapshot`, so confirm whether that producer used a difference or a ratio before re-implementing, and record the chosen formula in the tool contract. |

## Search Catalog Performance

| Legacy field family | Recommendation |
| --- | --- |
| impressions, clicks, cart adds, purchases, search-traffic sales, currency | **Direct:** `impression_count`, `click_count`, `cart_add_count`, `purchase_count`, `search_traffic_sales`, `currency_code`. |
| click rate | **Weighted:** `sum(click_count) / sum(impression_count)` when grouped. The per-row `click_rate` is safe only at the report row grain. |
| cart-add rate, purchase rate, sales per click, sales per impression | **Weighted:** `sales_per_click = sum(search_traffic_sales) / sum(click_count)` and `sales_per_impression = sum(search_traffic_sales) / sum(impression_count)` are valid. Do not infer Amazon's cart-add or conversion denominator from field names; keep the report-provided rates at row grain. |
| ASIN, parent ASIN, family, brand, title | **Direct enrichment:** `etl.ba_search_catalog_performance` already joins `etl.ba_asin_attributes`. |
| revenue classes, Pareto classes, revenue share | **Reuse:** now projected on `etl.ba_search_catalog_performance`. |
| inventory context | **Reuse:** join `etl.inventory_planning_slots` and `etl.inventory_calculated_balances` on `inventory_id`, which those models are keyed by; `inventory_id` is exposed on `etl.ba_asin_attributes` for this purpose. `etl.inventory_calculated_balances` is a refreshable materialized view, so state its as-of timestamp in the response. |
| row type | **Handler concern:** presentation flag, as above. |

## Search Terms and Competitive Landscape

| Legacy field family | Recommendation |
| --- | --- |
| search term, clicked ASIN, search-frequency rank, click-share rank, click share, conversion share | **Direct:** `etl.ba_search_terms_current` provides all six fields. |
| top-three competitor rows | **Direct:** filter `click_share_rank <= 3`; do not `ARRAY JOIN`, because ClickHouse receives one canonical row per clicked ASIN/rank. |
| leader click/conversion share, rank-one competitor | **Direct/windowed:** filter rank one or use `argMax(value, -click_share_rank)` per search term and period. |
| share gaps, weak-leader flag, displacement score, momentum | **Derived:** calculate from current and lagged direct shares. Weight a multi-term share with a documented exposure weight; absent an exposure count, report an unweighted summary explicitly rather than presenting it as market-weighted. |
| brand and revenue share for own ASINs | **Reuse:** `etl.ba_search_term_smart` already joins the catalog contract, which now carries brand, revenue share, and classes. |
| competitor brand for third-party clicked ASINs | **Unsupported:** the catalog dimension only covers the company's own ASINs. Return the ASIN and leave the brand unresolved rather than inferring it. |
| category, department | **Unsupported:** the Search Terms report does not provide them and no catalog taxonomy exists in the warehouse. |

## Market Basket and Repeat Purchase

| Legacy field family | Recommendation |
| --- | --- |
| primary ASIN, co-purchased ASIN, rank, combination percentage | **Direct:** `asin`, `purchased_with_asin`, `purchased_with_rank`, `combination_pct`. |
| average combination percentage across weeks | **Weighted only with exposure:** retain per-week values; use a simple average only when the response labels it unweighted. A true weighted average requires the report's basket/order denominator, which is absent. |
| co-purchased product title, brand, family | **Direct enrichment:** join both ASINs to `etl.ba_asin_attributes`; the co-purchased ASIN resolves only when it belongs to the company. |
| repeat purchase count, repeat purchase rate | **Direct:** `repeat_purchase_count`, `repeat_purchase_rate`. |
| total orders, order revenue | **Reuse:** `etl.ba_orders_asin_weekly` supplies `order_count`, `units_ordered`, and `net_revenue` per ASIN week from the company's own orders. This is the seller's order fact, not Amazon's repeat-report denominator, so it must be labelled as own-order context and never substituted into a repeat rate. |
| unique customers, repeat customers, repeat revenue, repeat revenue percentage | **Check `raw_payload` first:** `staging.ba_repeat_purchase` types only `repeat_purchase_count` and `repeat_purchase_rate`, but the producer explodes `dataByAsin` and preserves the whole row in `raw_payload`. Inspect it for order and customer counts; if present, promote them to typed columns in the producer rather than deleting tool fields. Only if they are absent is this genuinely unsupported: no warehouse source carries buyer identity, and `analytics.order_details_v2026_current` has no buyer, customer, or email column. |
| repeat-purchase rate trend | **Weighted only with a denominator:** use a per-week rate trend as an unweighted signal. A weighted rate requires total customer count per ASIN-week, which is unavailable. |

## Shared State and Composite Tools

| Legacy field family | Recommendation |
| --- | --- |
| RYG thresholds, competitors, tracked terms, watchlists, SQP screenshot uploads, user intents, term mappings | **Direct:** migrate to the versioned `etl.ba_*_current` contracts created in migration `0044`. |
| screenshot competitors with rank/click rate | **Direct JSON:** preserve the upload JSON in `competitors_json`; expose structured rows with `JSONExtract` only after a stable upload schema version is defined. |
| growth-machine PPC impressions, clicks, spend, sales, purchases | **Reuse:** `etl.ba_ppc_search_terms_weekly`, joined on `(company_id, marketplace_id, week_start, search_term_norm)` and optionally `promoted_asin`. Filter `ad_product`/`dataset` deliberately: different Ads datasets re-slice the same spend, and the view keeps them in the grain so a roll-up cannot double count silently. |
| growth-machine inventory, replenishment signals | **Reuse:** `etl.inventory_planning_slots`, `etl.inventory_calculated_balances`, `etl.warehouse_lead_time`, and `etl.sku_planning_attributes`, joined via `etl.ba_asin_attributes.inventory_id`. |
| hero status, sibling count | **Reuse:** derive from `etl.ba_asin_attributes`: sibling count is the ASIN count per `parent_asin`, and hero status is the top revenue-share sibling from the reused classification. Document the rule in the tool contract because it is a product definition, not a warehouse field. |
| growth-machine prescriptions and RYG signals | **Derived:** compute after all input metrics have stated grain and denominator; never mix a weekly SQP share with a daily PPC numerator without normalizing the period. |

## Implementation Order

1. Apply migrations `0044` (MCP state), `0045` (portfolio metric contract), and `0046` (enrichment reuse).
2. Migrate direct report fields and point handlers at the enriched `etl.ba_*` contracts.
3. Convert handler aggregations to count-first weighted formulas.
4. Wire composite tools to the reused Ads, orders, and inventory views, normalizing every daily source to the Sunday BA week.
5. Resolve the two open contract questions before touching `tool.json`: the `ctr_advantage` formula used by the legacy snapshot, and whether `staging.ba_repeat_purchase.raw_payload` carries order and customer counts.
6. Remove or explicitly version the fields that remain unsupported: competitor brand and taxonomy for third-party ASINs, and any repeat metric that `raw_payload` does not cover.