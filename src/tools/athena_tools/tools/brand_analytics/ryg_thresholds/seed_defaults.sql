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
(NULL, 'default', 'sqp', 'strength',    'click_share',      'green',   0.1,   'market_leader',    'Top-tier click share (>10%); listing is highly relevant.',             current_timestamp),
(NULL, 'default', 'sqp', 'strength',    'purchase_rate',    'green',   0.1,   'high_intent_win',  'Conversion is elite (>10%); strong social proof/price.',               current_timestamp),
(NULL, 'default', 'sqp', 'strength',    'click_share',      'yellow',  0.05,  'competitive',      'Moderate click share; visible but not dominant.',                      current_timestamp),
(NULL, 'default', 'sqp', 'strength',    'purchase_rate',    'yellow',  0.07,  'stable_conv',      'Average conversion; listing meets basic expectations.',                current_timestamp),
(NULL, 'default', 'sqp', 'weakness',    'click_share',      'red',     0.03,  'visibility_void',  'Poor click share (<3%); main image or price likely failing.',          current_timestamp),
(NULL, 'default', 'sqp', 'weakness',    'purchase_rate',    'red',     0.04,  'pdp_friction',     'Critical conversion leak; check reviews or UX.',                       current_timestamp),
(NULL, 'default', 'sqp', 'opportunity', 'cvr_ratio',        'green',   1.3,   'shipping_alpha',   '1-Day delivery provides >30% CVR lift. Scale FBA.',                    current_timestamp),
(NULL, 'default', 'sqp', 'opportunity', 'impression_share', 'green',   0.02,  'untapped_volume',  'High CVR but <2% Imp Share. Aggressively raise bids.',                 current_timestamp),

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
(NULL, 'default', 'global', 'trend', 'delta', 'green',  0.05,  'growth_sprint',  'Metric improved by >5% vs previous period.',             current_timestamp),
(NULL, 'default', 'global', 'trend', 'delta', 'red',   -0.08,  'critical_drop',  'Metric declined by >8%; immediate audit required.',       current_timestamp);
