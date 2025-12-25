import { z } from 'zod';

const RawConfigSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  BUILD_VERSION: z.string().default('dev'),
  MCP_PROTOCOL_VERSION: z.string().default('2025-03-26'),
  LOG_LEVEL: z.string().default('info'),
  SSE_HEARTBEAT_MS: z.coerce.number().int().min(1000).default(15000),
  SSE_MAX_CONNECTIONS: z.coerce.number().int().min(1).default(1000),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(10000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  ENABLE_STREAMABLE_TRANSPORT: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  NEONPANEL_OAUTH_ISSUER: z.string().default('https://my.neonpanel.com'),
  NEONPANEL_OAUTH_JWKS_URI: z
    .string()
    .default('https://my.neonpanel.com/.well-known/jwks.json'),
  NEONPANEL_OAUTH_EXPECTED_AUDIENCE: z.string().default('mcp://neonpanel'),
  NEONPANEL_OAUTH_REQUIRED_SCOPES: z
    .string()
    .optional()
    .transform((value) => {
      if (!value || value.trim().length === 0) {
        return []; // No required scopes by default - accept any valid token from trusted issuer
      }
      return value
        .split(/[,\s]+/)
        .map((scope) => scope.trim())
        .filter(Boolean);
    }),
  NEONPANEL_API_BASE: z.string().default('https://api.neonpanel.com'),
  NEONPANEL_OPENAPI_URL: z.string().default('https://my.neonpanel.com/api/v1/scheme/3.1.0'),
  OPENAPI_CACHE_TTL_MS: z.coerce.number().int().positive().default(10 * 60 * 1000),

  // Athena (optional; required only for Athena-backed tools)
  ATHENA_REGION: z.string().optional(),
  ATHENA_WORKGROUP: z.string().default('primary'),
  ATHENA_OUTPUT_LOCATION: z.string().optional(),
  ATHENA_CATALOG: z.string().default('awsdatacatalog'),
  ATHENA_DATABASE: z.string().default('inventory_planning'),
  ATHENA_TABLE_FBA_REPLENISHMENT: z.string().default('fba_replenishment'),
  ATHENA_ASSUME_ROLE_ARN: z.string().optional(),
  ATHENA_ASSUME_ROLE_SESSION_NAME: z.string().default('neonpanel-mcp-athena'),
});

export type AppConfig = ReturnType<typeof buildConfig>;

function buildConfig() {
  const parsed = RawConfigSchema.parse(process.env);

  return {
    env: parsed.NODE_ENV,
    port: parsed.PORT,
    buildVersion: parsed.BUILD_VERSION,
    mcp: {
      serverName: 'neonpanel-mcp',
      protocolVersion: parsed.MCP_PROTOCOL_VERSION,
    },
    logging: {
      level: parsed.LOG_LEVEL,
    },
    http: {
      requestTimeoutMs: parsed.REQUEST_TIMEOUT_MS,
    },
    sse: {
      heartbeatMs: parsed.SSE_HEARTBEAT_MS,
      maxConnections: parsed.SSE_MAX_CONNECTIONS,
    },
    rateLimit: {
      windowMs: parsed.RATE_LIMIT_WINDOW_MS,
      max: parsed.RATE_LIMIT_MAX,
    },
    neonpanel: {
      issuer: sanitizeUrl(parsed.NEONPANEL_OAUTH_ISSUER),
      jwksUri: parsed.NEONPANEL_OAUTH_JWKS_URI,
      expectedAudience: parsed.NEONPANEL_OAUTH_EXPECTED_AUDIENCE,
      requiredScopes: parsed.NEONPANEL_OAUTH_REQUIRED_SCOPES,
      apiBaseUrl: sanitizeUrl(parsed.NEONPANEL_API_BASE),
      openApiUrl: parsed.NEONPANEL_OPENAPI_URL,
    },
    features: {
      enableStreamableTransport: parsed.ENABLE_STREAMABLE_TRANSPORT,
    },
    openApi: {
      cacheTtlMs: parsed.OPENAPI_CACHE_TTL_MS,
      localPath: 'openapi.json',
    },
    athena: {
      region: parsed.ATHENA_REGION,
      workgroup: parsed.ATHENA_WORKGROUP,
      outputLocation: parsed.ATHENA_OUTPUT_LOCATION,
      catalog: parsed.ATHENA_CATALOG,
      database: parsed.ATHENA_DATABASE,
      tables: {
        fbaReplenishment: parsed.ATHENA_TABLE_FBA_REPLENISHMENT,
      },
      assumeRoleArn: parsed.ATHENA_ASSUME_ROLE_ARN,
      assumeRoleSessionName: parsed.ATHENA_ASSUME_ROLE_SESSION_NAME,
    },
  } as const;
}

function sanitizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export const config = buildConfig();

export type NeatRequiredScopes = string[];
