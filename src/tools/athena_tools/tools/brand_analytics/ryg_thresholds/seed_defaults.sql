-- Seed default RYG thresholds for Brand Analytics tools.
-- Run once in Athena after creating the table.
--
-- Convention:
--   threshold_value = the BOUNDARY for the given color.
--   For green: metric >= green_threshold  → green
--   For yellow: metric >= yellow_threshold (and < green) → yellow
--   For red: metric < yellow_threshold → red  (i.e. red has no explicit threshold; it's the fallback)
--
--   Exception: signals where red is triggered by an UPPER bound use negative semantics
--   and are documented per-row in signal_description.

INSERT INTO "{{catalog}}"."brand_analytics_iceberg"."ryg_thresholds" (
  user_id, tool, signal_group, metric, color,
  threshold_value, signal_code, signal_description, updated_at
)
VALUES
-- ═══════════════════════════════════════════════════════════════════════════════
-- SEARCH QUERY PERFORMANCE (SQP)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── STRENGTH signal ────────────────────────────────────────────────────────
-- Green: click_share >= 0.12 AND purchase_rate >= 0.09
-- Yellow: click_share >= 0.08 AND purchase_rate >= 0.07
-- Red: fallback
(NULL, 'search_query_performance', 'strength', 'click_share',   'green',  0.12, 'strong_listing_and_intent',  'Strong clickability and purchase intent.',                     current_timestamp),
(NULL, 'search_query_performance', 'strength', 'purchase_rate', 'green',  0.09, 'strong_listing_and_intent',  'Strong clickability and purchase intent.',                     current_timestamp),
(NULL, 'search_query_performance', 'strength', 'click_share',   'yellow', 0.08, 'acceptable_performance',     'Performance is acceptable but not leading.',                   current_timestamp),
(NULL, 'search_query_performance', 'strength', 'purchase_rate', 'yellow', 0.07, 'acceptable_performance',     'Performance is acceptable but not leading.',                   current_timestamp),

-- ─── WEAKNESS signal ────────────────────────────────────────────────────────
-- Red rules (priority order):
--   1) impression_share_wow < 0 AND click_share_wow < 0 → visibility_loss
--   2) click_share < 0.08 AND impression_share >= 0.04 → offer_weakness
--   3) click_share >= 0.12 AND purchase_rate < 0.07 → funnel_leakage
-- Yellow: cart_add_rate < 0.12 OR purchase_rate < 0.07 → intent_mismatch
(NULL, 'search_query_performance', 'weakness', 'click_share',       'red',    0.08, 'offer_weakness',     'Impressions are acceptable but click share is weak.',                                current_timestamp),
(NULL, 'search_query_performance', 'weakness', 'impression_share',  'red',    0.04, 'offer_weakness',     'Impressions are acceptable but click share is weak.',                                current_timestamp),
(NULL, 'search_query_performance', 'weakness', 'click_share_high',  'red',    0.12, 'funnel_leakage',     'Strong clicks but weak purchases suggest PDP/price issues.',                         current_timestamp),
(NULL, 'search_query_performance', 'weakness', 'purchase_rate',     'red',    0.07, 'funnel_leakage',     'Strong clicks but weak purchases suggest PDP/price issues.',                         current_timestamp),
(NULL, 'search_query_performance', 'weakness', 'cart_add_rate',     'yellow', 0.12, 'intent_mismatch',    'Low cart add or purchase rate indicates intent mismatch.',                            current_timestamp),
(NULL, 'search_query_performance', 'weakness', 'purchase_rate',     'yellow', 0.07, 'intent_mismatch',    'Low cart add or purchase rate indicates intent mismatch.',                            current_timestamp),

-- ─── OPPORTUNITY signal ─────────────────────────────────────────────────────
-- Green: cvr_ratio >= 1.3 → fast_delivery_uplift
-- Green: impression_share < 0.04 AND ctr_advantage >= 1.2 → visibility_gap
-- Yellow: impression_share < 0.06 AND ctr_advantage >= 1.2 → moderate_visibility_gap
(NULL, 'search_query_performance', 'opportunity', 'cvr_ratio',         'green',  1.3,  'fast_delivery_uplift',      'Fast-delivery conversion uplift; increase same/one-day availability.',  current_timestamp),
(NULL, 'search_query_performance', 'opportunity', 'impression_share',  'green',  0.04, 'visibility_gap',            'High CTR advantage but low impressions: scale visibility.',            current_timestamp),
(NULL, 'search_query_performance', 'opportunity', 'ctr_advantage',     'green',  1.2,  'visibility_gap',            'High CTR advantage but low impressions: scale visibility.',            current_timestamp),
(NULL, 'search_query_performance', 'opportunity', 'impression_share',  'yellow', 0.06, 'moderate_visibility_gap',   'CTR advantage with moderate impressions: growth possible.',            current_timestamp),
(NULL, 'search_query_performance', 'opportunity', 'ctr_advantage',     'yellow', 1.2,  'moderate_visibility_gap',   'CTR advantage with moderate impressions: growth possible.',            current_timestamp),

