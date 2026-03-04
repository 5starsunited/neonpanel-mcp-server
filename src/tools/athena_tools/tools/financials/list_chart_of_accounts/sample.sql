SELECT 
    a.company_id,
    a.id AS "Account ID",
    a.number AS "Account Number",
    a.name AS "Account Name",
    
    -- Account Type Details
    at.name AS "Account Type",
    at.classification AS "Type Classification",
    at.description AS "Type Description",
    
    -- Account Type Detail Specifics
    atd.name AS "Account Type Detail",
    IF(atd.default = 1, 'Yes', 'No') AS "Is Default Detail",
    
    -- Hierarchy Dimensions
    ap1.name AS "Parent Account Name",
    ap2.name AS "Grandparent Account Name",
    
    -- Iceberg/Trino CONCAT logic
    CONCAT(
        COALESCE(CAST(a.number AS VARCHAR), ''), 
        IF(ap2.name IS NOT NULL, CONCAT(' ', ap2.name, ': '), ' '),
        IF(ap1.name IS NOT NULL, CONCAT(ap1.name, ': '), ''),
        a.name
    ) AS "Account Path"
FROM neonpanel_iceberg.accounts a
LEFT JOIN neonpanel_iceberg.account_types at 
    ON a.account_type_id = at.id 
LEFT JOIN neonpanel_iceberg.account_type_details atd 
    ON atd.account_type_id = at.id 
-- Self-joins for hierarchy
LEFT JOIN neonpanel_iceberg.accounts ap1 
    ON a.parent_id = ap1.id
LEFT JOIN neonpanel_iceberg.accounts ap2 
    ON ap1.parent_id = ap2.id
ORDER BY a.company_id, a.number;