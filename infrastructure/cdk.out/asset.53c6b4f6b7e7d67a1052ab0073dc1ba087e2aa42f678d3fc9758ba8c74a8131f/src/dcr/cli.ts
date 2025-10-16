#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  ClientMetadata,
  DEFAULT_DCR_BASE_URL,
  deleteClient,
  fetchClient,
  registerClient,
  updateClient,
} from './broker';

type Command = 'register' | 'fetch' | 'update' | 'delete' | 'help';

interface ParsedArgs {
  command: Command;
  alias?: string;
  flags: Record<string, string | boolean>;
}

interface DefaultMetadataMap {
  [alias: string]: ClientMetadata;
}

// Default profile for the ChatGPT MCP connector so the happy path requires no extra JSON.
const DEFAULT_METADATA: DefaultMetadataMap = {
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

async function main(): Promise<void> {
  const { command, alias, flags } = parseArgs(process.argv.slice(2));

  if (command === 'help' || !command) {
    printHelp();
    process.exit(0);
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
        process.exit(1);
    }
  } catch (error) {
    logFailure(error);
    process.exit(1);
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0) {
    return { command: 'help', flags: {} };
  }

  const [commandRaw, alias, ...rest] = argv;
  const command = normalizeCommand(commandRaw);
  const flags: Record<string, string | boolean> = {};

  for (const chunk of rest) {
    if (!chunk.startsWith('--')) {
      continue;
    }

    const [key, value] = chunk.slice(2).split('=');
    if (value === undefined) {
      flags[key] = true;
    } else {
      flags[key] = value;
    }
  }

  return { command, alias, flags };
}

function normalizeCommand(value: string | undefined): Command {
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

async function handleRegister(alias: string | undefined, flags: Record<string, string | boolean>): Promise<void> {
  const iat = (flags.iat as string | undefined) ?? process.env.NEONPANEL_IAT ?? process.env.DCR_IAT;
  if (!iat) {
    throw new Error('Initial Access Token required. Provide with --iat=TOKEN or set NEONPANEL_IAT.');
  }

  const metadata = loadMetadata(alias, flags);
  const baseUrl = typeof flags['base-url'] === 'string' ? flags['base-url'] : process.env.NEONPANEL_DCR_BASE_URL;

  const response = await registerClient({
    metadata,
    initialAccessToken: iat,
    baseUrl,
  });

  writeOutput(response, flags);
}

async function handleFetch(flags: Record<string, string | boolean>): Promise<void> {
  const registrationUri = getOptionalString(flags, 'registration');
  if (!registrationUri) {
    throw new Error('Registration URI required. Provide with --registration=URI.');
  }

  const rat = getOptionalString(flags, 'rat') ?? process.env.NEONPANEL_RAT;
  if (!rat) {
    throw new Error('Registration Access Token required. Provide with --rat=TOKEN or set NEONPANEL_RAT.');
  }

  const response = await fetchClient({
    registrationUri,
    registrationAccessToken: rat,
  });

  writeOutput(response, flags);
}

async function handleUpdate(flags: Record<string, string | boolean>): Promise<void> {
  const registrationUri = getOptionalString(flags, 'registration');
  if (!registrationUri) {
    throw new Error('Registration URI required. Provide with --registration=URI.');
  }

  const rat = getOptionalString(flags, 'rat') ?? process.env.NEONPANEL_RAT;
  if (!rat) {
    throw new Error('Registration Access Token required. Provide with --rat=TOKEN or set NEONPANEL_RAT.');
  }

  const metadata = loadMetadata(undefined, flags);
  const usePatch = flags.patch === true || flags.patch === 'true';

  const response = await updateClient({
    registrationUri,
    registrationAccessToken: rat,
    metadata,
    usePatch,
  });

  writeOutput(response, flags);
}

async function handleDelete(flags: Record<string, string | boolean>): Promise<void> {
  const registrationUri = getOptionalString(flags, 'registration');
  if (!registrationUri) {
    throw new Error('Registration URI required. Provide with --registration=URI.');
  }

  const rat = getOptionalString(flags, 'rat') ?? process.env.NEONPANEL_RAT;
  if (!rat) {
    throw new Error('Registration Access Token required. Provide with --rat=TOKEN or set NEONPANEL_RAT.');
  }

  await deleteClient({
    registrationUri,
    registrationAccessToken: rat,
  });

  console.log('✅ Client deleted');
}

function loadMetadata(alias: string | undefined, flags: Record<string, string | boolean>): ClientMetadata {
  const metadataPath = typeof flags.metadata === 'string' ? resolvePath(flags.metadata) : undefined;
  if (metadataPath) {
    const raw = fs.readFileSync(metadataPath, 'utf8');
    return JSON.parse(raw) as ClientMetadata;
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

function cloneMetadata(meta: ClientMetadata): ClientMetadata {
  return JSON.parse(JSON.stringify(meta)) as ClientMetadata;
}

function getOptionalString(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = flags[key];
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return undefined;
}

function resolvePath(inputPath: string): string {
  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }
  return path.resolve(__dirname, '..', '..', inputPath);
}

function writeOutput(data: unknown, flags: Record<string, string | boolean>): void {
  const json = JSON.stringify(data, null, 2);
  console.log(json);

  const outPath = typeof flags.out === 'string' ? flags.out : undefined;
  if (outPath) {
    const resolved = path.resolve(process.cwd(), outPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, json, { encoding: 'utf8', mode: 0o600 });
    console.log(`
Saved to ${resolved}`);
  }
}

function logFailure(error: unknown): void {
  if (error instanceof Error) {
    console.error(`❌ ${error.message}`);
    if (process.env.DEBUG === '1' && error.stack) {
      console.error(error.stack);
    }
    return;
  }

  console.error(`❌ ${String(error)}`);
}

function printHelp(): void {
  console.log(`NeonPanel DCR Broker CLI

Usage:
  dcr register [alias] --iat=TOKEN [--metadata=path] [--out=file]
  dcr fetch --registration=URI --rat=TOKEN [--out=file]
  dcr update --registration=URI --rat=TOKEN [--metadata=path]
  dcr delete --registration=URI --rat=TOKEN

Environment variables:
  NEONPANEL_IAT          Default Initial Access Token
  NEONPANEL_RAT          Default Registration Access Token
  NEONPANEL_DCR_BASE_URL Override base DCR URL (default ${DEFAULT_DCR_BASE_URL})

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
  process.exit(1);
});