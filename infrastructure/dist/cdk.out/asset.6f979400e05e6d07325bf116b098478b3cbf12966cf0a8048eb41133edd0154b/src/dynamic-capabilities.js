"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFreshCapabilities = getFreshCapabilities;
exports.getApiMetadata = getApiMetadata;
exports.clearSchemaCache = clearSchemaCache;
exports.getCacheStatus = getCacheStatus;
const axios_1 = __importDefault(require("axios"));
const NEONPANEL_API_SCHEME_URLS = [
    'https://my.neonpanel.com/api/v1/scheme/3.0.3',
    'https://my.neonpanel.com/api/v1/scheme'
];
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache
let schemaCache = null;
/**
 * Fetches the latest NeonPanel API OpenAPI schema from multiple endpoints
 */
async function fetchNeonPanelSchema() {
    const errors = [];
    for (const url of NEONPANEL_API_SCHEME_URLS) {
        try {
            console.log(`🔄 Trying NeonPanel API schema from: ${url}`);
            const response = await axios_1.default.get(url, {
                timeout: 10000,
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'neonpanel-mcp/1.0.0'
                }
            });
            console.log(`✅ NeonPanel API schema fetched successfully from: ${url}`);
            return response.data;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.log(`❌ Failed to fetch from ${url}: ${errorMessage}`);
            errors.push(`${url}: ${errorMessage}`);
        }
    }
    console.error('❌ Failed to fetch NeonPanel API schema from all endpoints:', errors);
    throw new Error(`Failed to fetch API schema from any endpoint: ${errors.join(', ')}`);
}
/**
 * Gets the cached schema or fetches a fresh one
 */
async function getNeonPanelSchema() {
    const now = Date.now();
    // Return cached schema if it's still fresh
    if (schemaCache && (now - schemaCache.timestamp) < CACHE_DURATION) {
        console.log('📋 Using cached NeonPanel API schema');
        return schemaCache.schema;
    }
    // Fetch fresh schema
    const schema = await fetchNeonPanelSchema();
    schemaCache = {
        schema,
        timestamp: now
    };
    return schema;
}
/**
 * Extracts capabilities from the OpenAPI schema
 */
