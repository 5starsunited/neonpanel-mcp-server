"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPENID_CONFIGURATION_PATH = exports.AUTHORIZATION_SERVER_PATH = exports.RESOURCE_METADATA_PATH = void 0;
exports.resolveBaseUrl = resolveBaseUrl;
exports.buildResourceMetadataUrl = buildResourceMetadataUrl;
const express_1 = __importDefault(require("express"));
const axios_1 = __importDefault(require("axios"));
const router = express_1.default.Router();
exports.RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource';
exports.AUTHORIZATION_SERVER_PATH = '/.well-known/oauth-authorization-server';
exports.OPENID_CONFIGURATION_PATH = '/.well-known/openid-configuration';
const DEFAULT_SCOPE_SET = [
    'read:inventory',
    'read:analytics',
    'read:companies',
    'read:reports',
    'read:warehouses',
    'read:revenue',
    'read:cogs',
    'read:landed-cost',
    'write:import'
];
const FALLBACK_AUTHORIZATION_SERVER = process.env.MCP_OAUTH_ISSUER || 'https://my.neonpanel.com';
function resolveForwardedProto(req) {
    const forwarded = req.headers['x-forwarded-proto'];
    if (Array.isArray(forwarded)) {
        return forwarded[0];
    }
    if (typeof forwarded === 'string' && forwarded.length > 0) {
        return forwarded.split(',')[0].trim();
    }
    return req.protocol;
}
function resolveBaseUrl(req) {
    const protocol = resolveForwardedProto(req);
    const host = req.get('host') || 'localhost';
    return `${protocol}://${host}`;
}
function buildResourceMetadataUrl(req) {
    return `${resolveBaseUrl(req)}${exports.RESOURCE_METADATA_PATH}`;
}
function resolveIssuer() {
    return process.env.MCP_OAUTH_ISSUER || FALLBACK_AUTHORIZATION_SERVER;
}
function buildAuthorizationServerMetadata(req) {
    const issuer = resolveIssuer();
    const jwksUri = process.env.MCP_OAUTH_JWKS_URI || `${issuer}/.well-known/jwks.json`;
    // DCR endpoint is hosted on MCP server, not NeonPanel
    const mcpBaseUrl = req ? resolveBaseUrl(req) : 'https://mcp.neonpanel.com';
    return {
        issuer,
        authorization_endpoint: `${issuer}/oauth2/authorize`,
        token_endpoint: `${issuer}/oauth2/token`,
        registration_endpoint: `${mcpBaseUrl}/oauth2/register`, // DCR proxy on MCP server
        scopes_supported: DEFAULT_SCOPE_SET,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
        jwks_uri: jwksUri
    };
}
// OAuth Protected Resource Metadata (RFC 9728)
router.get(exports.RESOURCE_METADATA_PATH, (req, res) => {
    const resource = resolveBaseUrl(req);
    const authorizationServer = resolveIssuer();
    res.json({
        resource,
        authorization_servers: [authorizationServer],
        bearer_methods_supported: ['header'],
        scopes_supported: DEFAULT_SCOPE_SET
    });
});
// OAuth 2.0 Authorization Server Metadata (RFC8414)
router.get(exports.AUTHORIZATION_SERVER_PATH, (req, res) => {
    res.json(buildAuthorizationServerMetadata(req));
});
// OpenID Provider Configuration (OIDC Discovery)
router.get(exports.OPENID_CONFIGURATION_PATH, (req, res) => {
    res.json({
        ...buildAuthorizationServerMetadata(req),
        issuer: resolveIssuer(),
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256']
    });
});
// OAuth Authorization Endpoint
router.get('/oauth/authorize', (req, res) => {
    const { client_id, redirect_uri, response_type, scope, state, code_challenge, code_challenge_method } = req.query;
    // Validate required parameters
    if (!client_id || !redirect_uri || !response_type || !state) {
        return res.status(400).json({
            error: 'invalid_request',
            error_description: 'Missing required parameters'
        });
    }
    // Pass through to NeonPanel's OAuth - each client has their own callback URL
    const neonpanelAuthUrl = new URL('https://my.neonpanel.com/oauth2/authorize');
    neonpanelAuthUrl.searchParams.set('client_id', client_id);
    neonpanelAuthUrl.searchParams.set('redirect_uri', redirect_uri);
    neonpanelAuthUrl.searchParams.set('response_type', response_type);
    neonpanelAuthUrl.searchParams.set('scope', scope || 'read:inventory read:analytics');
    neonpanelAuthUrl.searchParams.set('state', state);
    if (code_challenge) {
        neonpanelAuthUrl.searchParams.set('code_challenge', code_challenge);
    }
    if (code_challenge_method) {
        neonpanelAuthUrl.searchParams.set('code_challenge_method', code_challenge_method);
    }
    res.redirect(neonpanelAuthUrl.toString());
});
// OAuth Token Endpoint
router.post('/oauth/token', async (req, res) => {
    const { grant_type, code, redirect_uri, client_id, client_secret, code_verifier, refresh_token, scope } = req.body;
    // Validate grant_type
    const supportedGrantTypes = ['authorization_code', 'refresh_token', 'client_credentials'];
    if (!grant_type || !supportedGrantTypes.includes(grant_type)) {
        return res.status(400).json({
            error: 'unsupported_grant_type',
            error_description: `Grant type must be one of: ${supportedGrantTypes.join(', ')}`
        });
    }
    try {
        // Build request body based on grant type
        const tokenParams = {
            grant_type: grant_type
        };
        if (grant_type === 'authorization_code') {
            if (!code) {
                return res.status(400).json({
                    error: 'invalid_request',
                    error_description: 'Missing required parameter: code'
                });
            }
            tokenParams.code = code;
            if (redirect_uri)
                tokenParams.redirect_uri = redirect_uri;
            if (client_id)
                tokenParams.client_id = client_id;
            if (code_verifier)
                tokenParams.code_verifier = code_verifier;
        }
        else if (grant_type === 'refresh_token') {
            if (!refresh_token) {
                return res.status(400).json({
                    error: 'invalid_request',
                    error_description: 'Missing required parameter: refresh_token'
                });
            }
            tokenParams.refresh_token = refresh_token;
            if (client_id)
                tokenParams.client_id = client_id;
            if (client_secret)
                tokenParams.client_secret = client_secret;
            if (scope)
                tokenParams.scope = scope;
        }
        else if (grant_type === 'client_credentials') {
            if (!client_id || !client_secret) {
                return res.status(400).json({
                    error: 'invalid_request',
                    error_description: 'Missing required parameters: client_id and client_secret'
                });
            }
            tokenParams.client_id = client_id;
            tokenParams.client_secret = client_secret;
            if (scope)
                tokenParams.scope = scope;
        }
        // Exchange with NeonPanel
        const tokenResponse = await axios_1.default.post('https://my.neonpanel.com/oauth2/token', new URLSearchParams(tokenParams).toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            validateStatus: () => true
        });
        const rawData = tokenResponse.data;
        let parsedData = rawData;
        if (typeof rawData === 'string') {
            try {
                parsedData = JSON.parse(rawData);
            }
            catch {
                parsedData = rawData.trim();
            }
        }
        if (tokenResponse.status < 200 || tokenResponse.status >= 300) {
            const errorData = parsedData && typeof parsedData === 'object'
                ? parsedData
                : { error: 'server_error', error_description: String(parsedData) };
            return res.status(tokenResponse.status).json({
                error: errorData.error || 'invalid_grant',
                error_description: errorData.error_description || 'Token exchange failed'
            });
        }
        // Return the token data from NeonPanel
        res.status(tokenResponse.status).json(parsedData);
    }
    catch (error) {
        console.error('Token endpoint error:', error);
        console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        // Send more detailed error in development
        if (process.env.NODE_ENV === 'development') {
            return res.status(500).json({
                error: 'server_error',
                error_description: `Internal server error: ${errorMessage}`,
                stack: error instanceof Error ? error.stack : undefined
            });
        }
        res.status(500).json({
            error: 'server_error',
            error_description: `Internal server error: ${errorMessage}`
        });
    }
});
// Dynamic Client Registration Proxy
// ChatGPT requires DCR, but NeonPanel uses pre-registered clients
// Solution: Always return the same pre-registered client credentials
// This allows ChatGPT to "register" while using NeonPanel's static client
router.post('/oauth2/register', (req, res) => {
    const { redirect_uris, client_name, client_uri, logo_uri, scope, grant_types, response_types, token_endpoint_auth_method } = req.body;
    console.log('[DCR Proxy] Registration request received:', {
        client_name,
        redirect_uris,
        scope,
        grant_types,
        response_types
    });
    // ALWAYS return the same pre-registered NeonPanel client
    // This is a "fake" DCR that makes ChatGPT happy while using static credentials
    const response = {
        client_id: '1145f268-a864-11f0-8a3d-122c1fe52bef',
        client_secret: 'NbhL8t71IKgf5JDHI9LeyUrbFpcC4hDGA6aLray5iih4h7NalTxJhfeUFLOOs0pk',
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_secret_expires_at: 0, // No expiration
        // Echo back what ChatGPT requested, but we ignore these
        // The actual config is in NeonPanel
        redirect_uris: redirect_uris || ['https://mcp.neonpanel.com/callback'],
        client_name: client_name || 'ChatGPT MCP Connector',
        client_uri: client_uri || 'https://mcp.neonpanel.com',
        logo_uri: logo_uri,
        scope: scope || 'read:inventory read:analytics read:companies read:reports',
        grant_types: grant_types || ['authorization_code', 'refresh_token'],
        response_types: response_types || ['code'],
        // Public client - uses PKCE instead of client_secret
        token_endpoint_auth_method: token_endpoint_auth_method || 'none'
    };
    console.log('[DCR Proxy] Returning pre-registered client:', {
        client_id: response.client_id,
        redirect_uris: response.redirect_uris,
        grant_types: response.grant_types
    });
    res.status(201).json(response);
});
exports.default = router;
