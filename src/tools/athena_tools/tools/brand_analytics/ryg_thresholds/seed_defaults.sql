-- Seed default RYG thresholds for Brand Analytics tools.
-- Run once in Athena after creating the table.
-- company_id = NULL for system-wide defaults.
-- Company overrides use company_id = <int>.
-- tool = 'sqp' | 'scp' | 'global'

INSERT INTO "{{catalog}}"."brand_analytics_iceberg"."ryg_thresholds" (
  company_id, user_id, tool, signal_group, metric, color,
  threshold_value, signal_code, signal_description, updated_at
)
VALUES
-- ═══════════════════════════════════════════════════════════════════════════════
-- SEARCH QUERY PERFORMANCE (sqp) — system defaults (company_id = NULL)
-- ═══════════════════════════════════════════════════════════════════════════════
(NULL, 'default', 'sqp', 'strength',    'click_share',      'green',   0.12,  'market_leader',    'Top-tier click share (>12%); listing is highly relevant.',            current_timestamp),
(NULL, 'default', 'sqp', 'strength',    'purchase_rate',    'green',   0.09,  'high_intent_win',  'Conversion is elite (>9%); strong social proof/price.',               current_timestamp),
(NULL, 'default', 'sqp', 'strength',    'click_share',      'yellow',  0.08,  'competitive',      'Acceptable click share (≥8%); visible but not dominant.',             current_timestamp),
(NULL, 'default', 'sqp', 'strength',    'purchase_rate',    'yellow',  0.07,  'stable_conv',      'Average conversion (≥7%); listing meets basic expectations.',         current_timestamp),
(NULL, 'default', 'sqp', 'weakness',    'click_share',      'red',     0.08,  'offer_weakness',   'Click share below 8% despite impressions; main image/price failing.', current_timestamp),
(NULL, 'default', 'sqp', 'weakness',    'purchase_rate',    'red',     0.07,  'funnel_leakage',   'Strong clicks but purchase rate <7%; PDP/price friction.',            current_timestamp),
(NULL, 'default', 'sqp', 'opportunity', 'cvr_ratio',        'green',   1.3,   'shipping_alpha',   '1-Day delivery provides >30% CVR lift. Scale FBA.',                   current_timestamp),
(NULL, 'default', 'sqp', 'opportunity', 'impression_share', 'green',   0.04,  'visibility_gap',   'Impression share <4% with CTR advantage; aggressively raise bids.',   current_timestamp),

-- SQP Diagnostic scenario thresholds (Chapter 1 framework)
(NULL, 'default', 'sqp', 'diagnostic', 'impression_share', 'red',    0.05,  'low_visibility',     'BIS below 5% means effectively invisible. Scenario A trigger.',        current_timestamp),
(NULL, 'default', 'sqp', 'diagnostic', 'efficiency_ratio', 'red',    0.6,   'poor_efficiency',    'Click-through or conversion efficiency below 0.6 triggers Scenario B/C.', current_timestamp),

-- ═══════════════════════════════════════════════════════════════════════════════
-- SEARCH CATALOG PERFORMANCE (scp) — system defaults (company_id = NULL)
-- ═══════════════════════════════════════════════════════════════════════════════
(NULL, 'default', 'scp', 'strength',    'click_rate',        'green',  0.01,  'high_ctr',         'ASIN CTR > 1.0% is excellent for search results.',                     current_timestamp),
(NULL, 'default', 'scp', 'strength',    'purchase_rate',     'green',  0.12,  'top_converter',    'ASIN converts >12% of sessions into orders.',                          current_timestamp),
(NULL, 'default', 'scp', 'strength',    'click_rate',        'yellow', 0.005, 'decent_ctr',       'ASIN CTR ≥ 0.5%; visible in search results.',                          current_timestamp),
(NULL, 'default', 'scp', 'strength',    'purchase_rate',     'yellow', 0.05,  'solid_converter',  'ASIN converts ≥ 5% of sessions; above average.',                       current_timestamp),
(NULL, 'default', 'scp', 'opportunity', 'cvr_ratio',         'green',  1.3,   'shipping_alpha',   '1-Day delivery provides >30% CVR lift. Scale FBA inventory.',           current_timestamp),
(NULL, 'default', 'scp', 'threshold',   'impression_share',  'red',    0.25,  'market_ceiling',   'Over 25% share of search; incremental growth is expensive.',           current_timestamp),

-- ═══════════════════════════════════════════════════════════════════════════════
-- GLOBAL (shared across tools) — system defaults (company_id = NULL)
-- ═══════════════════════════════════════════════════════════════════════════════
(NULL, 'default', 'global', 'trend', 'delta', 'green',  0.02,  'growth_sprint',  'Metric improved by >2pp vs previous period.',              current_timestamp),
(NULL, 'default', 'global', 'trend', 'delta', 'red',   -0.02,  'critical_drop',  'Metric declined by >2pp; investigate listing/bid changes.', current_timestamp),

