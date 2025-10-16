"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const sse_js_1 = require("@modelcontextprotocol/sdk/server/sse.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const axios_1 = __importDefault(require("axios"));
const oauth_endpoints_js_1 = __importStar(require("./oauth-endpoints.js"));
const exec_route_js_1 = require("./routes/exec-route.js");
const app = (0, express_1.default)();
app.set('trust proxy', true);
// CORS with Authorization header support (required for GPT Connect)
app.use((0, cors_1.default)({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Cache-Control', 'Accept'],
    exposedHeaders: ['WWW-Authenticate']
}));
app.use(express_1.default.json());
app.use('/', oauth_endpoints_js_1.default);
const NEONPANEL_BASE_URL = process.env.NEONPANEL_BASE_URL || 'https://my.neonpanel.com';
function attachAuthChallenge(res, req) {
    const metadataUrl = (0, oauth_endpoints_js_1.buildResourceMetadataUrl)(req);
    if (!res.getHeader('WWW-Authenticate')) {
        res.setHeader('WWW-Authenticate', `Bearer realm="mcp", resource_metadata="${metadataUrl}"`);
    }
}
/**
 * Extract Bearer token from Authorization header
 * Returns token string or null if invalid/missing
 *
 * Accepts: "Authorization: Bearer <token>"
 * Case-insensitive "Bearer" keyword with single space
 */
function extractBearerToken(req) {
    const auth = req.get('authorization') || req.get('Authorization');
    if (!auth)
        return null;
    // Match "Bearer <token>" (case-insensitive Bearer, single space)
    const match = auth.match(/^Bearer\s+(.+)$/i);
    return match ? match[1] : null;
}
/**
 * Middleware to require Bearer token authentication
 * Returns 401 with proper WWW-Authenticate header if missing/invalid
 */
