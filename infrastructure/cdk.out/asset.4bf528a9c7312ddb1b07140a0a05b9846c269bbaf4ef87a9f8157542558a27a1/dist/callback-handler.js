"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.storeOAuthSession = storeOAuthSession;
exports.getOAuthSession = getOAuthSession;
const express_1 = __importDefault(require("express"));
const router = express_1.default.Router();
// In-memory session storage (replace with Redis or similar in production)
const sessionStore = new Map();
// Clean up expired sessions (older than 10 minutes)
setInterval(() => {
    const now = Date.now();
    const tenMinutes = 10 * 60 * 1000;
    for (const [sessionId, session] of sessionStore.entries()) {
        if (now - session.timestamp > tenMinutes) {
            sessionStore.delete(sessionId);
        }
    }
}, 60 * 1000); // Run every minute
/**
 * Store session data before initiating OAuth flow
 */
function storeOAuthSession(sessionId, data) {
    sessionStore.set(sessionId, {
        codeVerifier: data.codeVerifier,
        originalState: data.state,
        clientId: data.clientId,
        redirectUri: data.redirectUri,
        timestamp: Date.now()
    });
}
/**
 * Retrieve and delete session data
 */
function getOAuthSession(sessionId) {
    const session = sessionStore.get(sessionId);
    if (session) {
        sessionStore.delete(sessionId);
        return session;
    }
    return null;
}
// OAuth Callback Handler
router.get('/callback', async (req, res) => {
    const { code, state, error, error_description } = req.query;
    // Handle OAuth errors
    if (error) {
        console.error('OAuth error:', error, error_description);
        return res.status(400).json({
            success: false,
            error: error,
            error_description: error_description || 'Authorization failed',
            message: 'OAuth authorization failed. Please try again.'
        });
    }
    // Validate required parameters
    if (!code || !state) {
        return res.status(400).json({
            success: false,
            error: 'invalid_request',
            error_description: 'Missing code or state parameter',
            message: 'Invalid callback request. Missing required parameters.'
        });
    }
    try {
        // Retrieve session data using state as session ID
        // In production, extract actual session ID from encrypted state
        const session = getOAuthSession(state);
        if (!session) {
            return res.status(400).json({
                success: false,
                error: 'invalid_state',
                error_description: 'State parameter is invalid or expired',
                message: 'Session expired or invalid. Please start authorization again.'
            });
        }
        // Validate state matches (CSRF protection)
        if (session.originalState !== state) {
            return res.status(400).json({
                success: false,
                error: 'state_mismatch',
                error_description: 'State parameter does not match',
                message: 'Security validation failed. Please try again.'
            });
        }
        // Exchange authorization code for access token
        const tokenResponse = await exchangeCodeForToken({
            code,
            codeVerifier: session.codeVerifier,
            clientId: session.clientId,
            redirectUri: session.redirectUri
        });
        if (!tokenResponse.access_token) {
            throw new Error('Token exchange did not return access token');
        }
        // TODO: Store tokens securely (encrypt with KMS)
        // TODO: Associate tokens with user session
        // TODO: Redirect to appropriate UI or close popup
        // For now, return success with token info
        res.json({
            success: true,
            message: 'Authorization successful!',
            token_type: tokenResponse.token_type,
            expires_in: tokenResponse.expires_in,
            // Don't expose actual tokens in response - store them securely
            has_access_token: !!tokenResponse.access_token,
            has_refresh_token: !!tokenResponse.refresh_token
        });
    }
    catch (error) {
        console.error('Token exchange error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({
            success: false,
            error: 'token_exchange_failed',
            error_description: errorMessage,
            message: 'Failed to complete authorization. Please try again.'
        });
    }
});
/**
 * Exchange authorization code for access token
 */
async function exchangeCodeForToken(params) {
    const tokenUrl = process.env.NEONPANEL_TOKEN_URL || 'https://my.neonpanel.com/oauth2/token';
    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: params.code,
        redirect_uri: params.redirectUri,
        client_id: params.clientId,
        code_verifier: params.codeVerifier
    });
    const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
    });
    if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
            errorData = JSON.parse(errorText);
        }
        catch {
            errorData = { error: 'unknown', error_description: errorText };
        }
        throw new Error(`Token exchange failed: ${errorData.error || response.status} - ${errorData.error_description || response.statusText}`);
    }
    const tokenData = await response.json();
    return {
        access_token: tokenData.access_token,
        token_type: tokenData.token_type || 'Bearer',
        expires_in: tokenData.expires_in,
        refresh_token: tokenData.refresh_token,
        scope: tokenData.scope
    };
}
/**
 * Initiate OAuth Authorization Flow
 *
 * Helper endpoint to start OAuth flow (for testing or direct API calls)
 */
router.get('/oauth/start', (req, res) => {
    const { client_id, scope } = req.query;
    if (!client_id) {
        return res.status(400).json({
            error: 'invalid_request',
            error_description: 'Missing client_id parameter'
        });
    }
    // Generate PKCE values
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();
    // Construct callback URL
    const redirectUri = `${req.protocol}://${req.get('host')}/callback`;
    // Store session
    storeOAuthSession(state, {
        codeVerifier,
        state,
        clientId: client_id,
        redirectUri
    });
    // Build authorization URL
    const authUrl = new URL(process.env.NEONPANEL_AUTH_URL || 'https://my.neonpanel.com/oauth2/authorize');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', client_id);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', scope || 'read:inventory read:analytics');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    // Return authorization URL (or redirect directly)
    if (req.query.redirect === 'true') {
        res.redirect(authUrl.toString());
    }
    else {
        res.json({
            authorization_url: authUrl.toString(),
            state: state,
            redirect_uri: redirectUri
        });
    }
});
/**
 * PKCE Helper Functions
 */
function generateCodeVerifier() {
    // Generate 43-128 character random string
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const length = 128; // Maximum length for better security
    let verifier = '';
    const randomBytes = crypto.getRandomValues(new Uint8Array(length));
    for (let i = 0; i < length; i++) {
        verifier += chars[randomBytes[i] % chars.length];
    }
    return verifier;
}
function generateCodeChallenge(verifier) {
    // SHA256 hash and base64url encode
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    // Use Web Crypto API for SHA256
    return crypto.subtle.digest('SHA-256', data)
        .then(hash => {
        return base64UrlEncode(new Uint8Array(hash));
    })
        .toString(); // This is synchronous in the actual implementation
}
function base64UrlEncode(buffer) {
    const base64 = btoa(String.fromCharCode(...buffer));
    return base64
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}
function generateState() {
    // Generate random state for CSRF protection
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return base64UrlEncode(array);
}
exports.default = router;
