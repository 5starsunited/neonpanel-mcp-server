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
const oauth_endpoints_js_1 = __importStar(require("./oauth-endpoints.js"));
const exec_route_js_1 = require("./routes/exec-route.js");
const token_validator_js_1 = require("./auth/token-validator.js");
const zod_1 = require("zod");
const neonpanel_api_js_1 = require("./clients/neonpanel-api.js");
const app = (0, express_1.default)();
app.set('trust proxy', true);
app.use((0, cors_1.default)({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Cache-Control', 'Accept'],
    exposedHeaders: ['WWW-Authenticate']
}));
app.use(express_1.default.json());
app.use('/', oauth_endpoints_js_1.default);
const NEONPANEL_BASE_URL = process.env.NEONPANEL_BASE_URL || 'https://my.neonpanel.com';
const SSE_HEARTBEAT_MS = Number.parseInt(process.env.SSE_HEARTBEAT_MS || '15000', 10);
const SERVER_INFO = {
    name: 'neonpanel-mcp',
    version: '1.0.0'
};
const SERVER_PROTOCOL_VERSION = process.env.MCP_PROTOCOL_VERSION || '2025-01-01';
const activeSessions = new Map();
function attachAuthChallenge(res, req, options = {}) {
    const metadataUrl = (0, oauth_endpoints_js_1.buildResourceMetadataUrl)(req);
    const parts = [`realm="mcp"`, `resource_metadata="${metadataUrl}"`];
    if (options.error) {
        parts.push(`error="${options.error}"`);
    }
    if (options.description) {
        parts.push(`error_description="${options.description}"`);
    }
    if (options.scope) {
        parts.push(`scope="${options.scope}"`);
    }
    res.setHeader('WWW-Authenticate', `Bearer ${parts.join(', ')}`);
}
/**
 * Extract Bearer token from Authorization header.
 */
function extractBearerToken(req) {
    const auth = req.get('authorization') || req.get('Authorization');
    if (!auth)
        return null;
    const match = auth.match(/^Bearer\s+(.+)$/i);
    return match ? match[1] : null;
}
/**
 * Require and validate a NeonPanel OAuth access token.
 */