-- ─── THRESHOLD/CEILING signal ───────────────────────────────────────────────
-- Red: impression_share >= 0.06 AND ctr_advantage >= 1.5
-- Yellow: impression_share >= 0.05 AND ctr_advantage >= 1.2
(NULL, 'search_query_performance', 'threshold', 'impression_share', 'red',    0.06, 'visibility_ceiling',    'Likely visibility ceiling; growth limited by distribution.', current_timestamp),
(NULL, 'search_query_performance', 'threshold', 'ctr_advantage',    'red',    1.5,  'visibility_ceiling',    'Likely visibility ceiling; growth limited by distribution.', current_timestamp),
(NULL, 'search_query_performance', 'threshold', 'impression_share', 'yellow', 0.05, 'approaching_ceiling',   'Approaching visibility ceiling.',                            current_timestamp),
(NULL, 'search_query_performance', 'threshold', 'ctr_advantage',    'yellow', 1.2,  'approaching_ceiling',   'Approaching visibility ceiling.',                            current_timestamp),

-- ─── TREND signal threshold ─────────────────────────────────────────────────
-- Same ±0.02 threshold used across all 5 trend metrics
(NULL, 'search_query_performance', 'trend', 'delta', 'green',  0.02,  'improving',  'All trend windows (WoW, 4w, 12w) are positive by this delta.',  current_timestamp),
(NULL, 'search_query_performance', 'trend', 'delta', 'red',   -0.02,  'declining',  'All trend windows (WoW, 4w, 12w) are negative by this delta.',  current_timestamp),

-- ═══════════════════════════════════════════════════════════════════════════════
-- SEARCH CATALOG PERFORMANCE
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── STRENGTH signal ────────────────────────────────────────────────────────
(NULL, 'search_catalog_performance', 'strength', 'click_rate',     'green',  0.12, 'strong_engagement_and_conversion', 'Strong clickability and conversion.',                     current_timestamp),
(NULL, 'search_catalog_performance', 'strength', 'purchase_rate',  'green',  0.09, 'strong_engagement_and_conversion', 'Strong clickability and conversion.',                     current_timestamp),
(NULL, 'search_catalog_performance', 'strength', 'click_rate',     'yellow', 0.08, 'acceptable_performance',           'Performance is acceptable but not leading.',              current_timestamp),
(NULL, 'search_catalog_performance', 'strength', 'purchase_rate',  'yellow', 0.07, 'acceptable_performance',           'Performance is acceptable but not leading.',              current_timestamp),

-- ─── WEAKNESS signal ────────────────────────────────────────────────────────
-- Red: wow deltas < -0.02 → engagement_decline
-- Red: click_rate < 0.08 → low_click_rate
-- Red: purchase_rate < 0.07 → low_conversion_rate
-- Yellow: cart_add_rate < 0.12 → low_cart_add_rate
(NULL, 'search_catalog_performance', 'weakness', 'wow_delta',      'red',    -0.02, 'engagement_decline',   'Clicks and purchases are declining week over week.',     current_timestamp),
(NULL, 'search_catalog_performance', 'weakness', 'click_rate',     'red',     0.08, 'low_click_rate',       'Click rate is weak for this catalog item.',              current_timestamp),
(NULL, 'search_catalog_performance', 'weakness', 'purchase_rate',  'red',     0.07, 'low_conversion_rate',  'Conversion rate is weak for this catalog item.',         current_timestamp),
(NULL, 'search_catalog_performance', 'weakness', 'cart_add_rate',  'yellow',  0.12, 'low_cart_add_rate',    'Cart add rate is below target.',                         current_timestamp),

-- ─── OPPORTUNITY signal ─────────────────────────────────────────────────────
(NULL, 'search_catalog_performance', 'opportunity', 'cvr_ratio',      'green',   1.3,  'fast_delivery_uplift', 'Fast-delivery conversion uplift; increase same/one-day availability.', current_timestamp),
(NULL, 'search_catalog_performance', 'opportunity', 'purchase_rate',  'yellow',  0.09, 'scale_traffic',        'Strong conversion with adequate clicks: consider scaling traffic.',     current_timestamp),
(NULL, 'search_catalog_performance', 'opportunity', 'click_rate',     'yellow',  0.08, 'scale_traffic',        'Strong conversion with adequate clicks: consider scaling traffic.',     current_timestamp),

-- ─── THRESHOLD/CEILING signal ───────────────────────────────────────────────
(NULL, 'search_catalog_performance', 'threshold', 'click_rate',     'red',    0.16, 'conversion_ceiling',    'Likely near ceiling; growth may be limited by demand.',           current_timestamp),
(NULL, 'search_catalog_performance', 'threshold', 'purchase_rate',  'red',    0.10, 'conversion_ceiling',    'Likely near ceiling; growth may be limited by demand.',           current_timestamp),
(NULL, 'search_catalog_performance', 'threshold', 'click_rate',     'yellow', 0.12, 'approaching_ceiling',   'Approaching ceiling; optimize for marginal gains.',               current_timestamp),
(NULL, 'search_catalog_performance', 'threshold', 'purchase_rate',  'yellow', 0.09, 'approaching_ceiling',   'Approaching ceiling; optimize for marginal gains.',               current_timestamp),

-- ─── TREND signal threshold ─────────────────────────────────────────────────
(NULL, 'search_catalog_performance', 'trend', 'delta', 'green',  0.02,  'improving',  'All trend windows (WoW, 4w, 12w) are positive by this delta.',  current_timestamp),
(NULL, 'search_catalog_performance', 'trend', 'delta', 'red',   -0.02,  'declining',  'All trend windows (WoW, 4w, 12w) are negative by this delta.',  current_timestamp);