-- ═══════════════════════════════════════════════════════════════════════════════
-- SCP — weakness, ceiling, and opportunity (scale-traffic branch) defaults
-- ═══════════════════════════════════════════════════════════════════════════════
-- Weakness: WoW engagement decline trigger (applies to both CR and PR delta)
(NULL, 'default', 'scp', 'weakness', 'delta',         'red',   -0.02, 'engagement_decline',    'Both CR & PR declined >2pp WoW; investigate listing changes.',     current_timestamp),
-- Weakness: absolute low-metric thresholds (below these is red)
(NULL, 'default', 'scp', 'weakness', 'click_rate',    'red',    0.08, 'low_ctr',               'CTR below 8%; main image, title, or price likely underperforming.', current_timestamp),
(NULL, 'default', 'scp', 'weakness', 'purchase_rate', 'red',    0.07, 'low_cvr',               'CVR below 7%; PDP friction; review content or reviews.',           current_timestamp),
-- Weakness: cart-add rate below acceptable level
(NULL, 'default', 'scp', 'weakness', 'cart_add_rate', 'yellow', 0.12, 'low_cart_rate',         'Cart-add rate below 12%; review A+ content or pricing.',           current_timestamp),
-- Opportunity: scale-traffic branch (good click + purchase rate but no delivery alpha)
(NULL, 'default', 'scp', 'opportunity', 'purchase_rate', 'yellow', 0.09, 'scale_traffic_pr',   'Purchase rate qualifies for scaling; increase ad spend.',          current_timestamp),
(NULL, 'default', 'scp', 'opportunity', 'click_rate',    'yellow', 0.08, 'scale_traffic_cr',   'Click rate qualifies for scaling; raise bids or budget.',          current_timestamp),
-- Ceiling: high-performance saturation thresholds
(NULL, 'default', 'scp', 'ceiling', 'click_rate',    'red',    0.16, 'click_ceiling',          'CTR ≥16%; at market limit, further gains are expensive.',          current_timestamp),
(NULL, 'default', 'scp', 'ceiling', 'click_rate',    'yellow', 0.12, 'approaching_click_cap',  'CTR ≥12%; growth is decelerating.',                                current_timestamp),
(NULL, 'default', 'scp', 'ceiling', 'purchase_rate', 'red',    0.10, 'conv_ceiling',           'CVR ≥10%; near theoretical maximum.',                              current_timestamp),
(NULL, 'default', 'scp', 'ceiling', 'purchase_rate', 'yellow', 0.09, 'high_conv',              'CVR ≥9%; approaching saturation.',                                 current_timestamp),

-- ═══════════════════════════════════════════════════════════════════════════════
-- SQP — weakness, ceiling, and opportunity additional defaults
-- ═══════════════════════════════════════════════════════════════════════════════
-- Weakness: WoW decline trigger (both IS and CS must be < this to fire)
(NULL, 'default', 'sqp', 'weakness', 'delta',             'red',    0.0,   'wow_decline',       'Both IS WoW and CS WoW negative; visibility+engagement declining.',   current_timestamp),
-- Weakness: minimum impression share required to conclude offer weakness
(NULL, 'default', 'sqp', 'weakness', 'impression_share', 'yellow', 0.04,  'min_impression_bar','Min IS threshold (4%) needed to evaluate offer weakness.',            current_timestamp),
-- Weakness: cart-add rate below this is intent mismatch (yellow)
(NULL, 'default', 'sqp', 'weakness', 'cart_add_rate',    'yellow', 0.12,  'low_cart_rate',     'Cart-add rate <12%; low purchase intent; check PDP content.',         current_timestamp),
-- Opportunity: impression share upper bounds for visibility gap
(NULL, 'default', 'sqp', 'opportunity', 'impression_share', 'yellow', 0.06, 'moderate_vis_gap', 'IS <6% with CTR advantage; moderate visibility opportunity.',         current_timestamp),
-- Opportunity: minimum CTR advantage to qualify an IS gap as an opportunity
(NULL, 'default', 'sqp', 'opportunity', 'ctr_advantage',    'green',  1.2,  'ctr_uplift',       'CTR advantage ≥1.2× baseline; listing outperforms category average.', current_timestamp),
-- Ceiling: visibility saturation thresholds
(NULL, 'default', 'sqp', 'ceiling', 'impression_share', 'red',    0.06, 'visibility_ceiling',  'IS ≥6% with strong CTR advantage; near growth ceiling.',              current_timestamp),
(NULL, 'default', 'sqp', 'ceiling', 'impression_share', 'yellow', 0.05, 'near_ceiling',        'IS ≥5% with CTR advantage; approaching ceiling.',                    current_timestamp),
(NULL, 'default', 'sqp', 'ceiling', 'ctr_advantage',    'red',    1.5,  'high_ctr_ceiling',    'CTR advantage ≥1.5×; strong position, further growth limited.',       current_timestamp),
(NULL, 'default', 'sqp', 'ceiling', 'ctr_advantage',    'yellow', 1.2,  'ctr_ceiling_warn',    'CTR advantage ≥1.2×; approaching competitive ceiling.',               current_timestamp),

