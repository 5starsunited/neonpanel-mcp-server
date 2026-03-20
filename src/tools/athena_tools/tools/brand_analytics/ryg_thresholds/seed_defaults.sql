-- Seed default RYG thresholds for Brand Analytics tools.
-- Run once in Athena after creating the table.
-- user_id = 'default' for system-wide defaults.
-- tool = 'sqp' | 'scp' | 'global'

INSERT INTO "{{catalog}}"."brand_analytics_iceberg"."ryg_thresholds" (
  user_id, tool, signal_group, metric, color,
  threshold_value, signal_code, signal_description, updated_at
)
VALUES
-- ═══════════════════════════════════════════════════════════════════════════════
-- SEARCH QUERY PERFORMANCE (sqp)
-- ═══════════════════════════════════════════════════════════════════════════════
('default', 'sqp', 'strength',    'click_share',      'green',   0.1,   'market_leader',    'Top-tier click share (>10%); listing is highly relevant.',             current_timestamp),
('default', 'sqp', 'strength',    'purchase_rate',    'green',   0.1,   'high_intent_win',  'Conversion is elite (>10%); strong social proof/price.',               current_timestamp),
('default', 'sqp', 'strength',    'click_share',      'yellow',  0.05,  'competitive',      'Moderate click share; visible but not dominant.',                      current_timestamp),
('default', 'sqp', 'strength',    'purchase_rate',    'yellow',  0.07,  'stable_conv',      'Average conversion; listing meets basic expectations.',                current_timestamp),
('default', 'sqp', 'weakness',    'click_share',      'red',     0.03,  'visibility_void',  'Poor click share (<3%); main image or price likely failing.',          current_timestamp),
('default', 'sqp', 'weakness',    'purchase_rate',    'red',     0.04,  'pdp_friction',     'Critical conversion leak; check reviews or UX.',                       current_timestamp),
('default', 'sqp', 'opportunity', 'cvr_ratio',        'green',   1.3,   'shipping_alpha',   '1-Day delivery provides >30% CVR lift. Scale FBA.',                    current_timestamp),
('default', 'sqp', 'opportunity', 'impression_share', 'green',   0.02,  'untapped_volume',  'High CVR but <2% Imp Share. Aggressively raise bids.',                 current_timestamp),

-- ═══════════════════════════════════════════════════════════════════════════════
-- SEARCH CATALOG PERFORMANCE (scp)
-- ═══════════════════════════════════════════════════════════════════════════════
('default', 'scp', 'strength',    'click_rate',        'green',  0.01,  'high_ctr',         'ASIN CTR > 1.0% is excellent for search results.',                     current_timestamp),
('default', 'scp', 'strength',    'purchase_rate',     'green',  0.12,  'top_converter',    'ASIN converts >12% of sessions into orders.',                          current_timestamp),
('default', 'scp', 'threshold',   'impression_share',  'red',    0.25,  'market_ceiling',   'Over 25% share of search; incremental growth is expensive.',           current_timestamp),

-- ═══════════════════════════════════════════════════════════════════════════════
-- GLOBAL (shared across tools)
-- ═══════════════════════════════════════════════════════════════════════════════
('default', 'global', 'trend', 'delta', 'green',  0.05,  'growth_sprint',  'Metric improved by >5% vs previous period.',             current_timestamp),
('default', 'global', 'trend', 'delta', 'red',   -0.08,  'critical_drop',  'Metric declined by >8%; immediate audit required.',       current_timestamp);
