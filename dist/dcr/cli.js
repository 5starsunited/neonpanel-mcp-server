#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_process_1 = __importDefault(require("node:process"));
const broker_1 = require("./broker");
const DEFAULT_METADATA = {
    chatgpt: {
        client_name: 'ChatGPT MCP Connector',
        redirect_uris: [
            'https://chat.openai.com/aip/oauth/callback',
            'https://chatgpt.com/aip/oauth/callback',
        ],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: 'read:inventory read:analytics read:companies read:reports read:warehouses read:revenue read:cogs read:landed-cost write:import',
        application_type: 'web',
    },
};
async function main() {
    const { command, alias, flags } = parseArgs(node_process_1.default.argv.slice(2));
    if (command === 'help' || !command) {
        printHelp();
        node_process_1.default.exit(0);
    }
    try {
        switch (command) {
            case 'register':
                await handleRegister(alias, flags);
                break;
            case 'fetch':
                await handleFetch(flags);
                break;
            case 'update':
                await handleUpdate(flags);
                break;
            case 'delete':
                await handleDelete(flags);
                break;
            default:
                printHelp();
                node_process_1.default.exit(1);
        }
    }
    catch (error) {
        logFailure(error);
        node_process_1.default.exit(1);
    }
}
function parseArgs(argv) {
    if (argv.length === 0) {
        return { command: 'help', flags: {} };
    }
    const [commandRaw, alias, ...rest] = argv;
    const command = normalizeCommand(commandRaw);
    const flags = {};
    for (const chunk of rest) {
        if (!chunk.startsWith('--')) {
            continue;
        }
        const [key, value] = chunk.slice(2).split('=');
        if (value === undefined) {
            flags[key] = true;
        }
        else {
            flags[key] = value;
        }
    }
    return { command, alias, flags };
}
function normalizeCommand(value) {
    switch ((value || '').toLowerCase()) {
        case 'register':
        case 'reg':
            return 'register';
        case 'fetch':
        case 'get':
            return 'fetch';
        case 'update':
        case 'put':
            return 'update';
        case 'delete':
        case 'del':
            return 'delete';
        case 'help':
        case '-h':
        case '--help':
            return 'help';
        default:
            return 'help';
    }
}
async function handleRegister(alias, flags) {
    const iat = flags.iat ?? node_process_1.default.env.NEONPANEL_IAT ?? node_process_1.default.env.DCR_IAT;
    if (!iat) {
        throw new Error('Initial Access Token required. Provide with --iat=TOKEN or set NEONPANEL_IAT.');
    }
    const metadata = loadMetadata(alias, flags);
    const baseUrl = typeof flags['base-url'] === 'string' ? flags['base-url'] : node_process_1.default.env.NEONPANEL_DCR_BASE_URL;
    const response = await (0, broker_1.registerClient)({
        metadata,
        initialAccessToken: iat,
        baseUrl,
    });
    writeOutput(response, flags);
}
async function handleFetch(flags) {
    const registrationUri = getOptionalString(flags, 'registration');
    if (!registrationUri) {
        throw new Error('Registration URI required. Provide with --registration=URI.');
    }
    const rat = getOptionalString(flags, 'rat') ?? node_process_1.default.env.NEONPANEL_RAT;
    if (!rat) {
        throw new Error('Registration Access Token required. Provide with --rat=TOKEN or set NEONPANEL_RAT.');
    }
    const response = await (0, broker_1.fetchClient)({
        registrationUri,
        registrationAccessToken: rat,
    });
    writeOutput(response, flags);
}
async function handleUpdate(flags) {
    const registrationUri = getOptionalString(flags, 'registration');
    if (!registrationUri) {
        throw new Error('Registration URI required. Provide with --registration=URI.');
    }
    const rat = getOptionalString(flags, 'rat') ?? node_process_1.default.env.NEONPANEL_RAT;
    if (!rat) {
        throw new Error('Registration Access Token required. Provide with --rat=TOKEN or set NEONPANEL_RAT.');
    }
    const metadata = loadMetadata(undefined, flags);
    const usePatch = flags.patch === true || flags.patch === 'true';
    const response = await (0, broker_1.updateClient)({
        registrationUri,
        registrationAccessToken: rat,
        metadata,
        usePatch,
    });
    writeOutput(response, flags);
}
async function handleDelete(flags) {
    const registrationUri = getOptionalString(flags, 'registration');
    if (!registrationUri) {
        throw new Error('Registration URI required. Provide with --registration=URI.');
    }
    const rat = getOptionalString(flags, 'rat') ?? node_process_1.default.env.NEONPANEL_RAT;
    if (!rat) {
        throw new Error('Registration Access Token required. Provide with --rat=TOKEN or set NEONPANEL_RAT.');
    }
    await (0, broker_1.deleteClient)({
        registrationUri,
        registrationAccessToken: rat,
    });
    console.log('✅ Client deleted');
}
function loadMetadata(alias, flags) {
    const metadataPath = typeof flags.metadata === 'string' ? resolvePath(flags.metadata) : undefined;
    if (metadataPath) {
        const raw = node_fs_1.default.readFileSync(metadataPath, 'utf8');
        return JSON.parse(raw);
    }
    if (alias) {
        const key = alias.toLowerCase();
        if (DEFAULT_METADATA[key]) {
            return cloneMetadata(DEFAULT_METADATA[key]);
        }
    }
    if (DEFAULT_METADATA.chatgpt) {
        return cloneMetadata(DEFAULT_METADATA.chatgpt);
    }
    throw new Error('Client metadata required. Provide --metadata=/path/to/file.json');
}
function cloneMetadata(meta) {
    return JSON.parse(JSON.stringify(meta));
}
function getOptionalString(flags, key) {
    const value = flags[key];
    if (typeof value === 'string' && value.length > 0) {
        return value;
    }
    return undefined;
}
function resolvePath(inputPath) {
    if (node_path_1.default.isAbsolute(inputPath)) {
        return inputPath;
    }
    return node_path_1.default.resolve(__dirname, '..', '..', inputPath);
}
function writeOutput(data, flags) {
    const json = JSON.stringify(data, null, 2);
    console.log(json);
    const outPath = typeof flags.out === 'string' ? flags.out : undefined;
    if (outPath) {
        const resolved = node_path_1.default.resolve(node_process_1.default.cwd(), outPath);
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(resolved), { recursive: true });
        node_fs_1.default.writeFileSync(resolved, json, { encoding: 'utf8', mode: 0o600 });
        console.log(`
Saved to ${resolved}`);
    }
}
function logFailure(error) {
    if (error instanceof Error) {
        console.error(`❌ ${error.message}`);
        if (node_process_1.default.env.DEBUG === '1' && error.stack) {
            console.error(error.stack);
        }
        return;
    }
    console.error(`❌ ${String(error)}`);
}
function printHelp() {
    console.log(`NeonPanel DCR Broker CLI

Usage:
  dcr register [alias] --iat=TOKEN [--metadata=path] [--out=file]
  dcr fetch --registration=URI --rat=TOKEN [--out=file]
  dcr update --registration=URI --rat=TOKEN [--metadata=path]
  dcr delete --registration=URI --rat=TOKEN

Environment variables:
  NEONPANEL_IAT          Default Initial Access Token
  NEONPANEL_RAT          Default Registration Access Token
  NEONPANEL_DCR_BASE_URL Override base DCR URL (default ${broker_1.DEFAULT_DCR_BASE_URL})

Flags:
  --iat=TOKEN            Initial Access Token for registration
  --rat=TOKEN            Registration Access Token
  --registration=URI     Registration URI (usually from registration response)
  --metadata=PATH        Client metadata JSON
  --out=PATH             Save response JSON to file
  --patch                Use HTTP PATCH for update instead of PUT
  --base-url=URL         Override DCR base URL for register command
`);
}
main().catch((error) => {
    logFailure(error);
    node_process_1.default.exit(1);
});
