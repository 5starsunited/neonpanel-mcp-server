"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const axios_1 = __importDefault(require("axios"));
const NEONPANEL_BASE_URL = process.env.NEONPANEL_BASE_URL || 'https://my.neonpanel.com';
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
const server = new index_js_1.Server({
    name: 'neonpanel-mcp',
    version: '1.0.0',
}, {
    capabilities: {
        tools: {},
    },
});
// List tools handler
server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => {
    return { tools };
});
// Call tool handler
server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    // Extract token from request context (this would need to be passed somehow)
    // For now, we'll assume it's in the args or we need to implement proper auth
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
// Start server
async function main() {
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    console.error('NeonPanel MCP server running on stdio');
}
main().catch(console.error);
