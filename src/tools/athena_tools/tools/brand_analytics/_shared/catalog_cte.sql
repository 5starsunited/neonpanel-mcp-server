-- ═══════════════════════════════════════════════════════════════════════════════
-- Shared catalog CTE: brings ASIN ↔ parent ↔ product_family mapping + hero/sibling
-- context from the latest inventory-planning snapshot.
-- Loaded via loadTextFile() and string-injected into consuming tool queries
-- (e.g., brand_analytics_growth_machine_diagnosis).
-- Source of truth mirrors logic in account/lookup_asin_catalog/query.sql.
-- Exposed columns (per row):
--   child_asin, parent_asin, sku, product_name, brand, product_family,
--   country_code AS marketplace, company_id, marketplace_id,
--   revenue_abcd_class, pareto_abc_class, revenue_share,
--   units_30d, revenue_30d, avg_units_7d,
--   sibling_count, is_hero, catalog_snapshot_date
-- Placeholders expected by renderSqlTemplate:
--   {{catalog}}           — Athena data catalog name
--   {{company_ids_array}} — SQL array literal of company ids (required)
-- ═══════════════════════════════════════════════════════════════════════════════
catalog_raw AS (
  SELECT
    s.child_asin,
    s.parent_asin,
    s.sku,
    s.product_name,
    s.brand,
    s.product_family,
    s.country_code        AS marketplace,
    s.company_id,
    s.marketplace_id,
    s.revenue_abcd_class,
    s.pareto_abc_class,
    s.revenue_share,
    s.units_30d,
    s.revenue_30d,
    s.avg_units_7d,
    CAST(current_date AS DATE) AS catalog_snapshot_date
  FROM "{{catalog}}"."inventory_planning"."last_snapshot_inventory_planning" s
  WHERE contains({{company_ids_array}}, s.company_id)
),

catalog AS (
  SELECT
    r.*,
    COUNT(*) OVER (
      PARTITION BY r.parent_asin, r.company_id, r.marketplace_id
    ) AS sibling_count,
    CASE
      WHEN r.parent_asin IS NOT NULL
        AND r.parent_asin <> ''
        AND r.revenue_share = MAX(r.revenue_share) OVER (
          PARTITION BY r.parent_asin, r.company_id, r.marketplace_id
        )
      THEN true
      ELSE false
    END AS is_hero
  FROM catalog_raw r
)