function extractCapabilitiesFromSchema(schema) {
    const capabilities = [];
    // The NeonPanel schema is a partial OpenAPI schema that starts with components
    // We need to look for the paths section which should be at the root level
    const paths = schema.paths || {};
    console.log('🔍 Found paths:', Object.keys(paths).length);
    console.log('🔍 Schema keys:', Object.keys(schema));
    console.log('🔍 Sample path:', Object.keys(paths)[0]);
    // If no paths found, use fallback capabilities
    if (Object.keys(paths).length === 0) {
        console.log('⚠️ No paths found in schema, using fallback capabilities');
        return getFallbackCapabilities();
    }
    // Group endpoints by functionality
    const inventoryEndpoints = [];
    const financeEndpoints = [];
    const companyEndpoints = [];
    const warehouseEndpoints = [];
    const reportEndpoints = [];
    const importEndpoints = [];
    // Categorize endpoints
    for (const [path, methods] of Object.entries(paths)) {
        for (const [method, operation] of Object.entries(methods)) {
            if (method === 'get' || method === 'post') {
                const op = operation;
                const endpoint = {
                    path,
                    method: method.toUpperCase(),
                    operationId: op.operationId,
                    summary: op.summary,
                    description: op.description,
                    parameters: op.parameters || [],
                    requestBody: op.requestBody,
                    responses: op.responses,
                    security: op.security
                };
                if (path.includes('/inventory-items')) {
                    inventoryEndpoints.push(endpoint);
                }
                else if (path.includes('/revenue-and-cogs')) {
                    financeEndpoints.push(endpoint);
                }
                else if (path.includes('/companies') && !path.includes('/inventory') && !path.includes('/warehouses')) {
                    companyEndpoints.push(endpoint);
                }
                else if (path.includes('/warehouses')) {
                    warehouseEndpoints.push(endpoint);
                }
                else if (path.includes('/reports')) {
                    reportEndpoints.push(endpoint);
                }
                else if (path.includes('/import')) {
                    importEndpoints.push(endpoint);
                }
            }
        }
    }
    // Build capabilities from categorized endpoints
    if (inventoryEndpoints.length > 0) {
        capabilities.push({
            capability_name: 'neonpanel_inventory',
            description: 'NeonPanel inventory management capabilities',
            actions: inventoryEndpoints.map(endpoint => ({
                action_id: endpoint.operationId || `${endpoint.method.toLowerCase()}_${endpoint.path.replace(/[^a-zA-Z0-9]/g, '_')}`,
                name: endpoint.summary || endpoint.operationId,
                description: endpoint.description || endpoint.summary,
                method: endpoint.method,
                path: endpoint.path,
                input_schema: buildInputSchema(endpoint),
                output_schema: buildOutputSchema(endpoint),
                parameters: endpoint.parameters.map((p) => ({
                    name: p.name,
                    in: p.in,
                    required: p.required || false,
                    type: p.schema?.type || 'string',
                    description: p.description,
                    example: p.schema?.example
                }))
            }))
        });
    }
    if (financeEndpoints.length > 0) {
        capabilities.push({
            capability_name: 'neonpanel_finance',
            description: 'NeonPanel finance and analytics capabilities',
            actions: financeEndpoints.map(endpoint => ({
                action_id: endpoint.operationId || `${endpoint.method.toLowerCase()}_${endpoint.path.replace(/[^a-zA-Z0-9]/g, '_')}`,
                name: endpoint.summary || endpoint.operationId,
                description: endpoint.description || endpoint.summary,
                method: endpoint.method,
                path: endpoint.path,
                input_schema: buildInputSchema(endpoint),
                output_schema: buildOutputSchema(endpoint),
                parameters: endpoint.parameters.map((p) => ({
                    name: p.name,
                    in: p.in,
                    required: p.required || false,
                    type: p.schema?.type || 'string',
                    description: p.description,
                    example: p.schema?.example
                }))
            }))
        });
    }
    if (companyEndpoints.length > 0) {
        capabilities.push({
            capability_name: 'neonpanel_companies',
            description: 'NeonPanel company management capabilities',
            actions: companyEndpoints.map(endpoint => ({
                action_id: endpoint.operationId || `${endpoint.method.toLowerCase()}_${endpoint.path.replace(/[^a-zA-Z0-9]/g, '_')}`,
                name: endpoint.summary || endpoint.operationId,
                description: endpoint.description || endpoint.summary,
                method: endpoint.method,
                path: endpoint.path,
                input_schema: buildInputSchema(endpoint),
                output_schema: buildOutputSchema(endpoint),
                parameters: endpoint.parameters.map((p) => ({
                    name: p.name,
                    in: p.in,
                    required: p.required || false,
                    type: p.schema?.type || 'string',
                    description: p.description,
                    example: p.schema?.example
                }))
            }))
        });
    }
    if (warehouseEndpoints.length > 0) {
        capabilities.push({
            capability_name: 'neonpanel_warehouses',
            description: 'NeonPanel warehouse management capabilities',
            actions: warehouseEndpoints.map(endpoint => ({
                action_id: endpoint.operationId || `${endpoint.method.toLowerCase()}_${endpoint.path.replace(/[^a-zA-Z0-9]/g, '_')}`,
                name: endpoint.summary || endpoint.operationId,
                description: endpoint.description || endpoint.summary,
                method: endpoint.method,
                path: endpoint.path,
                input_schema: buildInputSchema(endpoint),
                output_schema: buildOutputSchema(endpoint),
                parameters: endpoint.parameters.map((p) => ({
                    name: p.name,
                    in: p.in,
                    required: p.required || false,
                    type: p.schema?.type || 'string',
                    description: p.description,
                    example: p.schema?.example
                }))
            }))
        });
    }
    if (reportEndpoints.length > 0) {
        capabilities.push({
            capability_name: 'neonpanel_reports',
            description: 'NeonPanel reporting capabilities',
            actions: reportEndpoints.map(endpoint => ({
                action_id: endpoint.operationId || `${endpoint.method.toLowerCase()}_${endpoint.path.replace(/[^a-zA-Z0-9]/g, '_')}`,
                name: endpoint.summary || endpoint.operationId,
                description: endpoint.description || endpoint.summary,
                method: endpoint.method,
                path: endpoint.path,
                input_schema: buildInputSchema(endpoint),
                output_schema: buildOutputSchema(endpoint),
                parameters: endpoint.parameters.map((p) => ({
                    name: p.name,
                    in: p.in,
                    required: p.required || false,
                    type: p.schema?.type || 'string',
                    description: p.description,
                    example: p.schema?.example
                }))
            }))
        });
    }
    if (importEndpoints.length > 0) {
        capabilities.push({
            capability_name: 'neonpanel_import',
            description: 'NeonPanel document import capabilities',
            actions: importEndpoints.map(endpoint => ({
                action_id: endpoint.operationId || `${endpoint.method.toLowerCase()}_${endpoint.path.replace(/[^a-zA-Z0-9]/g, '_')}`,
                name: endpoint.summary || endpoint.operationId,
                description: endpoint.description || endpoint.summary,
                method: endpoint.method,
                path: endpoint.path,
                input_schema: buildInputSchema(endpoint),
                output_schema: buildOutputSchema(endpoint),
                parameters: endpoint.parameters.map((p) => ({
                    name: p.name,
                    in: p.in,
                    required: p.required || false,
                    type: p.schema?.type || 'string',
                    description: p.description,
                    example: p.schema?.example
                }))
            }))
        });
    }
    return capabilities;
}
/**
 * Builds input schema from OpenAPI endpoint definition
 */
