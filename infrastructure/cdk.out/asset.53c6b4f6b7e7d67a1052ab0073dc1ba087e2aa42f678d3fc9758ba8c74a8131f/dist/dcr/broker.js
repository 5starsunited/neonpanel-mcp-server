"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_DCR_BASE_URL = void 0;
exports.registerClient = registerClient;
exports.fetchClient = fetchClient;
exports.updateClient = updateClient;
exports.deleteClient = deleteClient;
const axios_1 = __importDefault(require("axios"));
exports.DEFAULT_DCR_BASE_URL = 'https://my.neonpanel.com/oauth2';
async function registerClient(options) {
    const baseUrl = sanitizeBaseUrl(options.baseUrl ?? exports.DEFAULT_DCR_BASE_URL);
    const url = `${baseUrl}/register`;
    try {
        const response = await axios_1.default.post(url, options.metadata, {
            headers: {
                Authorization: `Bearer ${options.initialAccessToken}`,
                'Content-Type': 'application/json',
            },
            validateStatus: () => true,
        });
        if (response.status < 200 || response.status >= 300) {
            throw buildBrokerError('register', response.status, response.data);
        }
        return response.data;
    }
    catch (error) {
        throw normalizeAxiosError('register', error);
    }
}
async function fetchClient(options) {
    try {
        const response = await axios_1.default.get(options.registrationUri, {
            headers: {
                Authorization: `Bearer ${options.registrationAccessToken}`,
            },
            validateStatus: () => true,
        });
        if (response.status < 200 || response.status >= 300) {
            throw buildBrokerError('fetch', response.status, response.data);
        }
        return response.data;
    }
    catch (error) {
        throw normalizeAxiosError('fetch', error);
    }
}
async function updateClient(options) {
    try {
        const method = options.usePatch ? 'patch' : 'put';
        const response = await axios_1.default.request({
            url: options.registrationUri,
            method,
            data: options.metadata,
            headers: {
                Authorization: `Bearer ${options.registrationAccessToken}`,
                'Content-Type': 'application/json',
            },
            validateStatus: () => true,
        });
        if (response.status < 200 || response.status >= 300) {
            throw buildBrokerError('update', response.status, response.data);
        }
        return response.data;
    }
    catch (error) {
        throw normalizeAxiosError('update', error);
    }
}
async function deleteClient(options) {
    try {
        const response = await axios_1.default.delete(options.registrationUri, {
            headers: {
                Authorization: `Bearer ${options.registrationAccessToken}`,
            },
            validateStatus: () => true,
        });
        if (response.status < 200 || response.status >= 300) {
            throw buildBrokerError('delete', response.status, response.data);
        }
    }
    catch (error) {
        throw normalizeAxiosError('delete', error);
    }
}
function sanitizeBaseUrl(value) {
    return value.replace(/\/+$/u, '');
}
function buildBrokerError(stage, statusCode, data) {
    const summary = summarizePayload(data);
    const message = `DCR ${stage} failed with status ${statusCode}${summary ? `: ${summary}` : ''}`;
    const error = new Error(message);
    error.statusCode = statusCode;
    error.payload = data;
    return error;
}
function summarizePayload(data) {
    if (!data) {
        return '';
    }
    if (typeof data === 'string') {
        return data.length > 200 ? `${data.slice(0, 200)}…` : data;
    }
    try {
        const json = JSON.stringify(data);
        return json.length > 200 ? `${json.slice(0, 200)}…` : json;
    }
    catch {
        return '[unserializable payload]';
    }
}
function normalizeAxiosError(stage, error) {
    if (axios_1.default.isAxiosError(error)) {
        const axiosError = error;
        const status = axiosError.response?.status ?? 0;
        const payload = axiosError.response?.data;
        const wrapped = buildBrokerError(stage, status, payload);
        wrapped.stack = error instanceof Error && error.stack ? `${wrapped.message}\nCaused by: ${error.stack}` : wrapped.message;
        return wrapped;
    }
    if (error instanceof Error) {
        return error;
    }
    return new Error(`Unexpected error during DCR ${stage}: ${String(error)}`);
}
