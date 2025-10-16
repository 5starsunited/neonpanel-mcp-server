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
const dynamic_capabilities_1 = require("./dynamic-capabilities");
const oauth_endpoints_js_1 = __importStar(require("./oauth-endpoints.js"));
const exec_route_js_1 = require("./routes/exec-route.js");
const app = (0, express_1.default)();
app.set('trust proxy', true);
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use('/', oauth_endpoints_js_1.default);
const NEONPANEL_BASE_URL = process.env.NEONPANEL_BASE_URL || 'https://my.neonpanel.com';
function attachAuthChallenge(res, req) {
    const metadataUrl = (0, oauth_endpoints_js_1.buildResourceMetadataUrl)(req);
    if (!res.getHeader('WWW-Authenticate')) {
        res.setHeader('WWW-Authenticate', `Bearer realm="mcp", resource_metadata="${metadataUrl}"`);
    }
}
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
(0, exec_route_js_1.registerExecRoute)(app, {
    neonpanelBaseUrl: NEONPANEL_BASE_URL,
    attachAuthChallenge
});
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