function buildInputSchema(endpoint) {
    const properties = {};
    const required = [];
    // Process path parameters
    endpoint.parameters?.forEach((param) => {
        if (param.in === 'path') {
            properties[param.name] = {
                type: param.schema?.type || 'string',
                description: param.description,
                example: param.schema?.example
            };
            if (param.required) {
                required.push(param.name);
            }
        }
        else if (param.in === 'query') {
            properties[param.name] = {
                type: param.schema?.type || 'string',
                description: param.description,
                example: param.schema?.example,
                minimum: param.schema?.minimum,
                maximum: param.schema?.maximum,
                minLength: param.schema?.minLength,
                maxLength: param.schema?.maxLength,
                pattern: param.schema?.pattern,
                enum: param.schema?.enum
            };
            if (param.required) {
                required.push(param.name);
            }
        }
    });
    // Process request body
    if (endpoint.requestBody?.content?.['application/json']?.schema) {
        const bodySchema = endpoint.requestBody.content['application/json'].schema;
        if (bodySchema.properties) {
            Object.assign(properties, bodySchema.properties);
        }
        if (bodySchema.required) {
            required.push(...bodySchema.required);
        }
    }
    return {
        type: 'object',
        properties,
        required: required.length > 0 ? required : undefined
    };
}
/**
 * Builds output schema from OpenAPI endpoint definition
 */
function buildOutputSchema(endpoint) {
    const successResponse = endpoint.responses?.['200'] || endpoint.responses?.['201'];
    if (successResponse?.content?.['application/json']?.schema) {
        return successResponse.content['application/json'].schema;
    }
    return {
        type: 'object',
        properties: {
            success: { type: 'boolean' },
            data: { type: 'object' },
            message: { type: 'string' }
        }
    };
}
/**
 * Gets fresh capabilities from the NeonPanel API
 */
async function getFreshCapabilities() {
    try {
        const schema = await getNeonPanelSchema();
        const capabilities = extractCapabilitiesFromSchema(schema);
        // If no capabilities were extracted, use fallback
        if (capabilities.length === 0) {
            console.log('⚠️ No capabilities extracted from schema, using fallback');
            return getFallbackCapabilities();
        }
        console.log(`✅ Generated ${capabilities.length} capabilities from fresh API schema`);
        return capabilities;
    }
    catch (error) {
        console.error('❌ Failed to get fresh capabilities:', error);
        // Return fallback capabilities if API is unavailable
        return getFallbackCapabilities();
    }
}
/**
 * Fallback capabilities when API is unavailable
 */