async function requireBearer(req, res, next) {
    const token = extractBearerToken(req);
    if (!token) {
        attachAuthChallenge(res, req, { error: 'invalid_token', description: 'Missing Bearer access token.' });
        return res.status(401).json({
            error: 'invalid_token',
            error_description: "Unsupported authorization header. Use 'Authorization: Bearer <token>'."
        });
    }
    try {
        const validation = await (0, token_validator_js_1.validateAccessToken)(token);
        const authReq = req;
        authReq.bearerToken = token;
        authReq.validatedToken = validation;
        return next();
    }
    catch (error) {
        const description = (0, token_validator_js_1.isTokenValidationError)(error)
            ? error.message
            : 'Failed to validate access token.';
        attachAuthChallenge(res, req, { error: 'invalid_token', description });
        return res.status(401).json({
            error: 'invalid_token',
            error_description: description
        });
    }
}
const tools = [
    {
        name: 'neonpanel.getAccount',
        description: 'Retrieve core account details from NeonPanel, including profile and status metadata.',
        inputSchema: {
            type: 'object',
            properties: {
                accountId: {
                    type: 'string',
                    description: 'NeonPanel account identifier (UUID or numeric ID depending on workspace).'
                },
                useUserToken: {
                    type: 'boolean',
                    description: 'Set true to call NeonPanel using the inbound user access token instead of the server IAT.'
                }
            },
            required: ['accountId']
        }
    },
    {
        name: 'neonpanel.searchOrders',
        description: 'Search NeonPanel orders with optional filters for time range, status, and free-text query.',
        inputSchema: {
            type: 'object',
            properties: {
                q: {
                    type: 'string',
                    description: 'Free-text search applied to order attributes (SKU, marketplace, buyer, etc.).'
                },
                from: {
                    type: 'string',
                    description: 'ISO 8601 timestamp marking the inclusive start date for the search window.'
                },
                to: {
                    type: 'string',
                    description: 'ISO 8601 timestamp marking the inclusive end date for the search window.'
                },
                status: {
                    type: 'string',
                    description: 'Optional order status filter (e.g., SHIPPED, OPEN, CANCELLED).'
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of orders to return. Defaults to provider standard.',
                    minimum: 1,
                    maximum: 200
                },
                useUserToken: {
                    type: 'boolean',
                    description: 'Set true to call NeonPanel using the inbound user access token instead of the server IAT.'
                }
            }
        }
    }
];
const getAccountArgsSchema = zod_1.z.object({
    accountId: zod_1.z.string().min(1),
    useUserToken: zod_1.z.boolean().optional(),
});
const searchOrdersArgsSchema = zod_1.z.object({
    q: zod_1.z.string().optional(),
    from: zod_1.z.string().optional(),
    to: zod_1.z.string().optional(),
    status: zod_1.z.string().optional(),
    limit: zod_1.z.number().int().positive().max(200).optional(),
    useUserToken: zod_1.z.boolean().optional(),
});
const mcpServer = new index_js_1.Server(SERVER_INFO, {
    capabilities: {
        tools: {},
    },
});
mcpServer.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => ({ tools }));
mcpServer.setRequestHandler(types_js_1.CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    const rawArgs = args || {};
    const authInfo = extra?.authInfo || {};
    const userToken = authInfo.bearerToken;
    const subject = authInfo.validatedToken?.subject;
    console.log(`[tools/call] ${name} requested by ${subject ?? 'unknown-subject'}`);
    const runWithOptions = async (useUserToken, exec) => {
        const options = {};
        if (useUserToken) {
            if (!userToken) {
                throw new Error('User token not available for this session.');
            }
            options.useUserToken = true;
            options.userToken = userToken;
        }
        return exec(options);
    };
    try {
        switch (name) {
            case 'neonpanel.getAccount': {
                const parsed = getAccountArgsSchema.parse(rawArgs);
                const account = await runWithOptions(parsed.useUserToken, (options) => (0, neonpanel_api_js_1.getAccount)(parsed.accountId, options));
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({ account }, null, 2)
                        }
                    ]
                };
            }
            case 'neonpanel.searchOrders': {
                const parsed = searchOrdersArgsSchema.parse(rawArgs);
                const { useUserToken, ...filters } = parsed;
                const orders = await runWithOptions(useUserToken, (options) => (0, neonpanel_api_js_1.searchOrders)(filters, options));
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({ orders }, null, 2)
                        }
                    ]
                };
            }
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }
    catch (error) {
        const description = error?.message || 'Tool execution failed.';
        throw new Error(`Tool execution failed: ${description}`);
    }
});
app.get('/healthz', (_req, res) => {
    res.json({
        status: 'ok',
        service: SERVER_INFO.name,
        baseUrl: NEONPANEL_BASE_URL,
        protocolVersion: SERVER_PROTOCOL_VERSION,
        ts: new Date().toISOString()
    });
});
app.options('/sse', (_req, res) => {
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Cache-Control, Content-Type');
    res.status(204).end();
});
app.get('/sse', requireBearer, async (req, res) => {
    const authReq = req;
    const bearerToken = authReq.bearerToken;
    const validatedToken = authReq.validatedToken;
    try {
        const transport = new sse_js_1.SSEServerTransport('/messages', res);
        await mcpServer.connect(transport);
        const sessionId = transport.sessionId;
        activeSessions.set(sessionId, {
            transport,
            bearerToken,
            validatedToken
        });
        transport.onclose = () => {
            activeSessions.delete(sessionId);
        };
        res.write(`event: ready\ndata: ${JSON.stringify({ ok: true, sessionId, subject: validatedToken.subject ?? null, scopes: validatedToken.scopes })}\n\n`);
        const heartbeat = setInterval(() => {
            if (res.writableEnded) {
                clearInterval(heartbeat);
                return;
            }
            res.write(`event: ping\ndata: ${Date.now()}\n\n`);
        }, SSE_HEARTBEAT_MS);
        req.on('close', () => {
            clearInterval(heartbeat);
            activeSessions.delete(sessionId);
        });
    }
    catch (error) {
        console.error('SSE connection error:', error);
        res.status(500).end();
    }
});
app.options('/messages', (_req, res) => {
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Cache-Control, Content-Type');
    res.status(204).end();
});
app.post('/messages', requireBearer, async (req, res) => {
    const authReq = req;
    const incomingValidation = authReq.validatedToken;
    const querySession = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;
    const headerSession = req.get('mcp-session-id') || req.get('MCP-Session-Id');
    const sessionId = querySession || headerSession || undefined;
    if (!sessionId) {
        return res.status(400).json({
            error: 'invalid_request',
            error_description: 'Missing sessionId. Provide ?sessionId=... or MCP-Session-Id header.'
        });
    }
    const session = activeSessions.get(sessionId);
    if (!session) {
        return res.status(404).json({
            error: 'unknown_session',
            error_description: 'No active SSE session found for the provided sessionId.'
        });
    }
    if (!incomingValidation || session.validatedToken.token !== incomingValidation.token) {
        attachAuthChallenge(res, req, { error: 'invalid_token', description: 'Token does not match active SSE session.' });
        return res.status(403).json({
            error: 'invalid_token',
            error_description: 'Token does not match active SSE session.'
        });
    }
    try {
        const transportReq = req;
        const clientId = typeof session.validatedToken.payload?.client_id === 'string'
            ? session.validatedToken.payload.client_id
            : undefined;
        transportReq.auth = {
            token: session.bearerToken,
            scopes: session.validatedToken.scopes,
            clientId,
            subject: session.validatedToken.subject,
            issuer: session.validatedToken.issuer,
        };
        await session.transport.handlePostMessage(transportReq, res, req.body);
    }
    catch (error) {
        console.error('Error handling /messages payload:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'internal_error', error_description: 'Failed to process MCP message.' });
        }
    }
});
(0, exec_route_js_1.registerExecRoute)(app, {
    neonpanelBaseUrl: NEONPANEL_BASE_URL,
    attachAuthChallenge,
});
const PORT = process.env.PORT || 3030;
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`NeonPanel MCP server running on :${PORT}`);
        console.log(`Health: http://localhost:${PORT}/healthz`);
        console.log(`SSE:    http://localhost:${PORT}/sse`);
        console.log(`POST:   http://localhost:${PORT}/messages`);
    });
}
exports.default = app;
