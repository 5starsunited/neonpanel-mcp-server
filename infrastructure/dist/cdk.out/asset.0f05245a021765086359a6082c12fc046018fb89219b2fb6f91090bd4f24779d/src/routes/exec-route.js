"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerExecRoute = registerExecRoute;
const axios_1 = __importDefault(require("axios"));
const zod_1 = require("zod");
const dynamic_capabilities_1 = require("../dynamic-capabilities");
const token_validator_js_1 = require("../auth/token-validator.js");
const ExecSchema = zod_1.z.object({
    action: zod_1.z.string().min(1),
    args: zod_1.z.record(zod_1.z.any()).default({})
});
function findActionInCapabilities(capabilities, actionId) {
    for (const capability of capabilities) {
        const action = capability.actions.find((a) => a.action_id === actionId);
        if (action) {
            return action;
        }
    }
    return null;
}
function getAvailableActions(capabilities) {
    const actions = [];
    for (const capability of capabilities) {
        for (const action of capability.actions) {
            actions.push(action.action_id);
        }
    }
    return actions;
}
function buildApiUrl(actionInfo, args) {
    let path = actionInfo.path;
    for (const param of actionInfo.parameters || []) {
        if (param.in === 'path' && args[param.name] !== undefined) {
            path = path.replace(`{${param.name}}`, encodeURIComponent(String(args[param.name])));
        }
    }
    const queryParams = new URLSearchParams();
    for (const param of actionInfo.parameters || []) {
        if (param.in === 'query' && args[param.name] !== undefined) {
            const value = args[param.name];
            if (Array.isArray(value)) {
                value.forEach(v => queryParams.append(`${param.name}[]`, String(v)));
            }
            else {
                queryParams.append(param.name, String(value));
            }
        }
    }
    const queryString = queryParams.toString();
    return queryString ? `${path}?${queryString}` : path;
}
async function neonpanelGet(path, token, baseUrl) {
    const url = `${baseUrl}${path}`;
    const res = await axios_1.default.get(url, { headers: { Authorization: token, Accept: 'application/json' } });
    return res.data;
}
function registerExecRoute(router, options) {
    router.all('/exec', (req, res, next) => {
        if (req.method === 'POST') {
            return next();
        }
        res.setHeader('Allow', 'POST');
        if (req.method === 'OPTIONS') {
            return res.status(204).end();
        }
        options.attachAuthChallenge(res, req);
        return res.status(405).json({
            ok: false,
            message: 'Method not allowed. Use POST /exec with a Bearer token.'
        });
    });
    router.post('/exec', async (req, res) => {
        try {
            const authHeader = req.headers['authorization'];
            const bearerHeader = typeof authHeader === 'string' ? authHeader : Array.isArray(authHeader) ? authHeader[0] : undefined;
            if (!bearerHeader) {
                options.attachAuthChallenge(res, req, { error: 'invalid_token' });
                return res.status(401).json({ ok: false, message: 'Missing Authorization bearer token', error: 'invalid_token' });
            }
            const tokenMatch = bearerHeader.match(/^Bearer\s+(.+)$/i);
            if (!tokenMatch) {
                options.attachAuthChallenge(res, req, { error: 'invalid_token' });
                return res.status(401).json({ ok: false, message: 'Unsupported authorization header format.', error: 'invalid_token' });
            }
            const rawToken = tokenMatch[1];
            let validation;
            try {
                validation = await (0, token_validator_js_1.validateAccessToken)(rawToken);
            }
            catch (error) {
                const description = (0, token_validator_js_1.isTokenValidationError)(error)
                    ? error.message
                    : 'Failed to validate access token.';
                options.attachAuthChallenge(res, req, { error: 'invalid_token' });
                return res.status(401).json({ ok: false, message: description, error: 'invalid_token' });
            }
            const { action, args } = ExecSchema.parse(req.body || {});
            const capabilities = await (0, dynamic_capabilities_1.getFreshCapabilities)();
            const actionInfo = findActionInCapabilities(capabilities, action);
            if (!actionInfo) {
                return res.status(400).json({
                    ok: false,
                    message: `Unknown or unsupported action '${action}'`,
                    available_actions: getAvailableActions(capabilities)
                });
            }
            const apiUrl = buildApiUrl(actionInfo, args);
            const data = await neonpanelGet(apiUrl, `Bearer ${rawToken}`, options.neonpanelBaseUrl);
            res.json({
                ok: true,
                data,
                action: actionInfo.action_id,
                method: actionInfo.method,
                path: actionInfo.path,
                token_subject: validation.subject,
                token_scopes: validation.scopes,
            });
        }
        catch (error) {
            const status = error?.response?.status || 500;
            const message = error?.response?.data || error?.message || 'Internal error';
            if (status === 401) {
                options.attachAuthChallenge(res, req, { error: 'invalid_token' });
            }
            res.status(status).json({ ok: false, message, action: req.body?.action });
        }
    });
}