function getFallbackCapabilities() {
    console.log('⚠️ Using fallback capabilities based on NeonPanel API schema 3.0.0');
    return [
        {
            capability_name: 'neonpanel.companies',
            description: 'NeonPanel company management capabilities',
            actions: [
                {
                    action_id: 'neonpanel.companies.listCompanies',
                    name: 'List Companies',
                    description: 'Retrieve paginated list of available companies for user',
                    method: 'GET',
                    path: '/api/v1/companies',
                    input_schema: {
                        type: 'object',
                        properties: {
                            page: { type: 'integer', minimum: 1, default: 1 },
                            per_page: { type: 'integer', minimum: 10, maximum: 60, default: 30 }
                        }
                    },
                    output_schema: {
                        type: 'object',
                        properties: {
                            current_page: { type: 'integer' },
                            per_page: { type: 'integer' },
                            last_page: { type: 'integer' },
                            data: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        uuid: { type: 'string' },
                                        name: { type: 'string' },
                                        currency: { type: 'string' },
                                        timezone: { type: 'string' }
                                    }
                                }
                            }
                        }
                    }
                }
            ]
        },
        {
            capability_name: 'neonpanel.warehouses',
            description: 'NeonPanel warehouse management capabilities',
            actions: [
                {
                    action_id: 'neonpanel.warehouses.listWarehouses',
                    name: 'List Warehouses',
                    description: 'Retrieve paginated list of warehouses for a company',
                    method: 'GET',
                    path: '/api/v1/companies/{companyUuid}/warehouses',
                    input_schema: {
                        type: 'object',
                        properties: {
                            companyUuid: { type: 'string', description: 'The UUID of the company' },
                            page: { type: 'integer', minimum: 1, default: 1 },
                            per_page: { type: 'integer', minimum: 10, maximum: 60, default: 30 },
                            search: { type: 'string', description: 'Search by Warehouse name' }
                        },
                        required: ['companyUuid']
                    },
                    output_schema: {
                        type: 'object',
                        properties: {
                            current_page: { type: 'integer' },
                            per_page: { type: 'integer' },
                            last_page: { type: 'integer' },
                            data: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        uuid: { type: 'string' },
                                        name: { type: 'string' },
                                        type: { type: 'string', nullable: true },
                                        country_code: { type: 'string', nullable: true }
                                    }
                                }
                            }
                        }
                    }
                }
            ]
        },
        {
            capability_name: 'neonpanel.inventory',
            description: 'NeonPanel inventory management capabilities',
            actions: [
                {
                    action_id: 'neonpanel.inventory.listInventoryItems',
                    name: 'List Inventory Items',
                    description: 'Retrieve paginated list of company inventory with filters and search',
                    method: 'GET',
                    path: '/api/v1/companies/{companyUuid}/inventory-items',
                    input_schema: {
                        type: 'object',
                        properties: {
                            companyUuid: { type: 'string', description: 'The UUID of the company' },
                            page: { type: 'integer', minimum: 1, default: 1 },
                            per_page: { type: 'integer', minimum: 10, maximum: 60, default: 30 },
                            country_code: { type: 'string', minLength: 2, maxLength: 2 },
                            search: { type: 'string', description: 'Search by SKU, ASIN, FnSKU, ID or Name' },
                            fnsku: { type: 'string' },
                            asin: { type: 'string' },
                            sku: { type: 'string' }
                        },
                        required: ['companyUuid']
                    },
                    output_schema: {
                        type: 'object',
                        properties: {
                            current_page: { type: 'integer' },
                            per_page: { type: 'integer' },
                            last_page: { type: 'integer' },
                            filters: {
                                type: 'object',
                                properties: {
                                    country_code: { type: 'string' },
                                    search: { type: 'string' },
                                    fnsku: { type: 'string' },
                                    asin: { type: 'string' },
                                    sku: { type: 'string' }
                                }
                            },
                            data: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        id: { type: 'integer' },
                                        name: { type: 'string' },
                                        fnsku: { type: 'string' },
                                        asin: { type: 'string' },
                                        sku: { type: 'string' },
                                        image: { type: 'string', format: 'uri', nullable: true },
                                        country_code: { type: 'string' },
                                        weight: { type: 'number', description: 'Weight in pounds' },
                                        length: { type: 'number', description: 'Length in inches' },
                                        height: { type: 'number', description: 'Height in inches' },
                                        depth: { type: 'number', description: 'Depth in inches' }
                                    }
                                }
                            }
                        }
                    }
                },
                {
                    action_id: 'neonpanel.inventory.getInventoryCogs',
                    name: 'Get Inventory COGS',
                    description: 'Retrieve detailed cost of goods sold (COGS) for inventory by period',
                    method: 'GET',
                    path: '/api/v1/companies/{companyUuid}/inventory-items/{inventoryId}/cogs',
                    input_schema: {
                        type: 'object',
                        properties: {
                            companyUuid: { type: 'string', description: 'The UUID of the company' },
                            inventoryId: { type: 'integer', description: 'The ID of the inventory item' },
                            page: { type: 'integer', minimum: 1, default: 1 },
                            per_page: { type: 'integer', minimum: 10, maximum: 60, default: 30 },
                            start_date: { type: 'string', format: 'date', description: 'Start date (required)' },
                            end_date: { type: 'string', format: 'date', description: 'End date (defaults to current date)' }
                        },
                        required: ['companyUuid', 'inventoryId', 'start_date']
                    },
                    output_schema: {
                        type: 'object',
                        properties: {
                            current_page: { type: 'integer' },
                            per_page: { type: 'integer' },
                            last_page: { type: 'integer' },
                            filters: {
                                type: 'object',
                                properties: {
                                    country_code: { type: 'string' },
                                    start_date: { type: 'string', format: 'date' },
                                    end_date: { type: 'string', format: 'date' }
                                }
                            },
                            company: {
                                type: 'object',
                                properties: {
                                    uuid: { type: 'string' },
                                    name: { type: 'string' },
                                    currency: { type: 'string' },
                                    timezone: { type: 'string' }
                                }
                            },
                            inventory: {
                                type: 'object',
                                properties: {
                                    id: { type: 'integer' },
                                    name: { type: 'string' },
                                    fnsku: { type: 'string' },
                                    asin: { type: 'string' },
                                    sku: { type: 'string' }
                                }
                            },
                            currency: { type: 'string' },
                            amount: { type: 'number' },
                            lost_amount: { type: 'number' },
                            total_amount: { type: 'number' },
                            quantity: { type: 'integer' },
                            details: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        document: {
                                            type: 'object',
                                            properties: {
                                                type: { type: 'string' },
                                                link: { type: 'string', format: 'uri' },
                                                status: { type: 'string' },
                                                completed: { type: 'string', format: 'date-time', nullable: true },
                                                ref_number: { type: 'string', nullable: true },
                                                date: { type: 'string', format: 'date', nullable: true }
                                            }
                                        },
                                        currency: { type: 'string' },
                                        amount: { type: 'number' },
                                        quantity: { type: 'integer' },
                                        details: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    type: { type: 'string' },
                                                    batch: { type: 'object' },
                                                    document: { type: 'object' },
                                                    currency: { type: 'string' },
                                                    amount: { type: 'number' },
                                                    quantity: { type: 'integer' }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                {
                    action_id: 'neonpanel.inventory.getInventoryLandedCost',
                    name: 'Get Inventory Landed Cost',
                    description: 'Retrieve detailed manufacturing expenses (Landed Costs) for specified inventory by period and warehouse',
                    method: 'GET',
                    path: '/api/v1/companies/{companyUuid}/inventory-items/{inventoryId}/landed-cost',
                    input_schema: {
                        type: 'object',
                        properties: {
                            companyUuid: { type: 'string', description: 'The UUID of the company' },
                            inventoryId: { type: 'integer', description: 'The ID of the inventory item' },
                            warehouse_uuid: { type: 'string', description: 'The UUID of the warehouse' },
                            page: { type: 'integer', minimum: 1, default: 1 },
                            per_page: { type: 'integer', minimum: 10, maximum: 60, default: 30 },
                            start_date: { type: 'string', format: 'date', description: 'Start date (required)' },
                            end_date: { type: 'string', format: 'date', description: 'End date (defaults to current date)' }
                        },
                        required: ['companyUuid', 'inventoryId', 'warehouse_uuid', 'start_date']
                    },
                    output_schema: {
                        type: 'object',
                        properties: {
                            current_page: { type: 'integer' },
                            per_page: { type: 'integer' },
                            last_page: { type: 'integer' },
                            filters: {
                                type: 'object',
                                properties: {
                                    country_code: { type: 'string' },
                                    warehouse_uuid: { type: 'string' },
                                    start_date: { type: 'string', format: 'date' },
                                    end_date: { type: 'string', format: 'date' }
                                }
                            },
                            company: {
                                type: 'object',
                                properties: {
                                    uuid: { type: 'string' },
                                    name: { type: 'string' },
                                    currency: { type: 'string' },
                                    timezone: { type: 'string' }
                                }
                            },
                            inventory: {
                                type: 'object',
                                properties: {
                                    id: { type: 'integer' },
                                    name: { type: 'string' },
                                    fnsku: { type: 'string' },
                                    asin: { type: 'string' },
                                    sku: { type: 'string' }
                                }
                            },
                            warehouse: {
                                type: 'object',
                                properties: {
                                    uuid: { type: 'string' },
                                    name: { type: 'string' },
                                    type: { type: 'string', nullable: true },
                                    country_code: { type: 'string', nullable: true }
                                }
                            },
                            currency: { type: 'string' },
                            amount: { type: 'number' },
                            quantity: { type: 'integer' },
                            data: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        batch: {
                                            type: 'object',
                                            properties: {
                                                type: { type: 'string' },
                                                link: { type: 'string', format: 'uri' },
                                                status: { type: 'string' },
                                                completed: { type: 'string', format: 'date-time', nullable: true },
                                                ref_number: { type: 'string', nullable: true },
                                                date: { type: 'string', format: 'date', nullable: true }
                                            }
                                        },
                                        currency: { type: 'string' },
                                        amount: { type: 'number' },
                                        quantity: { type: 'integer' },
                                        details: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    type: { type: 'string' },
                                                    document: { type: 'object' },
                                                    currency: { type: 'string' },
                                                    amount: { type: 'number' },
                                                    quantity: { type: 'integer' }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            ]
        },
        {
            capability_name: 'neonpanel.analytics',
            description: 'NeonPanel analytics and reporting capabilities',
            actions: [
                {
                    action_id: 'neonpanel.analytics.getRevenueAndCogs',
                    name: 'Get Revenue and COGS',
                    description: 'Retrieve volume of Revenue and Cost of Goods Sold (COGS) by specified period and grouping type',
                    method: 'GET',
                    path: '/api/v1/revenue-and-cogs',
                    input_schema: {
                        type: 'object',
                        properties: {
                            company_uuids: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Filter by Companies. Defaults to all accessible for user companies'
                            },
                            country_codes: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Filter by countries. Defaults to all accessible for company marketplaces'
                            },
                            grouping: {
                                type: 'array',
                                items: { type: 'string', enum: ['company', 'country', 'invoice'] },
                                description: 'Type of grouping of results. If not provided, company grouping will be set'
                            },
                            periodicity: {
                                type: 'string',
                                enum: ['total', 'yearly', 'quarterly', 'monthly'],
                                default: 'total',
                                description: 'Chunking results by time periods'
                            },
                            start_date: {
                                type: 'string',
                                format: 'date',
                                description: 'Start date (required)',
                                example: '2024-01-01'
                            },
                            end_date: {
                                type: 'string',
                                format: 'date',
                                description: 'End date (defaults to current date)',
                                example: '2024-12-31'
                            }
                        },
                        required: ['start_date']
                    },
                    output_schema: {
                        type: 'object',
                        properties: {
                            filters: {
                                type: 'object',
                                properties: {
                                    company_uuids: { type: 'array', items: { type: 'string' } },
                                    country_codes: { type: 'array', items: { type: 'string' } },
                                    periodicity: { type: 'string' },
                                    grouping: { type: 'array', items: { type: 'string' } },
                                    start_date: { type: 'string', format: 'date' },
                                    end_date: { type: 'string', format: 'date' }
                                }
                            },
                            data: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        start_date: { type: 'string', format: 'date' },
                                        end_date: { type: 'string', format: 'date' },
                                        revenue_amount: { type: 'number', description: 'Amount of Inventories sold' },
                                        cogs_amount: { type: 'number', description: 'Cost of Inventories sold' },
                                        currency: { type: 'string', description: 'Currency of amounts provided' },
                                        company: {
                                            type: 'object',
                                            nullable: true,
                                            description: 'Company data if in grouping parameter company was provided',
                                            properties: {
                                                uuid: { type: 'string' },
                                                name: { type: 'string' },
                                                currency: { type: 'string' },
                                                timezone: { type: 'string' }
                                            }
                                        },
                                        country_code: {
                                            type: 'string',
                                            nullable: true,
                                            description: 'Country code if in grouping parameter country was provided'
                                        },
                                        invoice: {
                                            type: 'object',
                                            nullable: true,
                                            description: 'Invoice data if in grouping parameter invoice was provided',
                                            properties: {
                                                type: { type: 'string' },
                                                link: { type: 'string', format: 'uri' },
                                                status: { type: 'string' },
                                                completed: { type: 'string', format: 'date-time', nullable: true },
                                                ref_number: { type: 'string', nullable: true },
                                                date: { type: 'string', format: 'date', nullable: true }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            ]
        },
        {
            capability_name: 'neonpanel.reports',
            description: 'NeonPanel reporting capabilities',
            actions: [
                {
                    action_id: 'neonpanel.reports.listReports',
                    name: 'List Reports',
                    description: 'Retrieve list of accessible Reports with their URLs',
                    method: 'GET',
                    path: '/api/v1/reports',
                    input_schema: {
                        type: 'object',
                        properties: {}
                    },
                    output_schema: {
                        type: 'object',
                        properties: {
                            count: { type: 'integer', description: 'Count of Reports available and accessible' },
                            data: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        title: { type: 'string', description: 'Name of Report' },
                                        group: { type: 'string', description: 'Title of Report\'s Group' },
                                        description: { type: 'string' },
                                        query_filters: {
                                            type: 'array',
                                            description: 'Filters you can set in Report URL as query parameter',
                                            items: { type: 'string' }
                                        },
                                        link: { type: 'string', format: 'uri' }
                                    }
                                }
                            }
                        }
                    }
                }
            ]
        },
        {
            capability_name: 'neonpanel.import',
            description: 'NeonPanel document import capabilities',
            actions: [
                {
                    action_id: 'neonpanel.import.getImportInstructions',
                    name: 'Get Import Instructions',
                    description: 'Retrieve document upload instructions',
                    method: 'GET',
                    path: '/api/v1/import/{type}/instructions',
                    input_schema: {
                        type: 'object',
                        properties: {
                            type: {
                                type: 'string',
                                enum: ['bill'],
                                description: 'Import type. Currently only "bill" is supported'
                            }
                        },
                        required: ['type']
                    },
                    output_schema: {
                        type: 'object',
                        properties: {
                            attributes: {
                                type: 'object',
                                description: 'Object with keys as parameter name and value as description'
                            },
                            general: {
                                type: 'string',
                                description: 'General specifications and tips'
                            }
                        }
                    }
                },
                {
                    action_id: 'neonpanel.import.createDocuments',
                    name: 'Create Documents',
                    description: 'Creates documents by JSON payload. Structure of data can be obtained by getImportInstructions operation',
                    method: 'POST',
                    path: '/api/v1/companies/{companyUuid}/create/{type}',
                    input_schema: {
                        type: 'object',
                        properties: {
                            companyUuid: {
                                type: 'string',
                                format: 'uuid',
                                description: 'The UUID of the company'
                            },
                            type: {
                                type: 'string',
                                enum: ['bill'],
                                description: 'Import type'
                            },
                            data: {
                                type: 'object',
                                description: 'Document parameters with line items included. Structure can be obtained by getImportInstructions operation'
                            }
                        },
                        required: ['companyUuid', 'type', 'data']
                    },
                    output_schema: {
                        type: 'object',
                        properties: {
                            request_id: { type: 'string', format: 'uuid' },
                            status: {
                                type: 'string',
                                enum: ['queued', 'processing', 'done', 'error'],
                                description: 'Status of import'
                            },
                            documents: {
                                type: 'array',
                                description: 'Documents created from the uploaded file',
                                items: {
                                    type: 'object',
                                    properties: {
                                        type: { type: 'string' },
                                        link: { type: 'string', format: 'uri' },
                                        status: { type: 'string' },
                                        completed: { type: 'string', format: 'date-time', nullable: true },
                                        ref_number: { type: 'string', nullable: true },
                                        date: { type: 'string', format: 'date', nullable: true }
                                    }
                                }
                            }
                        }
                    }
                },
                {
                    action_id: 'neonpanel.import.createDocumentsByPdf',
                    name: 'Create Documents by PDF',
                    description: 'Upload a single PDF file as raw binary and create documents',
                    method: 'POST',
                    path: '/api/v1/companies/{companyUuid}/import/{type}/pdf',
                    input_schema: {
                        type: 'object',
                        properties: {
                            companyUuid: {
                                type: 'string',
                                format: 'uuid',
                                description: 'The UUID of the company'
                            },
                            type: {
                                type: 'string',
                                enum: ['bill'],
                                description: 'Import type'
                            },
                            filename: {
                                type: 'string',
                                description: 'Original filename to store alongside the uploaded PDF, required for application/pdf request'
                            },
                            file: {
                                type: 'string',
                                format: 'binary',
                                description: 'PDF file content'
                            }
                        },
                        required: ['companyUuid', 'type', 'filename', 'file']
                    },
                    output_schema: {
                        type: 'object',
                        properties: {
                            request_id: { type: 'string', format: 'uuid', description: 'Request ID of created import' },
                            status: {
                                type: 'string',
                                enum: ['queued', 'processing', 'done', 'error'],
                                description: 'Status of import'
                            }
                        }
                    }
                },
                {
                    action_id: 'neonpanel.import.checkImportProcessing',
                    name: 'Check Import Processing',
                    description: 'Check status of import processing',
                    method: 'GET',
                    path: '/api/v1/companies/{companyUuid}/import/{type}/status/{requestId}',
                    input_schema: {
                        type: 'object',
                        properties: {
                            companyUuid: {
                                type: 'string',
                                format: 'uuid',
                                description: 'The UUID of the company'
                            },
                            type: {
                                type: 'string',
                                enum: ['bill'],
                                description: 'Import type'
                            },
                            requestId: {
                                type: 'string',
                                format: 'uuid',
                                description: 'Request ID of the previously created import'
                            }
                        },
                        required: ['companyUuid', 'type', 'requestId']
                    },
                    output_schema: {
                        type: 'object',
                        properties: {
                            request_id: { type: 'string', format: 'uuid' },
                            status: {
                                type: 'string',
                                enum: ['queued', 'processing', 'done', 'error'],
                                description: 'Status of import'
                            },
                            documents: {
                                type: 'array',
                                description: 'Documents created from the uploaded file',
                                items: {
                                    type: 'object',
                                    properties: {
                                        type: { type: 'string' },
                                        link: { type: 'string', format: 'uri' },
                                        status: { type: 'string' },
                                        completed: { type: 'string', format: 'date-time', nullable: true },
                                        ref_number: { type: 'string', nullable: true },
                                        date: { type: 'string', format: 'date', nullable: true }
                                    }
                                }
                            }
                        }
                    }
                }
            ]
        }
    ];
}
/**
 * Gets API schema metadata
 */
async function getApiMetadata() {
    try {
        const schema = await getNeonPanelSchema();
        return {
            title: schema.info?.title || 'NeonPanel API',
            version: schema.info?.version || '1.0.0',
            description: schema.info?.description || 'NeonPanel API for inventory and finance management',
            baseUrl: schema.servers?.[0]?.url || 'https://my.neonpanel.com',
            lastUpdated: new Date(schemaCache?.timestamp || Date.now()).toISOString(),
            totalEndpoints: Object.keys(schema.paths || {}).length,
            capabilities: (await getFreshCapabilities()).length
        };
    }
    catch (error) {
        console.error('❌ Failed to get API metadata:', error);
        return {
            title: 'NeonPanel API (Fallback)',
            version: '1.0.0',
            description: 'NeonPanel API - using fallback data',
            baseUrl: 'https://my.neonpanel.com',
            lastUpdated: new Date().toISOString(),
            totalEndpoints: 0,
            capabilities: 0
        };
    }
}
/**
 * Clears the schema cache to force a fresh fetch
 */
function clearSchemaCache() {
    schemaCache = null;
    console.log('🗑️ Schema cache cleared');
}
/**
 * Gets cache status
 */
function getCacheStatus() {
    if (!schemaCache) {
        return { cached: false, age: null };
    }
    const age = Date.now() - schemaCache.timestamp;
    return {
        cached: true,
        age: age,
        ageMinutes: Math.round(age / 60000),
        expiresIn: Math.max(0, CACHE_DURATION - age)
    };
}
