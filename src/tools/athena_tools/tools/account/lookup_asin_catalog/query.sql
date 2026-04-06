-- Tool: account_lookup_asin_catalog
-- Purpose: ASIN catalog lookup & parent-child mapping from the latest inventory planning snapshot.
-- Notes:
-- - company_id filtering is REQUIRED for authorization.
-- - Uses the last_snapshot_inventory_planning view (pre-filtered to latest partition per company+marketplace+SKU).
-- - When include_siblings is true, expands to all children under matched parent ASINs.

WITH params AS (
  SELECT
    {{company_ids_array}}   AS company_ids,
    {{asin_array}}          AS asin_filter,
    {{parent_asin_array}}   AS parent_asin_filter,
    {{sku_array}}            AS sku_filter,
    {{brand_sql}}            AS brand_filter,
    {{product_family_sql}}   AS product_family_filter,
    {{apply_asin_filter}}    AS apply_asin,
    {{apply_parent_asin_filter}} AS apply_parent_asin,
    {{apply_sku_filter}}     AS apply_sku,
    {{apply_brand_filter}}   AS apply_brand,
    {{apply_product_family_filter}} AS apply_product_family,
    {{include_siblings}}     AS include_siblings
),

-- Step 1: Direct matches based on user filters
direct_matches AS (
  SELECT
    s.child_asin,
    s.parent_asin,
    s.sku,
    s.product_name,
    s.brand,
    s.product_family,
    s.color,
    s.size,
    s.country_code        AS marketplace,
    s.company_id,
    s.marketplace_id,
    s.revenue_abcd_class,
    s.pareto_abc_class,
    s.revenue_share,
    s.units_30d,
    s.revenue_30d,
    s.avg_units_7d,
    s.asin_img_path       AS item_icon_url,
    s.inventory_id,
    s.fnsku
  FROM "{{catalog}}"."inventory_planning"."last_snapshot_inventory_planning" s
  CROSS JOIN params p
  WHERE
    contains(p.company_ids, s.company_id)

    AND (
      NOT p.apply_asin
      OR any_match(p.asin_filter, a -> LOWER(a) = LOWER(s.child_asin))
    )
    AND (
      NOT p.apply_parent_asin
      OR any_match(p.parent_asin_filter, a -> LOWER(a) = LOWER(s.parent_asin))
    )
    AND (
      NOT p.apply_sku
      OR any_match(p.sku_filter, a -> UPPER(TRIM(a)) = UPPER(TRIM(s.sku)))
    )
    AND (
      NOT p.apply_brand
      OR LOWER(s.brand) LIKE '%' || LOWER(p.brand_filter) || '%'
    )
    AND (
      NOT p.apply_product_family
      OR LOWER(s.product_family) LIKE '%' || LOWER(p.product_family_filter) || '%'
    )
    {{marketplace_filter_clause}}
),

-- Step 2: Collect parent ASINs from direct matches to expand siblings
matched_parents AS (
  SELECT DISTINCT parent_asin, company_id, marketplace_id
  FROM direct_matches
  WHERE parent_asin IS NOT NULL AND parent_asin <> ''
),

-- Step 3: If include_siblings, fetch all children under matched parents
sibling_expansion AS (
  SELECT
    s.child_asin,
    s.parent_asin,
    s.sku,
    s.product_name,
    s.brand,
    s.product_family,
    s.color,
    s.size,
    s.country_code        AS marketplace,
    s.company_id,
    s.marketplace_id,
    s.revenue_abcd_class,
    s.pareto_abc_class,
    s.revenue_share,
    s.units_30d,
    s.revenue_30d,
    s.avg_units_7d,
    s.asin_img_path       AS item_icon_url,
    s.inventory_id,
    s.fnsku
  FROM "{{catalog}}"."inventory_planning"."last_snapshot_inventory_planning" s
  INNER JOIN matched_parents mp
    ON s.parent_asin = mp.parent_asin
    AND s.company_id = mp.company_id
    AND s.marketplace_id = mp.marketplace_id
  CROSS JOIN params p
  WHERE
    p.include_siblings
    {{marketplace_filter_clause_sibling}}
),

-- Step 4: Union direct matches + siblings (deduplicate)
all_results AS (
  SELECT * FROM direct_matches
  UNION
  SELECT * FROM sibling_expansion
),

-- Step 5: Compute sibling count and hero flag per parent group
enriched AS (
  SELECT
    r.*,
    COUNT(*) OVER (PARTITION BY r.parent_asin, r.company_id, r.marketplace_id) AS sibling_count,
    CASE
      WHEN r.revenue_share = MAX(r.revenue_share) OVER (PARTITION BY r.parent_asin, r.company_id, r.marketplace_id)
        AND r.parent_asin IS NOT NULL AND r.parent_asin <> ''
      THEN true
      ELSE false
    END AS is_hero
  FROM all_results r
)

SELECT *
FROM enriched
ORDER BY
  company_id,
  marketplace,
  parent_asin,
  revenue_share DESC NULLS LAST
LIMIT {{limit_top_n}};
