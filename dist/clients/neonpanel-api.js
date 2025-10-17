"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NeonPanelApiError = void 0;
exports.neonPanelRequest = neonPanelRequest;
const undici_1 = require("undici");
const config_1 = require("../config");
const errors_1 = require("../lib/errors");
class NeonPanelApiError extends errors_1.AppError {
    constructor(message, options = {}) {
        super(message, {
            status: options.status ?? 502,
            code: options.code ?? 'neonpanel_api_error',
            details: options.details,
        });
        this.name = 'NeonPanelApiError';
    }
}
exports.NeonPanelApiError = NeonPanelApiError;
async function neonPanelRequest(options) {
    const url = buildUrl(options.path, options.query);
    const method = options.method ?? 'GET';
    const controller = new AbortController();
    const timeout = options.timeoutMs ?? config_1.config.http.requestTimeoutMs;
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await (0, undici_1.fetch)(url, {
            method,
            headers: buildHeaders(options.token, options.body),
            body: serializeBody(method, options.body),
            signal: controller.signal,
        });
        if (!response.ok) {
            const errorPayload = await safeParse(response);
            const errorCode = (errorPayload &&
                typeof errorPayload === 'object' &&
                'error' in errorPayload &&
                errorPayload.error &&
                typeof errorPayload.error === 'object' &&
                'code' in errorPayload.error &&
                typeof errorPayload.error.code === 'string')
                ? errorPayload.error.code
                : 'neonpanel_api_error';
            throw new NeonPanelApiError('NeonPanel API request failed', {
                status: response.status,
                code: errorCode,
                details: errorPayload,
            });
        }
        if (response.status === 204) {
            return undefined;
        }
        const payload = await response.json();
        return payload;
    }
    catch (error) {
        if (error instanceof NeonPanelApiError) {
            throw error;
        }
        if (error.name === 'AbortError') {
            throw new NeonPanelApiError('NeonPanel API request timed out.', {
                status: 504,
                code: 'neonpanel_timeout',
            });
        }
        throw new NeonPanelApiError('Unexpected NeonPanel API error', {
            status: 500,
            code: 'neonpanel_unexpected_error',
            details: error,
        });
    }
    finally {
        clearTimeout(timer);
    }
}
function buildUrl(path, query) {
    const base = config_1.config.neonpanel.apiBaseUrl;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${base}${normalizedPath}`);
    if (query) {
        for (const [key, value] of Object.entries(query)) {
            if (value === undefined || value === null) {
                continue;
            }
            if (Array.isArray(value)) {
                for (const item of value) {
                    if (item === undefined || item === null)
                        continue;
                    url.searchParams.append(key, String(item));
                }
            }
            else {
                url.searchParams.set(key, String(value));
            }
        }
    }
    return url.toString();
}
function buildHeaders(token, body) {
    const headers = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
    };
    if (body !== undefined && body !== null) {
        headers['Content-Type'] = 'application/json';
    }
    return headers;
}
function serializeBody(method, body) {
    if (method.toUpperCase() === 'GET' || method.toUpperCase() === 'DELETE') {
        return undefined;
    }
    if (body === undefined || body === null) {
        return undefined;
    }
    return JSON.stringify(body);
}
async function safeParse(response) {
    try {
        return await response.json();
    }
    catch {
        try {
            return await response.text();
        }
        catch {
            return null;
        }
    }
}
