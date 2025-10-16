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
    'https://my.neonpanel.com/api/v1/scheme/3.1.0',
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
    console.log('⚠️ Using fallback capabilities due to API unavailability');
    return [
        {
            capability_name: 'neonpanel.inventoryManager',
            description: 'NeonPanel inventory management capabilities',
            actions: [
                {
                    action_id: 'neonpanel.inventoryManager.getItems',
                    name: 'Get Inventory Items',
                    description: 'Retrieve inventory items from NeonPanel',
                    method: 'GET',
                    path: '/api/v1/companies/{companyUuid}/inventory-items',
                    input_schema: {
                        type: 'object',
                        properties: {
                            companyUuid: { type: 'string', description: 'Company UUID' },
                            page: { type: 'number', minimum: 1, default: 1 },
                            per_page: { type: 'number', minimum: 10, maximum: 60, default: 30 },
                            search: { type: 'string', description: 'Search term' },
                            country_code: { type: 'string', minLength: 2, maxLength: 2 },
                            fnsku: { type: 'string' },
                            asin: { type: 'string' },
                            sku: { type: 'string' }
                        },
                        required: ['companyUuid']
                    }
                },
                {
                    action_id: 'neonpanel.inventoryManager.getItemCogs',
                    name: 'Get Item COGS',
                    description: 'Get cost of goods sold for an inventory item',
                    method: 'GET',
                    path: '/api/v1/companies/{companyUuid}/inventory-items/{inventoryId}/cogs',
                    input_schema: {
                        type: 'object',
                        properties: {
                            companyUuid: { type: 'string', description: 'Company UUID' },
                            inventoryId: { type: 'integer', description: 'Inventory item ID' },
                            warehouse_uuid: { type: 'string', description: 'Warehouse UUID' },
                            start_date: { type: 'string', format: 'date', description: 'Start date' },
                            end_date: { type: 'string', format: 'date', description: 'End date' }
                        },
                        required: ['companyUuid', 'inventoryId', 'warehouse_uuid', 'start_date']
                    }
                },
                {
                    action_id: 'neonpanel.inventoryManager.getItemLandedCost',
                    name: 'Get Item Landed Cost',
                    description: 'Get landed cost for an inventory item',
                    method: 'GET',
                    path: '/api/v1/companies/{companyUuid}/inventory-items/{inventoryId}/landed-cost',
                    input_schema: {
                        type: 'object',
                        properties: {
                            companyUuid: { type: 'string', description: 'Company UUID' },
                            inventoryId: { type: 'integer', description: 'Inventory item ID' },
                            warehouse_uuid: { type: 'string', description: 'Warehouse UUID' },
                            start_date: { type: 'string', format: 'date', description: 'Start date' },
                            end_date: { type: 'string', format: 'date', description: 'End date' }
                        },
                        required: ['companyUuid', 'inventoryId', 'warehouse_uuid', 'start_date']
                    }
                }
            ]
        },
        {
            capability_name: 'neonpanel.finance',
            description: 'NeonPanel finance management capabilities',
            actions: [
                {
                    action_id: 'neonpanel.finance.revenueAndCogs',
                    name: 'Get Revenue and COGS',
                    description: 'Get revenue and cost of goods sold data',
                    method: 'GET',
                    path: '/api/v1/revenue-and-cogs',
                    input_schema: {
                        type: 'object',
                        properties: {
                            company_uuids: { type: 'array', items: { type: 'string' } },
                            country_codes: { type: 'array', items: { type: 'string' } },
                            grouping: { type: 'array', items: { type: 'string', enum: ['company', 'country', 'invoice'] } },
                            periodicity: { type: 'string', enum: ['total', 'day', 'week', 'month', 'quarter', 'year'] },
                            start_date: { type: 'string', format: 'date' },
                            end_date: { type: 'string', format: 'date' }
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
