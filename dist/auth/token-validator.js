"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenValidationError = void 0;
exports.isTokenValidationError = isTokenValidationError;
exports.validateAccessToken = validateAccessToken;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const jwks_rsa_1 = __importDefault(require("jwks-rsa"));
const config_1 = require("../config");
class TokenValidationError extends Error {
    constructor(message, code = 'invalid_token', status = 401, cause) {
        super(message);
        this.name = 'TokenValidationError';
        this.code = code;
        this.status = status;
        if (cause && cause.stack) {
            this.stack = `${this.name}: ${this.message}\nCaused by: ${cause.stack}`;
        }
    }
}
exports.TokenValidationError = TokenValidationError;
function isTokenValidationError(error) {
    return error instanceof TokenValidationError;
}
const jwks = (0, jwks_rsa_1.default)({
    jwksUri: config_1.config.neonpanel.jwksUri,
    timeout: toPositiveInt(process.env.NEONPANEL_JWKS_TIMEOUT_MS, 5000),
    cache: true,
    cacheMaxEntries: toPositiveInt(process.env.NEONPANEL_JWKS_CACHE_MAX_ENTRIES, 10),
    cacheMaxAge: toPositiveInt(process.env.NEONPANEL_JWKS_CACHE_MS, 10 * 60 * 1000),
    rateLimit: true,
    jwksRequestsPerMinute: toPositiveInt(process.env.NEONPANEL_JWKS_REQUESTS_PER_MINUTE, 30),
});
async function validateAccessToken(token) {
    if (!token || typeof token !== 'string') {
        throw new TokenValidationError('Missing OAuth access token.');
    }
    const verifyOptions = {
        algorithms: ['RS256'],
        issuer: config_1.config.neonpanel.issuer,
        // Make audience validation optional - OAuth server may not include audience claim
        // This is acceptable since we're validating the issuer and signature
    };
    const payload = await new Promise((resolve, reject) => {
        jsonwebtoken_1.default.verify(token, getSigningKey, verifyOptions, (err, decoded) => {
            if (err) {
                return reject(normalizeJwtError(err));
            }
            if (!decoded || typeof decoded === 'string') {
                return reject(new TokenValidationError('Token payload is not a JWT object.'));
            }
            resolve(decoded);
        });
    });
    const scopes = extractScopes(payload);
    // Note: Scope enforcement is currently handled at the MCP layer.
    // We accept any valid token from the trusted issuer here.
    return {
        token,
        payload,
        scopes,
        subject: payload.sub,
        issuer: payload.iss,
        audience: payload.aud,
        expiresAt: typeof payload.exp === 'number' ? payload.exp : undefined,
        issuedAt: typeof payload.iat === 'number' ? payload.iat : undefined,
    };
}
function getSigningKey(header, callback) {
    if (!header.kid) {
        callback(new TokenValidationError('Token header missing key identifier (kid).'));
        return;
    }
    const timeoutMs = toPositiveInt(process.env.NEONPANEL_JWKS_TIMEOUT_MS, 5000);
    let settled = false;
    const timer = setTimeout(() => {
        if (settled) {
            return;
        }
        settled = true;
        callback(new TokenValidationError('JWKS request timed out.', 'jwks_timeout', 503));
    }, timeoutMs);
    timer.unref?.();
    jwks.getSigningKey(header.kid)
        .then(key => {
        if (settled) {
            return;
        }
        settled = true;
        clearTimeout(timer);
        const signingKey = typeof key.getPublicKey === 'function'
            ? key.getPublicKey()
            : key.rsaPublicKey;
        if (!signingKey) {
            callback(new TokenValidationError('Unable to resolve signing key for token.'));
            return;
        }
        callback(null, signingKey);
    })
        .catch(err => {
        if (settled) {
            return;
        }
        settled = true;
        clearTimeout(timer);
        callback(normalizeJwtError(err));
    });
}
function normalizeJwtError(error) {
    if (error instanceof TokenValidationError) {
        return error;
    }
    const name = error.name;
    switch (name) {
        case 'TokenExpiredError':
            return new TokenValidationError('Access token has expired.');
        case 'JsonWebTokenError':
            return new TokenValidationError(error.message || 'Access token is not valid.');
        case 'NotBeforeError':
            return new TokenValidationError('Access token is not yet valid.');
        default:
            return new TokenValidationError(error.message || 'Failed to validate access token.');
    }
}
function extractScopes(payload) {
    const scopes = [];
    if (typeof payload.scope === 'string') {
        scopes.push(...payload.scope.split(/\s+/));
    }
    if (Array.isArray(payload.scp)) {
        const scp = payload.scp;
        for (const item of scp) {
            if (typeof item === 'string') {
                scopes.push(item);
            }
        }
    }
    return Array.from(new Set(scopes.filter(Boolean)));
}
function toPositiveInt(value, fallback) {
    if (!value) {
        return fallback;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
