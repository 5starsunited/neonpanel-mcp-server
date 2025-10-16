"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const axios_1 = __importDefault(require("axios"));
const zod_1 = require("zod");
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const NEONPANEL_BASE_URL = process.env.NEONPANEL_BASE_URL || 'https://my.neonpanel.com';
// Health
app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        service: 'neonpanel-mcp',
        baseUrl: NEONPANEL_BASE_URL,
        ts: new Date().toISOString()
    });
});
// MCP Protocol Endpoints
app.get('/mcp/info', (_req, res) => {
    res.json({
        name: 'neonpanel-mcp',
        version: '1.0.0',
        description: 'NeonPanel MCP Server for inventory, finance, and integrated services'
    });
});
app.get('/mcp/capabilities', (_req, res) => {
    res.json({
        tools: [
            {
                name: 'neonpanel.inventory.getItems',
                description: 'Get inventory items from NeonPanel',
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
                name: 'neonpanel.inventoryManager.getItemCogs',
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
                name: 'neonpanel.inventoryManager.getItemLandedCost',
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
                name: 'neonpanel.finance.revenueAndCogs',
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
        ]
    });
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
        const [provider] = action.split('.');
        let data;
        switch (action) {
            case 'neonpanel.inventoryManager.getItems': {
                const p = GetItemsSchema.parse(args || {});
                const { companyUuid, ...rest } = p;
                const qs = buildQuery(rest);
                data = await neonpanelGet(`/api/v1/companies/${encodeURIComponent(companyUuid)}/inventory-items${qs}`, auth);
                break;
            }
            case 'neonpanel.inventoryManager.getItemCogs': {
                const p = CommonItemPathSchema.and(DateRangeSchema).parse(args || {});
                const { companyUuid, inventoryId, ...rest } = p;
                const qs = buildQuery(rest);
                data = await neonpanelGet(`/api/v1/companies/${encodeURIComponent(companyUuid)}/inventory-items/${encodeURIComponent(String(inventoryId))}/cogs${qs}`, auth);
                break;
            }
            case 'neonpanel.inventoryManager.getItemLandedCost': {
                const p = CommonItemPathSchema.and(DateRangeSchema).parse(args || {});
                const { companyUuid, inventoryId, ...rest } = p;
                const qs = buildQuery(rest);
                data = await neonpanelGet(`/api/v1/companies/${encodeURIComponent(companyUuid)}/inventory-items/${encodeURIComponent(String(inventoryId))}/landed-cost${qs}`, auth);
                break;
            }
            case 'neonpanel.finance.revenueAndCogs': {
                const p = RevenueAndCogsSchema.parse(args || {});
                const qs = buildQuery(p);
                data = await neonpanelGet(`/api/v1/revenue-and-cogs${qs}`, auth);
                break;
            }
            default:
                return res.status(400).json({ ok: false, message: `Unknown or unsupported action '${action}'` });
        }
        res.json({ ok: true, data });
    }
    catch (e) {
        const status = e?.response?.status || 500;
        const message = e?.response?.data || e?.message || 'Internal error';
        res.status(status).json({ ok: false, message });
    }
});
const PORT = process.env.PORT || 3030;
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`NeonPanel MCP HTTP server running on :${PORT}`);
        console.log(`Health: http://localhost:${PORT}/health`);
        console.log(`Exec:   POST http://localhost:${PORT}/exec { action, args } (Authorization: Bearer <token>)`);
    });
}
exports.default = app;
