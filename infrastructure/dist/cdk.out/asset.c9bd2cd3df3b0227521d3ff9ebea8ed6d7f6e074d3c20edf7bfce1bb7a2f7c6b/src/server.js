"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const axios_1 = __importDefault(require("axios"));
const zod_1 = require("zod");
const dynamic_capabilities_1 = require("./dynamic-capabilities");
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const NEONPANEL_BASE_URL = process.env.NEONPANEL_BASE_URL || 'https://my.neonpanel.com';
// Health
app.get('/health', async (_req, res) => {
    try {
        const metadata = await (0, dynamic_capabilities_1.getApiMetadata)();
        const cacheStatus = (0, dynamic_capabilities_1.getCacheStatus)();
        res.json({
            status: 'ok',
            service: 'neonpanel-mcp',
            baseUrl: NEONPANEL_BASE_URL,
            api: metadata,
            cache: cacheStatus,
            ts: new Date().toISOString()
        });
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({
            status: 'error',
            service: 'neonpanel-mcp',
            baseUrl: NEONPANEL_BASE_URL,
            error: errorMessage,
            ts: new Date().toISOString()
        });
    }
});
// MCP Protocol Endpoints
app.get('/mcp/info', async (_req, res) => {
    try {
        const metadata = await (0, dynamic_capabilities_1.getApiMetadata)();
        res.json({
            name: 'neonpanel-mcp',
            version: '1.0.0',
            description: 'NeonPanel MCP Server for inventory, finance, and integrated services',
            capabilities: {
                tools: true,
                resources: false,
                prompts: false
            },
            server: {
                protocol: 'http',
                endpoints: {
                    health: '/health',
                    info: '/mcp/info',
                    capabilities: '/mcp/capabilities',
                    exec: '/exec',
                    refresh: '/mcp/refresh'
                }
            },
            api: metadata,
            timestamp: new Date().toISOString()
        });
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({
            error: 'MCP_INFO_ERROR',
            message: errorMessage,
            timestamp: new Date().toISOString()
        });
    }
});
app.get('/mcp/capabilities', async (_req, res) => {
    try {
        console.log('📡 MCP Capabilities endpoint called - fetching fresh data');
        const capabilities = await (0, dynamic_capabilities_1.getFreshCapabilities)();
        res.json({
            capabilities: capabilities,
            metadata: {
                source: 'https://my.neonpanel.com/api/v1/scheme',
                generated: new Date().toISOString(),
                total_capabilities: capabilities.length,
                total_actions: capabilities.reduce((sum, cap) => sum + cap.actions.length, 0)
            }
        });
    }
    catch (error) {
        console.error('❌ Error fetching capabilities:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({
            error: 'MCP_CAPABILITIES_ERROR',
            message: errorMessage,
            timestamp: new Date().toISOString()
        });
    }
});
// MCP Refresh endpoint - force refresh of capabilities
app.post('/mcp/refresh', async (_req, res) => {
    try {
        console.log('🔄 MCP Refresh endpoint called - clearing cache and fetching fresh data');
        (0, dynamic_capabilities_1.clearSchemaCache)();
        const capabilities = await (0, dynamic_capabilities_1.getFreshCapabilities)();
        const metadata = await (0, dynamic_capabilities_1.getApiMetadata)();
        res.json({
            success: true,
            message: 'Capabilities refreshed successfully',
            capabilities: capabilities,
            metadata: metadata,
            timestamp: new Date().toISOString()
        });
    }
    catch (error) {
        console.error('❌ Error refreshing capabilities:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({
            success: false,
            error: 'MCP_REFRESH_ERROR',
            message: errorMessage,
            timestamp: new Date().toISOString()
        });
    }
});
// MCP OAuth configuration endpoint
app.get('/mcp/oauth/config', (_req, res) => {
    res.json({
        authorization_url: `${NEONPANEL_BASE_URL}/oauth/authorize`,
        token_url: `${NEONPANEL_BASE_URL}/oauth/token`,
        scopes: ['read:inventory', 'read:analytics', 'read:companies', 'read:reports', 'read:warehouses', 'read:revenue', 'read:cogs', 'read:landed-cost', 'write:import'],
        client_id: 'mcp-client'
    });
});
// Input for /exec
const ExecSchema = zod_1.z.object({
    action: zod_1.z.string().min(1),
    args: zod_1.z.record(zod_1.z.any()).default({})
});
// NeonPanel schemas (subsets aligned to docs/capabilities/neonpanel.yaml)
const CompanyUuid = zod_1.z.string().min(1);
const GetItemsSchema = zod_1.z.object({
    companyUuid: CompanyUuid,
    page: zod_1.z.number().int().min(1).optional(),
    per_page: zod_1.z.number().int().min(10).max(60).optional(),
    country_code: zod_1.z.string().length(2).optional(),
    search: zod_1.z.string().optional(),
    fnsku: zod_1.z.string().optional(),
    asin: zod_1.z.string().optional(),
    sku: zod_1.z.string().optional(),
});
const CommonItemPathSchema = zod_1.z.object({
    companyUuid: CompanyUuid,
    inventoryId: zod_1.z.number().int().nonnegative(),
});
const DateRangeSchema = zod_1.z.object({
    warehouse_uuid: zod_1.z.string().min(1),
    start_date: zod_1.z.string().min(1),
    end_date: zod_1.z.string().optional(),
});
const RevenueAndCogsSchema = zod_1.z.object({
    company_uuids: zod_1.z.array(zod_1.z.string()).optional(),
    country_codes: zod_1.z.array(zod_1.z.string()).optional(),
    grouping: zod_1.z.array(zod_1.z.enum(['company', 'country', 'invoice'])).optional(),
    periodicity: zod_1.z.enum(['total', 'day', 'week', 'month', 'quarter', 'year']).optional(),
    start_date: zod_1.z.string().optional(),
    end_date: zod_1.z.string().optional(),
});
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
async function neonpanelGet(path, token) {
    const url = `${NEONPANEL_BASE_URL}${path}`;
    const res = await axios_1.default.get(url, { headers: { Authorization: token, 'Accept': 'application/json' } });
    return res.data;
}
app.post('/exec', async (req, res) => {
    try {
        const auth = req.headers['authorization'];
        if (!auth || !auth.toString().toLowerCase().startsWith('bearer ')) {
            return res.status(401).json({ ok: false, message: 'Missing Authorization bearer token' });
        }
        const { action, args } = ExecSchema.parse(req.body || {});
        console.log(`🔧 Executing action: ${action}`, { args });
        // Get fresh capabilities to find the action
        const capabilities = await (0, dynamic_capabilities_1.getFreshCapabilities)();
        const actionInfo = findActionInCapabilities(capabilities, action);
        if (!actionInfo) {
            return res.status(400).json({
                ok: false,
                message: `Unknown or unsupported action '${action}'`,
                available_actions: getAvailableActions(capabilities)
            });
        }
        // Build the API URL and execute the request
        const apiUrl = buildApiUrl(actionInfo, args);
        console.log(`🌐 Calling NeonPanel API: ${apiUrl}`);
        const data = await neonpanelGet(apiUrl, auth);
        res.json({
            ok: true,
            data,
            action: actionInfo.action_id,
            method: actionInfo.method,
            path: actionInfo.path
        });
    }
    catch (e) {
        console.error('❌ Execution error:', e);
        const status = e?.response?.status || 500;
        const message = e?.response?.data || e?.message || 'Internal error';
        res.status(status).json({ ok: false, message, action: req.body?.action });
    }
});
// Helper function to find action in capabilities
function findActionInCapabilities(capabilities, actionId) {
    for (const capability of capabilities) {
        const action = capability.actions.find((a) => a.action_id === actionId);
        if (action) {
            return action;
        }
    }
    return null;
}
// Helper function to get available actions
function getAvailableActions(capabilities) {
    const actions = [];
    for (const capability of capabilities) {
        for (const action of capability.actions) {
            actions.push(action.action_id);
        }
    }
    return actions;
}
// Helper function to build API URL from action info and args
function buildApiUrl(actionInfo, args) {
    let path = actionInfo.path;
    // Replace path parameters
    for (const param of actionInfo.parameters || []) {
        if (param.in === 'path' && args[param.name] !== undefined) {
            path = path.replace(`{${param.name}}`, encodeURIComponent(String(args[param.name])));
        }
    }
    // Add query parameters
    const queryParams = new URLSearchParams();
    for (const param of actionInfo.parameters || []) {
        if (param.in === 'query' && args[param.name] !== undefined) {
            const value = args[param.name];
            if (Array.isArray(value)) {
                value.forEach(v => queryParams.append(`${param.name}[]`, String(v)));
            }
            else {
                queryParams.append(param.name, String(value));
            }
        }
    }
    const queryString = queryParams.toString();
    return queryString ? `${path}?${queryString}` : path;
}
const PORT = process.env.PORT || 3030;
if (require.main === module) {
    app.listen(PORT, async () => {
        console.log(`🚀 NeonPanel MCP HTTP server running on :${PORT}`);
        console.log(`📊 Health: http://localhost:${PORT}/health`);
        console.log(`ℹ️  Info: http://localhost:${PORT}/mcp/info`);
        console.log(`🔧 Capabilities: http://localhost:${PORT}/mcp/capabilities`);
        console.log(`🔄 Refresh: POST http://localhost:${PORT}/mcp/refresh`);
        console.log(`⚡ Exec: POST http://localhost:${PORT}/exec { action, args } (Authorization: Bearer <token>)`);
        // Pre-load capabilities on startup
        try {
            console.log('🔄 Pre-loading capabilities from NeonPanel API...');
            const capabilities = await (0, dynamic_capabilities_1.getFreshCapabilities)();
            console.log(`✅ Loaded ${capabilities.length} capabilities with ${capabilities.reduce((sum, cap) => sum + cap.actions.length, 0)} total actions`);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.warn('⚠️ Failed to pre-load capabilities:', errorMessage);
        }
    });
}
exports.default = app;
