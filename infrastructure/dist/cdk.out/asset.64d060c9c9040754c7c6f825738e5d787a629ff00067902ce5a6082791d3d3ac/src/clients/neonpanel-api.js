"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAccount = getAccount;
exports.searchOrders = searchOrders;
const axios_1 = __importDefault(require("axios"));
const iat_client_js_1 = require("../auth/iat-client.js");
const DEFAULT_TIMEOUT = Number.parseInt(process.env.NEONPANEL_HTTP_TIMEOUT_MS || '15000', 10);
function getBaseUrl() {
    return (process.env.NEONPANEL_API_BASE || process.env.NEONPANEL_BASE_URL || 'https://my.neonpanel.com').replace(/\/$/, '');
}
function createClient() {
    return axios_1.default.create({
        baseURL: getBaseUrl(),
        timeout: DEFAULT_TIMEOUT,
    });
}
const client = createClient();
async function resolveAuthHeader(options = {}) {
    if (options.useUserToken) {
        if (!options.userToken) {
            throw new Error('User token requested but not provided.');
        }
        return `Bearer ${options.userToken}`;
    }
    const accessToken = await (0, iat_client_js_1.getIATAccessToken)(getBaseUrl());
    return `Bearer ${accessToken}`;
}
async function getAccount(accountId, options = {}) {
    if (!accountId) {
        throw new Error('accountId is required');
    }
    const Authorization = await resolveAuthHeader(options);
    const response = await client.get(`/api/v1/accounts/${encodeURIComponent(accountId)}`, {
        headers: { Authorization }
    });
    return response.data;
}
async function searchOrders(params = {}, options = {}) {
    const Authorization = await resolveAuthHeader(options);
    const response = await client.get('/api/v1/orders', {
        headers: { Authorization },
        params
    });
    return response.data;
}
