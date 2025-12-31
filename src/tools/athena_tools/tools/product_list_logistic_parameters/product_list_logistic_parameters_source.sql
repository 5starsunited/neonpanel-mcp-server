CREATE OR REPLACE VIEW product_list_logistic_parameters AS (
SELECT
    p.company_id AS product_company_id,
    CAST(br.name AS VARCHAR) AS brand,
    CAST(ven.name AS VARCHAR) AS vendor,
    CAST(fam.name AS VARCHAR) AS product_family,
    CAST(p.sku AS VARCHAR) AS sku,
    CAST(p.specs AS VARCHAR) AS vendor_product_specs,
    CAST(p.code AS VARCHAR) AS optional_product_code,
    CAST(p.code_type AS VARCHAR) AS optional_product_code_type,

    -- Physical Measurements (Using DOUBLE for Athena/Presto compatibility)
    CAST(p.weight AS DOUBLE) AS product_weight,
    CAST(p.length AS DOUBLE) AS product_length,
    CAST(p.depth AS DOUBLE) AS product_depth,
    CAST(p.height AS DOUBLE) AS product_height,
    CAST(p.length_and_girth AS DOUBLE) AS length_and_girth,
    
    -- Box/Shipping Logic
    CAST(p.box_quantity AS INTEGER) AS box_quantity,
    CAST(p.box_height AS DOUBLE) AS box_height,
    CAST(p.box_depth AS DOUBLE) AS box_depth,
    CAST(p.box_length AS DOUBLE) AS box_length,
    CAST(p.box_weight AS DOUBLE) AS box_weight,
    CAST(p.moq AS INTEGER) AS moq


FROM athenadatacatalog.neonpanel.app_products p

LEFT JOIN athenadatacatalog.neonpanel.app_products_families fam ON fam.id = p.products_family_id
LEFT JOIN athenadatacatalog.neonpanel.brands br ON br.id = p.brand_id
LEFT JOIN athenadatacatalog.neonpanel.vendors ven ON ven.id = p.vendor_id

WHERE p.parent_id is NULL AND p.is_active = 1 )
;