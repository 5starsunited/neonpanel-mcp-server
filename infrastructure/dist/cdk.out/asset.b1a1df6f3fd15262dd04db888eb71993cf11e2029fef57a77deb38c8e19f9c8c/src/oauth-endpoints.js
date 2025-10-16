"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const crypto_1 = __importDefault(require("crypto"));
const router = express_1.default.Router();
// OAuth 2.0 Authorization Server Metadata (RFC8414)
router.get('/.well-known/oauth-authorization-server', (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/oauth/authorize`,
        token_endpoint: `${baseUrl}/oauth/token`,
        registration_endpoint: `${baseUrl}/oauth/register`,
        scopes_supported: ['read:inventory', 'read:analytics'],
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'client_credentials'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
        client_id: 'mcp-client'
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
    // For MCP, we'll redirect to NeonPanel's OAuth
    const neonpanelAuthUrl = new URL('https://my.neonpanel.com/oauth/authorize');
    neonpanelAuthUrl.searchParams.set('client_id', 'mcp-client');
    neonpanelAuthUrl.searchParams.set('redirect_uri', redirect_uri);
    neonpanelAuthUrl.searchParams.set('response_type', 'code');
    neonpanelAuthUrl.searchParams.set('scope', 'read:inventory read:analytics');
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
    const { grant_type, code, redirect_uri, client_id, code_verifier } = req.body;
    if (grant_type !== 'authorization_code') {
        return res.status(400).json({
            error: 'unsupported_grant_type',
            error_description: 'Only authorization_code grant type is supported'
        });
    }
    try {
        // Exchange code with NeonPanel
        const tokenResponse = await fetch('https://my.neonpanel.com/oauth/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: redirect_uri,
                client_id: client_id,
                ...(code_verifier && { code_verifier: code_verifier })
            })
        });
        if (!tokenResponse.ok) {
            const error = await tokenResponse.json();
            return res.status(400).json({
                error: 'invalid_grant',
                error_description: error.error_description || 'Token exchange failed'
            });
        }
        const tokenData = await tokenResponse.json();
        // Return the token data from NeonPanel
        res.json(tokenData);
    }
    catch (error) {
        res.status(500).json({
            error: 'server_error',
            error_description: 'Internal server error during token exchange'
        });
    }
});
// Dynamic Client Registration Endpoint
router.post('/oauth/register', (req, res) => {
    const { redirect_uris, client_name, client_uri, logo_uri, scope, grant_types, response_types } = req.body;
    // Generate client credentials
    const client_id = `mcp_${crypto_1.default.randomBytes(16).toString('hex')}`;
    const client_secret = crypto_1.default.randomBytes(32).toString('base64url');
    // Return client registration response
    res.status(201).json({
        client_id,
        client_secret,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_secret_expires_at: 0, // No expiration
        redirect_uris: redirect_uris || ['http://localhost:3000/callback'],
        client_name: client_name || 'MCP Client',
        client_uri: client_uri || 'https://mcp.neonpanel.com',
        logo_uri: logo_uri || 'https://mcp.neonpanel.com/logo.png',
        scope: scope || 'read:inventory read:analytics',
        grant_types: grant_types || ['authorization_code'],
        response_types: response_types || ['code'],
        token_endpoint_auth_method: 'client_secret_basic'
    });
});
exports.default = router;