function requireBearer(req, res, next) {
    const token = extractBearerToken(req);
    if (!token) {
        attachAuthChallenge(res, req);
        return res.status(401).json({
            error: "invalid_token",
            error_description: "Unsupported authorization header. Use 'Authorization: Bearer <token>'."
        });
    }
    // Store token in request for downstream handlers
    req.bearerToken = token;
    return next();
}
// NeonPanel API helper
async function neonpanelGet(path, token) {
    const url = `${NEONPANEL_BASE_URL}${path}`;
    const res = await axios_1.default.get(url, {
        headers: {
            Authorization: token,
            'Accept': 'application/json'
        }
    });
    return res.data;
}
function buildQuery(obj) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(obj)) {
        if (v === undefined || v === null)
            continue;
        if (Array.isArray(v)) {
            for (const item of v)
                params.append(`${k}[]`, String(item));
        }
        else {
            params.append(k, String(v));
        }
    }
    const qs = params.toString();
    return qs ? `?${qs}` : '';
}
(0, exec_route_js_1.registerExecRoute)(app, {
    neonpanelBaseUrl: NEONPANEL_BASE_URL,
    attachAuthChallenge
});
// Define tools for MCP
const tools = [
    {
        name: 'search',
        description: 'Search for inventory items, financial data, or other NeonPanel data',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Search query for finding relevant data'
                },
                type: {
                    type: 'string',
                    enum: ['inventory', 'finance', 'all'],
                    description: 'Type of data to search',
                    default: 'all'
                },
                companyUuid: {
                    type: 'string',
                    description: 'Company UUID for scoped searches'
                }
            },
            required: ['query']
        }
    },
    {
        name: 'fetch',
        description: 'Fetch complete details for a specific inventory item or financial record',
        inputSchema: {
            type: 'object',
            properties: {
                id: {
                    type: 'string',
                    description: 'ID of the item to fetch'
                },
                type: {
                    type: 'string',
                    enum: ['inventory', 'finance'],
                    description: 'Type of data to fetch'
                },
                companyUuid: {
                    type: 'string',
                    description: 'Company UUID for the item'
                }
            },
            required: ['id', 'type', 'companyUuid']
        }
    },
    {
        name: 'get_inventory_items',
        description: 'Get inventory items from NeonPanel with filtering options',
        inputSchema: {
            type: 'object',
            properties: {
                companyUuid: { type: 'string' },
                page: { type: 'number' },
                per_page: { type: 'number' },
                country_code: { type: 'string' },
                search: { type: 'string' },
                fnsku: { type: 'string' },
                asin: { type: 'string' },
                sku: { type: 'string' }
            },
            required: ['companyUuid']
        }
    },
    {
        name: 'get_item_cogs',
        description: 'Get COGS data for a specific inventory item',
        inputSchema: {
            type: 'object',
            properties: {
                companyUuid: { type: 'string' },
                inventoryId: { type: 'number' },
                warehouse_uuid: { type: 'string' },
                start_date: { type: 'string' },
                end_date: { type: 'string' }
            },
            required: ['companyUuid', 'inventoryId', 'warehouse_uuid', 'start_date']
        }
    },
    {
        name: 'get_item_landed_cost',
        description: 'Get landed cost data for a specific inventory item',
        inputSchema: {
            type: 'object',
            properties: {
                companyUuid: { type: 'string' },
                inventoryId: { type: 'number' },
                warehouse_uuid: { type: 'string' },
                start_date: { type: 'string' },
                end_date: { type: 'string' }
            },
            required: ['companyUuid', 'inventoryId', 'warehouse_uuid', 'start_date']
        }
    },
    {
        name: 'get_revenue_and_cogs',
        description: 'Get revenue and COGS analytics from NeonPanel',
        inputSchema: {
            type: 'object',
            properties: {
                company_uuids: { type: 'array' },
                country_codes: { type: 'array' },
                grouping: { type: 'array' },
                periodicity: { type: 'string' },
                start_date: { type: 'string' },
                end_date: { type: 'string' }
            }
        }
    }
];
// Create MCP server
const mcpServer = new index_js_1.Server({
    name: 'neonpanel-mcp',
    version: '1.0.0',
}, {
    capabilities: {
        tools: {},
    },
});
// Server info handler - MCP servers automatically provide this info
// List tools handler
mcpServer.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => {
    return { tools };
});
// Call tool handler
mcpServer.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    // Extract token from request context
    const token = args?.token;
    if (!token) {
        throw new Error('Authorization token required');
    }
    try {
        let result;
        switch (name) {
            case 'search': {
                const { query, type = 'all', companyUuid } = args;
                if (!companyUuid) {
                    throw new Error('companyUuid is required for search');
                }
                const results = [];
                // Search inventory if requested
                if (type === 'inventory' || type === 'all') {
                    const inventoryQuery = buildQuery({
                        search: query,
                        companyUuid,
                        per_page: 10
                    });
                    const inventoryData = await neonpanelGet(`/api/v1/companies/${encodeURIComponent(companyUuid)}/inventory-items${inventoryQuery}`, token);
                    if (inventoryData?.data) {
                        for (const item of inventoryData.data) {
                            results.push({
                                id: `inventory-${item.id}`,
                                title: item.name || item.sku || `Item ${item.id}`,
                                text: `SKU: ${item.sku || 'N/A'}, ASIN: ${item.asin || 'N/A'}, FnSKU: ${item.fnsku || 'N/A'}`,
                                url: `${NEONPANEL_BASE_URL}/inventory/${item.id}`,
                                metadata: {
                                    type: 'inventory',
                                    companyUuid,
                                    sku: item.sku,
                                    asin: item.asin,
                                    fnsku: item.fnsku
                                }
                            });
                        }
                    }
                }
                // Search finance if requested
                if (type === 'finance' || type === 'all') {
                    const financeData = await neonpanelGet(`/api/v1/revenue-and-cogs?company_uuids[]=${encodeURIComponent(companyUuid)}`, token);
                    if (financeData?.data) {
                        results.push({
                            id: `finance-${companyUuid}`,
                            title: `Revenue & COGS for Company ${companyUuid}`,
                            text: `Revenue: ${financeData.data.total_revenue || 'N/A'}, COGS: ${financeData.data.total_cogs || 'N/A'}`,
                            url: `${NEONPANEL_BASE_URL}/finance/revenue-cogs`,
                            metadata: {
                                type: 'finance',
                                companyUuid
                            }
                        });
                    }
                }
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({ results })
                        }
                    ]
                };
            }
            case 'fetch': {
                const { id, type, companyUuid } = args;
                if (type === 'inventory') {
                    const inventoryId = id.replace('inventory-', '');
                    const itemData = await neonpanelGet(`/api/v1/companies/${encodeURIComponent(companyUuid)}/inventory-items/${inventoryId}`, token);
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                    id,
                                    title: itemData.name || itemData.sku || `Item ${inventoryId}`,
                                    text: JSON.stringify(itemData, null, 2),
                                    url: `${NEONPANEL_BASE_URL}/inventory/${inventoryId}`,
                                    metadata: {
                                        type: 'inventory',
                                        companyUuid,
                                        ...itemData
                                    }
                                })
                            }
                        ]
                    };
                }
                if (type === 'finance') {
                    const financeData = await neonpanelGet(`/api/v1/revenue-and-cogs?company_uuids[]=${encodeURIComponent(companyUuid)}`, token);
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                    id,
                                    title: `Revenue & COGS for Company ${companyUuid}`,
                                    text: JSON.stringify(financeData, null, 2),
                                    url: `${NEONPANEL_BASE_URL}/finance/revenue-cogs`,
                                    metadata: {
                                        type: 'finance',
                                        companyUuid,
                                        ...financeData
                                    }
                                })
                            }
                        ]
                    };
                }
                throw new Error(`Unknown fetch type: ${type}`);
            }
            case 'get_inventory_items': {
                const { companyUuid, ...rest } = args;
                const qs = buildQuery(rest);
                result = await neonpanelGet(`/api/v1/companies/${encodeURIComponent(companyUuid)}/inventory-items${qs}`, token);
                break;
            }
            case 'get_item_cogs': {
                const { companyUuid, inventoryId, ...rest } = args;
                const qs = buildQuery(rest);
                result = await neonpanelGet(`/api/v1/companies/${encodeURIComponent(companyUuid)}/inventory-items/${encodeURIComponent(String(inventoryId))}/cogs${qs}`, token);
                break;
            }
            case 'get_item_landed_cost': {
                const { companyUuid, inventoryId, ...rest } = args;
                const qs = buildQuery(rest);
                result = await neonpanelGet(`/api/v1/companies/${encodeURIComponent(companyUuid)}/inventory-items/${encodeURIComponent(String(inventoryId))}/landed-cost${qs}`, token);
                break;
            }
            case 'get_revenue_and_cogs': {
                const qs = buildQuery(args);
                result = await neonpanelGet(`/api/v1/revenue-and-cogs${qs}`, token);
                break;
            }
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result)
                }
            ]
        };
    }
    catch (error) {
        throw new Error(`Tool execution failed: ${error.message}`);
    }
});
// OpenAPI Spec (JSON format)
app.get('/openapi.json', (_req, res) => {
    const fs = require('fs');
    const path = require('path');
    const openapiPath = path.join(__dirname, '..', 'openapi.json');
    try {
        const openapi = JSON.parse(fs.readFileSync(openapiPath, 'utf8'));
        res.json(openapi);
    }
    catch (error) {
        res.status(500).json({ error: 'OpenAPI spec not found' });
    }
});
// OpenAPI Spec (YAML format)
app.get('/openapi.yaml', (_req, res) => {
    const fs = require('fs');
    const path = require('path');
    const openapiPath = path.join(__dirname, '..', 'openapi.json');
    try {
        const openapi = JSON.parse(fs.readFileSync(openapiPath, 'utf8'));
        // Simple JSON to YAML converter
        function jsonToYaml(obj, indent = 0) {
            const spaces = '  '.repeat(indent);
            let yaml = '';
            for (const [key, value] of Object.entries(obj)) {
                if (value === null || value === undefined) {
                    yaml += `${spaces}${key}: null\n`;
                }
                else if (Array.isArray(value)) {
                    yaml += `${spaces}${key}:\n`;
                    for (const item of value) {
                        if (typeof item === 'object') {
                            yaml += `${spaces}- \n${jsonToYaml(item, indent + 1)}`;
                        }
                        else {
                            yaml += `${spaces}- ${JSON.stringify(item)}\n`;
                        }
                    }
                }
                else if (typeof value === 'object') {
                    yaml += `${spaces}${key}:\n${jsonToYaml(value, indent + 1)}`;
                }
                else if (typeof value === 'string') {
                    yaml += `${spaces}${key}: ${JSON.stringify(value)}\n`;
                }
                else {
                    yaml += `${spaces}${key}: ${value}\n`;
                }
            }
            return yaml;
        }
        res.type('text/yaml');
        res.send(jsonToYaml(openapi));
    }
    catch (error) {
        res.status(500).json({ error: 'OpenAPI spec not found' });
    }
});
// ChatGPT AI Plugin Manifest
app.get('/.well-known/ai-plugin.json', (req, res) => {
    const baseUrl = req.protocol + '://' + req.get('host');
    res.json({
        schema_version: 'v1',
        name_for_human: 'NeonPanel',
        name_for_model: 'neonpanel',
        description_for_human: 'Access NeonPanel inventory, finance, and analytics data',
        description_for_model: 'Plugin for accessing NeonPanel API - inventory items, warehouses, financial data, revenue analytics, COGS, and landed cost calculations. Supports searching, fetching details, and analyzing data across companies.',
        auth: {
            type: 'oauth',
            client_url: `https://my.neonpanel.com/oauth2/authorize`,
            scope: 'read:inventory read:analytics read:companies read:reports read:warehouses read:revenue read:cogs read:landed-cost',
            authorization_url: `https://my.neonpanel.com/oauth2/token`,
            authorization_content_type: 'application/x-www-form-urlencoded',
            verification_tokens: {
                openai: process.env.CHATGPT_VERIFICATION_TOKEN || 'not-configured'
            }
        },
        api: {
            type: 'openapi',
            url: `${baseUrl}/openapi.yaml`,
            is_user_authenticated: false
        },
        logo_url: 'https://my.neonpanel.com/images/logo.png',
        contact_email: 'support@neonpanel.com',
        legal_info_url: 'https://neonpanel.com/legal'
    });
});
// HTTP endpoints for testing and compatibility
app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        service: 'neonpanel-mcp-hybrid',
        baseUrl: NEONPANEL_BASE_URL,
        ts: new Date().toISOString()
    });
});
// MCP Protocol endpoints
// MCP SSE endpoint (alias for /sse/ - some clients expect /mcp path)
app.get('/mcp', requireBearer, async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Cache-Control, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    try {
        // Extract authenticated token from middleware
        const token = req.bearerToken;
        // Create transport with token in context
        const transport = new sse_js_1.SSEServerTransport('/mcp', res);
        // Store token in a way that MCP handlers can access it
        transport._neonpanelToken = `Bearer ${token}`;
        await mcpServer.connect(transport);
        // Send initial connection event
        res.write(`event: endpoint\ndata: /mcp?sessionId=${Date.now()}\n\n`);
        // Keep connection alive
        const keepAlive = setInterval(() => {
            if (res.writableEnded) {
                clearInterval(keepAlive);
                return;
            }
            res.write(`event: ping\ndata: ${Date.now()}\n\n`);
        }, 30000);
        req.on('close', () => {
            clearInterval(keepAlive);
        });
    }
    catch (error) {
        console.error('MCP connection error:', error);
        res.status(500).end();
    }
});
app.get('/mcp/info', (_req, res) => {
    res.json({
        name: 'neonpanel-mcp-hybrid',
        version: '1.0.0',
        description: 'NeonPanel MCP Server for inventory, finance, and integrated services',
        protocolVersion: '2024-11-05',
        capabilities: {
            tools: true,
            resources: false,
            prompts: false
        }
    });
});
app.get('/mcp/capabilities', (_req, res) => {
    res.json({ tools });
});
// HTTP wrapper for MCP tools (for testing)
app.post('/mcp/tools/call', requireBearer, async (req, res) => {
    try {
        const { name, arguments: args } = req.body;
        if (!name) {
            return res.status(400).json({ error: 'Tool name is required' });
        }
        // Extract authenticated token from middleware
        const token = req.bearerToken;
        // Add token to args (as Bearer <token> for NeonPanel API)
        const toolArgs = { ...args, token: `Bearer ${token}` };
        // Create a mock MCP request
        const mcpRequest = {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
                name,
                arguments: toolArgs
            }
        };
        // Simulate MCP tool execution
        let result;
        switch (name) {
            case 'search': {
                const { query, type = 'all', companyUuid } = toolArgs;
                if (!companyUuid) {
                    return res.status(400).json({ error: 'companyUuid is required for search' });
                }
                const results = [];
                // Search inventory if requested
                if (type === 'inventory' || type === 'all') {
                    const inventoryQuery = buildQuery({
                        search: query,
                        companyUuid,
                        per_page: 10
                    });
                    const inventoryData = await neonpanelGet(`/api/v1/companies/${encodeURIComponent(companyUuid)}/inventory-items${inventoryQuery}`, toolArgs.token);
                    if (inventoryData?.data) {
                        for (const item of inventoryData.data) {
                            results.push({
                                id: `inventory-${item.id}`,
                                title: item.name || item.sku || `Item ${item.id}`,
                                text: `SKU: ${item.sku || 'N/A'}, ASIN: ${item.asin || 'N/A'}, FnSKU: ${item.fnsku || 'N/A'}`,
                                url: `${NEONPANEL_BASE_URL}/inventory/${item.id}`,
                                metadata: {
                                    type: 'inventory',
                                    companyUuid,
                                    sku: item.sku,
                                    asin: item.asin,
                                    fnsku: item.fnsku
                                }
                            });
                        }
                    }
                }
                // Search finance if requested
                if (type === 'finance' || type === 'all') {
                    const financeData = await neonpanelGet(`/api/v1/revenue-and-cogs?company_uuids[]=${encodeURIComponent(companyUuid)}`, toolArgs.token);
                    if (financeData?.data) {
                        results.push({
                            id: `finance-${companyUuid}`,
                            title: `Revenue & COGS for Company ${companyUuid}`,
                            text: `Revenue: ${financeData.data.total_revenue || 'N/A'}, COGS: ${financeData.data.total_cogs || 'N/A'}`,
                            url: `${NEONPANEL_BASE_URL}/finance/revenue-cogs`,
                            metadata: {
                                type: 'finance',
                                companyUuid
                            }
                        });
                    }
                }
                result = {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({ results })
                        }
                    ]
                };
                break;
            }
            case 'fetch': {
                const { id, type, companyUuid } = toolArgs;
                if (type === 'inventory') {
                    const inventoryId = id.replace('inventory-', '');
                    const itemData = await neonpanelGet(`/api/v1/companies/${encodeURIComponent(companyUuid)}/inventory-items/${inventoryId}`, toolArgs.token);
                    result = {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                    id,
                                    title: itemData.name || itemData.sku || `Item ${inventoryId}`,
                                    text: JSON.stringify(itemData, null, 2),
                                    url: `${NEONPANEL_BASE_URL}/inventory/${inventoryId}`,
                                    metadata: {
                                        type: 'inventory',
                                        companyUuid,
                                        ...itemData
                                    }
                                })
                            }
                        ]
                    };
                }
                else if (type === 'finance') {
                    const financeData = await neonpanelGet(`/api/v1/revenue-and-cogs?company_uuids[]=${encodeURIComponent(companyUuid)}`, toolArgs.token);
                    result = {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                    id,
                                    title: `Revenue & COGS for Company ${companyUuid}`,
                                    text: JSON.stringify(financeData, null, 2),
                                    url: `${NEONPANEL_BASE_URL}/finance/revenue-cogs`,
                                    metadata: {
                                        type: 'finance',
                                        companyUuid,
                                        ...financeData
                                    }
                                })
                            }
                        ]
                    };
                }
                else {
                    return res.status(400).json({ error: `Unknown fetch type: ${type}` });
                }
                break;
            }
            case 'get_inventory_items': {
                const { companyUuid, ...rest } = toolArgs;
                const qs = buildQuery(rest);
                result = await neonpanelGet(`/api/v1/companies/${encodeURIComponent(companyUuid)}/inventory-items${qs}`, toolArgs.token);
                break;
            }
            case 'get_item_cogs': {
                const { companyUuid, inventoryId, ...rest } = toolArgs;
                const qs = buildQuery(rest);
                result = await neonpanelGet(`/api/v1/companies/${encodeURIComponent(companyUuid)}/inventory-items/${encodeURIComponent(String(inventoryId))}/cogs${qs}`, toolArgs.token);
                break;
            }
            case 'get_item_landed_cost': {
                const { companyUuid, inventoryId, ...rest } = toolArgs;
                const qs = buildQuery(rest);
                result = await neonpanelGet(`/api/v1/companies/${encodeURIComponent(companyUuid)}/inventory-items/${encodeURIComponent(String(inventoryId))}/landed-cost${qs}`, toolArgs.token);
                break;
            }
            case 'get_revenue_and_cogs': {
                const qs = buildQuery(toolArgs);
                result = await neonpanelGet(`/api/v1/revenue-and-cogs${qs}`, toolArgs.token);
                break;
            }
            default:
                return res.status(400).json({ error: `Unknown tool: ${name}` });
        }
        // Return MCP format response
        if (result?.content) {
            res.json(result);
        }
        else {
            res.json({
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(result)
                    }
                ]
            });
        }
    }
    catch (error) {
        const status = error?.response?.status || error?.status || 500;
        const message = error?.response?.data || error?.message || 'Internal server error';
        if (status === 401) {
            attachAuthChallenge(res, req);
        }
        const payload = typeof message === 'string' ? { error: message } : message;
        res.status(status).json(payload);
    }
});
// SSE endpoint for MCP protocol (with Bearer auth required)
app.get('/sse/', requireBearer, async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Cache-Control, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    try {
        // Extract authenticated token from middleware
        const token = req.bearerToken;
        // Create transport with token in context
        const transport = new sse_js_1.SSEServerTransport('/sse/', res);
        // Store token in a way that MCP handlers can access it
        // We'll inject it into tool arguments when tools are called
        transport._neonpanelToken = `Bearer ${token}`;
        await mcpServer.connect(transport);
        // Send initial connection event
        res.write(`event: endpoint\ndata: /sse/?sessionId=${Date.now()}\n\n`);
        // Keep connection alive
        const keepAlive = setInterval(() => {
            if (res.writableEnded) {
                clearInterval(keepAlive);
                return;
            }
            res.write(`event: ping\ndata: ${Date.now()}\n\n`);
        }, 30000);
        req.on('close', () => {
            clearInterval(keepAlive);
        });
    }
    catch (error) {
        console.error('SSE connection error:', error);
        res.status(500).end();
    }
});
const PORT = process.env.PORT || 3030;
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`NeonPanel MCP Hybrid server running on :${PORT}`);
        console.log(`Health: http://localhost:${PORT}/health`);
        console.log(`MCP SSE: http://localhost:${PORT}/sse/`);
        console.log(`MCP Tools: http://localhost:${PORT}/mcp/capabilities`);
    });
}
exports.default = app;
