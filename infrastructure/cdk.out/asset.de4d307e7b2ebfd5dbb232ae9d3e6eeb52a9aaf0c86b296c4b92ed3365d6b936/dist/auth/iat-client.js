"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getIATAccessToken = getIATAccessToken;
exports.clearCachedIAT = clearCachedIAT;
const axios_1 = __importDefault(require("axios"));
const DEFAULT_TOKEN_PATH = '/oauth2/token';
const SAFETY_WINDOW_SECONDS = Number.parseInt(process.env.NEONPANEL_IAT_REFRESH_BUFFER || '90', 10);
let cachedToken = null;
function getTokenEndpoint(baseUrl) {
    if (process.env.NEONPANEL_OAUTH_TOKEN_URL) {
        return process.env.NEONPANEL_OAUTH_TOKEN_URL;
    }
    const normalized = baseUrl.replace(/\/$/, '');
    return `${normalized}${DEFAULT_TOKEN_PATH}`;
}
function nowInSeconds() {
    return Math.floor(Date.now() / 1000);
}
function shouldRefresh(token) {
    if (!token)
        return true;
    return token.expiresAt <= nowInSeconds() + SAFETY_WINDOW_SECONDS;
}
async function getIATAccessToken(baseUrl) {
    if (!shouldRefresh(cachedToken)) {
        return cachedToken.accessToken;
    }
    const clientId = process.env.NEONPANEL_CLIENT_ID;
    const clientSecret = process.env.NEONPANEL_CLIENT_SECRET;
    const scope = process.env.NEONPANEL_IAT_SCOPE || 'neonpanel.api';
    const audience = process.env.NEONPANEL_IAT_AUDIENCE || baseUrl;
    if (!clientId || !clientSecret) {
        throw new Error('NeonPanel client credentials are not configured. Set NEONPANEL_CLIENT_ID and NEONPANEL_CLIENT_SECRET.');
    }
    const tokenUrl = getTokenEndpoint(baseUrl);
    const body = new URLSearchParams();
    body.set('grant_type', 'client_credentials');
    body.set('client_id', clientId);
    body.set('client_secret', clientSecret);
    body.set('scope', scope);
    if (audience) {
        body.set('audience', audience);
    }
    const response = await axios_1.default.post(tokenUrl, body, {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });
    const { access_token: accessToken, expires_in: expiresIn, scope: grantedScope } = response.data || {};
    if (!accessToken || !expiresIn) {
        throw new Error('NeonPanel token endpoint returned an unexpected response.');
    }
    cachedToken = {
        accessToken,
        expiresAt: nowInSeconds() + Math.max(Number(expiresIn), SAFETY_WINDOW_SECONDS + 30),
        scope: grantedScope
    };
    return accessToken;
}
function clearCachedIAT() {
    cachedToken = null;
}
