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
app.use(express_1.default.urlencoded({ extended: true })); // Required for OAuth form data
app.use('/', oauth_endpoints_js_1.default);
const NEONPANEL_BASE_URL = process.env.NEONPANEL_BASE_URL || 'https://my.neonpanel.com';
function attachAuthChallenge(res, req) {
    const metadataUrl = (0, oauth_endpoints_js_1.buildResourceMetadataUrl)(req);
    if (!res.getHeader('WWW-Authenticate')) {
        res.setHeader('WWW-Authenticate', `Bearer realm="mcp", resource_metadata="${metadataUrl}"`);
    }
}
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
// Debug endpoint to test axios
app.get('/debug/axios-test', async (_req, res) => {
    try {
        const axios = require('axios');
        const testResponse = await axios.post('https://my.neonpanel.com/oauth2/token', 'grant_type=client_credentials&client_id=1145f268-a864-11f0-8a3d-122c1fe52bef&client_secret=NbhL8t71IKgf5JDHI9LeyUrbFpcC4hDGA6aLray5iih4h7NalTxJhfeUFLOOs0pk', {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            validateStatus: () => true
        });
        res.json({
            status: 'ok',
            axiosWorks: true,
            responseStatus: testResponse.status,
            responseData: testResponse.data
        });
    }
    catch (error) {
        res.status(500).json({
            status: 'error',
            axiosWorks: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
        });
    }
});
// MCP Protocol Endpoints
// Main MCP endpoint - entry point for ChatGPT connector
app.get('/mcp', (_req, res) => {
    res.json({
        protocol: 'mcp',
        version: '1.0.0',
        name: 'neonpanel-mcp',
        description: 'NeonPanel MCP Server for inventory, finance, and analytics',
        endpoints: {
            info: '/mcp/info',
            capabilities: '/mcp/capabilities',
            tools: '/mcp/tools/call',
            auth: {
                oauth: '/mcp/oauth/config',
                wellKnown: '/.well-known/oauth-authorization-server'
            }
        },
        capabilities: {
            tools: true,
            resources: true,
            prompts: false
        }
    });
});
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
// MCP Tool Call endpoint - execute tools
app.post('/mcp/tools/call', async (req, res) => {
    try {
        const { tool, arguments: toolArgs } = req.body;
        if (!tool) {
            return res.status(400).json({
                error: 'MISSING_TOOL',
                message: 'Tool name is required'
            });
        }
        console.log(`🔧 Tool call: ${tool}`, toolArgs);
        // For now, return a placeholder
        // TODO: Implement actual tool execution with NeonPanel API
        res.json({
            tool,
            result: {
                success: true,
                message: 'Tool execution not yet implemented',
                data: {}
            },
            timestamp: new Date().toISOString()
        });
    }
    catch (error) {
        console.error('❌ Error executing tool:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({
            error: 'TOOL_EXECUTION_ERROR',
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