-- ═══════════════════════════════════════════════════════════════════════════════
-- GROWTH MACHINE (growth_machine) — system defaults (company_id = NULL)
-- Prescription rules consumed by brand_analytics_growth_machine_diagnosis.
-- `signal_code` is the prescription label emitted in the tool output.
-- ═══════════════════════════════════════════════════════════════════════════════

-- PROVEN_WINNER: PPC converts but organic share is weak → inject into SEO.
(NULL, 'default', 'growth_machine', 'proven_winner',  'ppc_cvr',                 'green',  0.10,  'inject_into_seo',       'PPC conversion rate ≥10% combined with low organic brand_purchase_share → move keyword into Title/Bullets for organic capture.', current_timestamp),
(NULL, 'default', 'growth_machine', 'proven_winner',  'brand_purchase_share',    'red',    0.05,  'inject_into_seo',       'Organic purchase share <5% despite proven PPC performance → invisible organically, needs SEO injection.',                          current_timestamp),

-- BLEEDER: PPC burning clicks with no sales → negative exact.
(NULL, 'default', 'growth_machine', 'bleeder',        'ppc_clicks_min',          'red',    10,    'negative_exact',        'Minimum 10 PPC clicks required before flagging as a bleeder.',                                                                     current_timestamp),
(NULL, 'default', 'growth_machine', 'bleeder',        'ppc_sales_max',           'red',    0,     'negative_exact',        'PPC sales = 0 on a high-click term → add as Negative Exact; remove from backend keywords.',                                        current_timestamp),

-- CANNIBALIZATION: Strong organic + still spending on PPC on same term.
(NULL, 'default', 'growth_machine', 'cannibalization','brand_purchase_share',    'green',  0.15,  'defend_organic',        'Organic purchase share ≥15% (Green) → PPC spend likely cannibalizing organic; cut PPC bid.',                                       current_timestamp),
(NULL, 'default', 'growth_machine', 'cannibalization','ppc_spend_min',           'yellow', 50,    'defend_organic',        'Minimum $50 PPC spend to flag cannibalization (avoid false positives on tiny spend).',                                             current_timestamp),

-- CART_LEAK: SCP shows cart-stage drop-off (leak_scenario = C).
(NULL, 'default', 'growth_machine', 'cart_leak',      'cart_to_purchase_rate',   'red',    0.30,  'fix_cart_leak_cut_ppc', 'Cart-add to purchase rate <30% → final-mile leak (Prime badge, delivery speed, basket-level coupon); fix before scaling PPC.',   current_timestamp),
(NULL, 'default', 'growth_machine', 'cart_leak',      'ppc_spend_min',           'yellow', 100,   'fix_cart_leak_cut_ppc', 'Minimum $100 PPC spend to make cart-leak prescription meaningful.',                                                                current_timestamp),

-- WEAK_LEADER: Market leader has low conversion share → displacement opportunity.
(NULL, 'default', 'growth_machine', 'weak_leader',    'leader_conversion_share', 'red',    0.30,  'displace_weak_leader',  'Top-1 product converts <30% of clicks → weak leader; allocate budget to displace.',                                                current_timestamp),
(NULL, 'default', 'growth_machine', 'weak_leader',    'my_share_gap',            'yellow', 0.05,  'displace_weak_leader',  'Gap to leader ≤5pp AND we are already in top-3 → prioritize displacement.',                                                       current_timestamp),

-- DEFEND: Green organic + healthy conversion → defend + maintenance PPC.
(NULL, 'default', 'growth_machine', 'defend',         'brand_purchase_share',    'green',  0.15,  'defend_organic',        'Organic purchase share ≥15% → Green band; maintain ad support at defensive levels and watch for share erosion.',                  current_timestamp),
(NULL, 'default', 'growth_machine', 'defend',         'brand_purchase_share_wow','red',   -0.02,  'defend_organic',        'Purchase share declined >2pp WoW → escalate defense; competitor moves likely.',                                                    current_timestamp);
