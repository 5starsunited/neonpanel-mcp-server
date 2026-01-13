import express from 'express';
import cors from 'cors';
import type { Application, Request, Response, NextFunction } from 'express';
import type { JwtPayload } from 'jsonwebtoken';
import { config } from '../config';
import { correlationIdMiddleware } from '../middleware/correlation-id';
import { requestLogger } from '../middleware/request-logger';
import { requireBearer, AuthenticatedRequest, type AuthContext } from '../middleware/authentication';
import { rateLimit } from '../middleware/rate-limit';
import { errorHandler } from '../middleware/error-handler';
import { logger } from '../logging/logger';
import { RpcDispatcher } from '../mcp/rpc/dispatcher';
import type { JsonRpcResponse, RpcContext } from '../mcp/rpc/types';
import { SseSessionManager } from '../mcp/transport/sse';
import { SessionRegistry } from '../mcp/session-registry';
import type { OpenApiService } from '../lib/openapi-service';
import { checkJwks } from '../lib/health';
import { AppError } from '../lib/errors';
import type { ToolListEntry } from '../tools/types';
import { validateAccessToken, TokenValidationError } from '../auth/token-validator';

export interface AppDependencies {
  dispatcher: RpcDispatcher;
  sseManager: SseSessionManager;
  sessionRegistry: SessionRegistry;
  openApiService: OpenApiService;
}

function createPublicRpcContext(): AuthContext {
  const payload: JwtPayload = {};
  return {
    token: '',
    scopes: [],
    subject: undefined,
    payload,
    validatedToken: {
      token: '',
      payload,
      scopes: [],
      subject: undefined,
    },
  };
}

// Keep OAuth scope advertisement consistent across discovery surfaces.
// Some ChatGPT connector flows validate requested scopes against RFC 8414 metadata.
const DEFAULT_MCP_SCOPE = 'neonpanel.mcp';

function getAdvertisedOauthScopes(): string[] {
  const configured = config.neonpanel.requiredScopes;
  if (Array.isArray(configured) && configured.length > 0) {
    return configured;
  }
  return [DEFAULT_MCP_SCOPE];
}

function buildAbsoluteUrl(req: Request, path: string) {
  const forwardedProto = req.get('x-forwarded-proto');
  const protocol = forwardedProto ? forwardedProto.split(',')[0].trim() : req.protocol;
  const forwardedHost = req.get('x-forwarded-host');
  const host = (forwardedHost ? forwardedHost.split(',')[0].trim() : null) ?? req.get('host') ?? 'localhost';
  const base = `${protocol}://${host}`;
  return path ? `${base}${path}` : base;
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/"/g, "'");
}

function buildWwwAuthenticateChallenge(req: Request, options?: { error?: string; errorDescription?: string }): string {
  const parts: string[] = [];

  parts.push(`realm="${config.mcp.serverName}"`);
  parts.push(`resource="${buildAbsoluteUrl(req, '')}"`);
  parts.push(`resource_metadata="${sanitizeHeaderValue(buildAbsoluteUrl(req, '/.well-known/oauth-protected-resource'))}"`);

  const scopes = getAdvertisedOauthScopes().join(' ');
  if (scopes.trim().length > 0) {
    parts.push(`scope="${sanitizeHeaderValue(scopes)}"`);
  }

  if (options?.error) {
    parts.push(`error="${sanitizeHeaderValue(options.error)}"`);
  }
  if (options?.errorDescription) {
    parts.push(`error_description="${sanitizeHeaderValue(options.errorDescription)}"`);
  }

  return `Bearer ${parts.join(', ')}`;
}

function buildAuthRequiredJsonRpcErrorResponse(
  req: Request,
  message: string,
  details?: { error?: string; errorDescription?: string },
): JsonRpcResponse {
  const challenge = buildWwwAuthenticateChallenge(req, {
    error: details?.error ?? 'invalid_token',
    errorDescription: details?.errorDescription ?? message,
  });

  return {
    jsonrpc: '2.0',
    id: (req.body?.id ?? null) as any,
    error: {
      // JSON-RPC error code is app-defined here. We keep it distinct from MCP/HTTP status.
      code: 401,
      message,
      data: {
        _meta: {
          'mcp/www_authenticate': [challenge],
        },
      },
    },
  };
}

function buildServerMetadata() {
  const oauthIssuer = config.neonpanel.issuer;
  const oauthBase = oauthIssuer.replace(/\/$/, '');
  return {
    name: config.mcp.serverName,
    version: config.buildVersion,
    protocol: config.mcp.protocolVersion,
    description: 'NeonPanel MCP Server - Access NeonPanel APIs via Model Context Protocol',
    endpoints: {
      health: '/healthz',
      oauth_discovery: '/.well-known/oauth-authorization-server',
      mcp_config: '/.well-known/mcp-config',
      openapi_json: '/openapi.json',
      openapi_yaml: '/openapi.yaml',
      sse: '/sse',
      messages: '/messages',
      mcp: '/mcp',
      mcp_capabilities: '/mcp/capabilities',
      mcp_tools_call: '/mcp/tools/call',
    },
    oauth: {
      issuer: oauthIssuer,
      authorization_endpoint: `${oauthBase}/oauth2/authorize`,
      token_endpoint: `${oauthBase}/oauth2/token`,
      registration_endpoint: `${oauthBase}/oauth2/register`,
      required: true,
    },
    documentation: 'https://github.com/5starsunited/neonpanel-mcp-server',
  } as const;
}

async function invokePublicRpc<T>(dispatcher: RpcDispatcher, method: string, params?: unknown): Promise<T> {
  const response = await dispatcher.handle(
    {
      jsonrpc: '2.0',
      id: `http:${method}`,
      method,
      params,
    },
    createPublicRpcContext(),
  );

  if ('error' in response) {
    throw new AppError(`Failed to call public RPC method: ${method}`, {
      status: 502,
      code: 'rpc_error',
      details: response.error,
    });
  }

  return response.result as T;
}

function extractSessionId(req: Request) {
  const query = req.query as Record<string, unknown> | undefined;
  const tryCoerce = (value: unknown): string | undefined => {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string' && entry.trim().length > 0) {
          return entry.trim();
        }
      }
    }
    return undefined;
  };

  const fromQuery = query ? tryCoerce(query['sessionId'] ?? query['session_id']) : undefined;
  if (fromQuery) {
    return fromQuery;
  }

  const fromHeader = req.get('x-mcp-session-id');
  if (typeof fromHeader === 'string' && fromHeader.trim().length > 0) {
    return fromHeader.trim();
  }

  return undefined;
}

export function createApp(deps: AppDependencies): Application {
  const app = express();
  app.disable('x-powered-by');

  app.use(cors());
  app.use(correlationIdMiddleware);
  app.use(requestLogger as any);
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  // Root endpoint - MCP server info
  app.get('/', (_req, res) => {
    res.json(buildServerMetadata());
  });

  // Dedicated MCP discovery endpoint for clients like ChatGPT Workspace
  app.get('/mcp', (_req, res) => {
    res.json(buildServerMetadata());
  });

  // Smithery session configuration schema (JSON Schema Draft 07)
  // External MCPs can expose this endpoint to enable a configuration UI.
  // This server uses OAuth, so no per-session API keys are required; we keep the schema empty.
  app.get('/.well-known/mcp-config', (req, res) => {
    res.json({
      $schema: 'http://json-schema.org/draft-07/schema#',
      $id: buildAbsoluteUrl(req, '/.well-known/mcp-config'),
      title: 'NeonPanel MCP Session Configuration',
      description: 'Optional configuration for connecting to the NeonPanel MCP server. OAuth authentication is used; no API keys are required.',
      'x-query-style': 'dot+bracket',
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    });
  });

  app.get('/.well-known/ai-plugin.json', (req, res) => {
    const oauthIssuer = config.neonpanel.issuer.replace(/\/$/, '');
    res.json({
      schema_version: 'v1',
      name_for_human: 'NeonPanel MCP',
      name_for_model: 'neonpanel_mcp',
      description_for_human: 'Securely access NeonPanel inventory, revenue, warehouse, and import tooling via Model Context Protocol.',
      description_for_model:
        'Use NeonPanel MCP tools to list companies, warehouses, inventory items, revenue & COGS analytics, and submit import documents on behalf of the authenticated user.',
      auth: {
        type: 'oauth',
        client_url: 'https://chat.openai.com/aip/plugin-setup',
        scope: getAdvertisedOauthScopes().join(' '),
        authorization_url: `${oauthIssuer}/oauth2/authorize`,
        token_url: `${oauthIssuer}/oauth2/token`,
        authorization_content_type: 'application/x-www-form-urlencoded',
      },
      api: {
        type: 'openapi',
        url: buildAbsoluteUrl(req, '/openapi.yaml'),
        has_user_authentication: true,
      },
      logo_url: 'https://neonpanel.com/favicon.ico',
      contact_email: 'support@neonpanel.com',
      legal_info_url: 'https://neonpanel.com/legal',
    });
  });

  app.get('/mcp/capabilities', async (_req, res, next) => {
    try {
      const result = await invokePublicRpc<{ tools: ToolListEntry[] }>(deps.dispatcher, 'tools/list');
      const capabilities = result.tools.map((tool) => ({
        capability_name: tool.name,
        description: tool.description,
        // Visibility/safety hints for ChatGPT connectors.
        // We pass through several common fields to maximize compatibility.
        is_consequential: tool.is_consequential,
        isConsequential: tool.isConsequential,
        'x-openai-isConsequential': tool['x-openai-isConsequential'],
        annotations: tool.annotations,
        input_schema: tool.inputSchema,
        output_schema: tool.outputSchema,
        examples: tool.examples ?? [],
      }));

      res.json({
        total: capabilities.length,
        capabilities,
      });
    } catch (error) {
      next(error);
    }
  });

  const handleHealthRequest = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deepCheck = req.query.deep === '1' || req.query.deep === 'true';
      const summary = await deps.openApiService.getStatus({ includeCache: true, pingRemote: deepCheck });
      const jwks = deepCheck ? await checkJwks() : undefined;
      res.json({
        status: 'ok',
        service: config.mcp.serverName,
        version: config.buildVersion,
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
        openapi: summary,
        jwks,
        sse: {
          activeConnections: deps.sseManager.getActiveConnectionCount(),
        },
      });
    } catch (error) {
      next(error);
    }
  };

  app.get('/healthz', handleHealthRequest);
  app.get('/health', handleHealthRequest);

  // OAuth 2.0 Authorization Server Metadata (RFC 8414)
  // Proxies to my.neonpanel.com OAuth server which supports dynamic callback URLs
  app.get('/.well-known/oauth-authorization-server', (_req, res) => {
    const scopesSupported = getAdvertisedOauthScopes();
    const issuer = config.neonpanel.issuer;
    const oauthBase = issuer.replace(/\/$/, '');
    res.json({
      issuer,
      authorization_endpoint: `${oauthBase}/oauth2/authorize`,
      registration_endpoint: `${oauthBase}/oauth2/register`,
      token_endpoint: `${oauthBase}/oauth2/token`,
      jwks_uri: config.neonpanel.jwksUri,
      scopes_supported: scopesSupported,
      response_types_supported: ["code"],
      // ChatGPT connectors use public clients with PKCE.
      // Advertising only "none" avoids the connector attempting confidential-client auth modes.
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
    });
  });

  app.get('/.well-known/oauth-protected-resource', (req, res) => {
    const resource = buildAbsoluteUrl(req, '');
    const scopesSupported = getAdvertisedOauthScopes();
    res.json({
      resource,
      authorization_servers: [config.neonpanel.issuer],
      bearer_methods_supported: ['header'],
      scopes_supported: scopesSupported,
    });
  });

  app.get('/openapi.json', async (_req, res, next) => {
    try {
      const document = await deps.openApiService.getDocument();
      res.json(document);
    } catch (error) {
      next(error);
    }
  });

  app.get('/openapi.yaml', async (_req, res, next) => {
    try {
      const yaml = await deps.openApiService.getDocumentAsYaml();
      res.type('text/yaml').send(yaml);
    } catch (error) {
      next(error);
    }
  });

  // ChatGPT and some clients may probe /sse with non-GET methods.
  // We intentionally keep the response shape as SSE to avoid Content-Type mismatches
  // and avoid hard-failing the connector refresh on 4xx statuses.
  app.all('/sse', (req: Request, res: Response) => {
    // ChatGPT expects the SSE endpoint to always speak event-stream.
    // If auth is missing/invalid, returning JSON causes action refresh to fail with:
    // "Expected Content-Type to contain text/event-stream".
    const setSseHeaders = () => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
    };

    // Set SSE headers immediately so unexpected exceptions don't fall through
    // to the JSON error handler with a Content-Type mismatch.
    setSseHeaders();

    const writeSseErrorAndEnd = (payload: Record<string, unknown>) => {
      setSseHeaders();
      // Return 200 so connector refresh doesn't hard-fail on HTTP status.
      res.status(200);
      if (typeof res.write === 'function') {
        res.write('event: error\n');
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      }
      res.end();
    };

    const method = (req.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'POST') {
      writeSseErrorAndEnd({
        status: 405,
        code: 'method_not_allowed',
        message: 'SSE endpoint only supports GET/POST.',
      });
      return;
    }

    const rawAuth = req.get('authorization') ?? req.get('Authorization');
    const match = typeof rawAuth === 'string' ? rawAuth.match(/^Bearer\s+(.+)$/i) : null;
    const bearer = match ? match[1] : null;

    const openSession = (authContext: AuthContext) => {
      try {
        const session = deps.sseManager.connect(res);

        if (typeof res.flushHeaders === 'function') {
          res.flushHeaders();
        }

        deps.sessionRegistry.register(session, authContext);
        logger.info(
          {
            sessionId: session.id,
            subject: authContext.subject,
            scopes: authContext.scopes,
            authenticated: Boolean(authContext.token),
          },
          'SSE connection opened',
        );

        res.on('close', () => {
          deps.sessionRegistry.unregister(session.id);
          logger.info({ sessionId: session.id }, 'SSE connection closed');
        });
      } catch (error) {
        logger.warn({ err: error }, 'Failed to establish SSE session');
        writeSseErrorAndEnd({
          status: 503,
          code: 'sse_unavailable',
          message: 'Failed to establish SSE session.',
        });
      }
    };

    // Do NOT require auth to establish SSE. If a bearer token is present, we validate it
    // to associate the SSE session with the authenticated subject; otherwise we treat it as public.
    if (!bearer || bearer.trim().length === 0) {
      openSession(createPublicRpcContext());
      return;
    }

    validateAccessToken(bearer)
      .then((validated) => {
        (req as AuthenticatedRequest).authContext = {
          token: validated.token,
          scopes: validated.scopes,
          subject: validated.subject,
          payload: validated.payload,
          validatedToken: validated,
        };
        openSession((req as AuthenticatedRequest).authContext ?? createPublicRpcContext());
      })
      .catch((error) => {
        if (error instanceof TokenValidationError) {
          logger.warn({ err: error }, 'Invalid bearer token provided for SSE; opening unauthenticated session');
          openSession(createPublicRpcContext());
          return;
        }
        logger.error({ err: error }, 'Unexpected error during access token validation (SSE); opening unauthenticated session');
        openSession(createPublicRpcContext());
      });
  });

  // Streamable HTTP MCP endpoint (JSON-RPC over HTTP)
  // Discovery methods are public; tool execution requires OAuth.
  app.post('/mcp', rateLimit(), async (req, res, next) => {
    const rpcMethod = req.body?.method;
    const publicMethods = ['initialize', 'initialized', 'tools/list'];
    const authorizationHeader = req.get('authorization');
    const normalizedAuth = typeof authorizationHeader === 'string' ? authorizationHeader.trim() : '';
    const hasUsableBearerToken = /^Bearer\s+\S+/i.test(normalizedAuth);
    const isPublicMethod = publicMethods.includes(rpcMethod);
    const handleAsPublic = isPublicMethod && !hasUsableBearerToken;
    const sessionId = extractSessionId(req);

    logger.info(
      {
        rpcMethod,
        path: req.path,
        sessionId,
        authenticated: !handleAsPublic,
      },
      'MCP JSON-RPC request received',
    );

    const sendRpcResult = (response: JsonRpcResponse, authContext?: AuthenticatedRequest['authContext']) => {
      if (sessionId) {
        const record = deps.sessionRegistry.getBySessionId(sessionId);
        if (record) {
          deps.sseManager.send(record.session.id, {
            data: response,
          });
          logger.debug({ rpcMethod, sessionId }, 'Delivered RPC result via explicit sessionId');
          return;
        }
        logger.warn({ sessionId }, 'Received RPC request with unknown sessionId');
      }

      if (authContext) {
        const sessions = deps.sessionRegistry.findMatchingSessions(authContext);
        for (const record of sessions) {
          deps.sseManager.send(record.session.id, {
            data: response,
          });
        }
      }
    };

    if (handleAsPublic) {
      try {
        logger.info({ rpcMethod, authenticated: false }, 'Handling public MCP JSON-RPC request');
        const response = await deps.dispatcher.handle(req.body, createPublicRpcContext());
        sendRpcResult(response);
        res.json(response);
      } catch (error) {
        next(error);
      }
      return;
    }

    if (rpcMethod === 'tools/call') {
      const rawAuth = req.get('authorization') ?? req.get('Authorization');
      const match = typeof rawAuth === 'string' ? rawAuth.match(/^Bearer\s+(.+)$/i) : null;
      const bearer = match ? match[1] : null;

      if (!bearer || bearer.trim().length === 0) {
        const challenge = buildWwwAuthenticateChallenge(req, {
          error: 'invalid_token',
          errorDescription: 'No access token provided.',
        });
        res.setHeader('WWW-Authenticate', challenge);
        const response = buildAuthRequiredJsonRpcErrorResponse(req, 'Authentication required: no access token provided.');
        sendRpcResult(response);
        res.status(401).json(response);
        return;
      }

      try {
        const validated = await validateAccessToken(bearer);
        const authContext: AuthenticatedRequest['authContext'] = {
          token: validated.token,
          scopes: validated.scopes,
          subject: validated.subject,
          payload: validated.payload,
          validatedToken: validated,
        };

        const response = await deps.dispatcher.handle(req.body, {
          token: authContext.token,
          scopes: authContext.scopes,
          subject: authContext.subject,
          payload: authContext.payload,
          validatedToken: authContext.validatedToken,
        });

        sendRpcResult(response, authContext);
        res.json(response);
      } catch (error) {
        if (error instanceof TokenValidationError) {
          const challenge = buildWwwAuthenticateChallenge(req, {
            error: error.code,
            errorDescription: error.message,
          });
          res.setHeader('WWW-Authenticate', challenge);
          const response = buildAuthRequiredJsonRpcErrorResponse(req, `Authentication required: ${error.message}`, {
            error: error.code,
            errorDescription: error.message,
          });
          sendRpcResult(response);
          res.status(401).json(response);
          return;
        }
        next(error);
      }
      return;
    }

    return requireBearer(req, res, async () => {
      const authContext = (req as AuthenticatedRequest).authContext;
      if (!authContext) {
        res.status(500).json({ status: 500, message: 'Authentication context missing.' });
        return;
      }

      try {
        logger.info(
          {
            rpcMethod,
            authenticated: true,
            subject: authContext.subject,
          },
          'Handling authenticated MCP JSON-RPC request',
        );

        const response = await deps.dispatcher.handle(req.body, {
          token: authContext.token,
          scopes: authContext.scopes,
          subject: authContext.subject,
          payload: authContext.payload,
          validatedToken: authContext.validatedToken,
        });

        sendRpcResult(response, authContext);
        res.json(response);
      } catch (error) {
        next(error);
      }
    });
  });

  // GET /messages - return 405 Method Not Allowed
  app.get('/messages', (_req, res) => {
    res.status(405).json({
      status: 405,
      code: 'method_not_allowed',
      message: 'Only POST method is allowed for /messages endpoint.',
    });
  });

  app.post('/messages', rateLimit(), async (req, res, next) => {
    const method = req.body?.method;
    const publicMethods = ['initialize', 'initialized', 'tools/list'];
    const authorizationHeader = req.get('authorization');
    const normalizedAuth = typeof authorizationHeader === 'string' ? authorizationHeader.trim() : '';
    // Some clients (including ChatGPT during setup/refresh) may send an Authorization header
    // that is empty or doesn't include a usable bearer token. Treat discovery methods as public
    // unless a non-empty Bearer token is present.
    const hasUsableBearerToken = /^Bearer\s+\S+/i.test(normalizedAuth);
    const isPublicMethod = publicMethods.includes(method);
    const handleAsPublic = isPublicMethod && !hasUsableBearerToken;
    const sessionId = extractSessionId(req);

    const sendRpcResult = (response: JsonRpcResponse, authContext?: AuthenticatedRequest['authContext']) => {
      if (sessionId) {
        const record = deps.sessionRegistry.getBySessionId(sessionId);
        if (record) {
          deps.sseManager.send(record.session.id, {
            data: response,
          });
          logger.debug({ method, sessionId }, 'Delivered RPC result via explicit sessionId');
          return;
        }
        logger.warn({ sessionId }, 'Received RPC request with unknown sessionId');
      }

      if (authContext) {
        const sessions = deps.sessionRegistry.findMatchingSessions(authContext);
        if (sessions.length === 0) {
          logger.warn({ subject: authContext.subject }, 'No active SSE sessions matched authenticated request');
        }
        for (const record of sessions) {
          deps.sseManager.send(record.session.id, {
            data: response,
          });
        }
      }
    };
    
    // Public discovery methods - no authentication required
    if (handleAsPublic) {
      try {
        logger.info({ method, authenticated: false }, 'Handling public JSON-RPC request');
        const response = await deps.dispatcher.handle(req.body, {
          token: '',
          scopes: [],
          subject: undefined,
          payload: {},
          validatedToken: {
            token: '',
            payload: {},
            scopes: [],
            subject: undefined,
          },
        });

        sendRpcResult(response);
        res.json(response);
      } catch (error) {
        next(error);
      }
      return;
    }

    // Tool calls: if unauthenticated/invalid, return a JSON-RPC error result with
    // `_meta['mcp/www_authenticate']` so ChatGPT can trigger the OAuth linking UI.
    if (method === 'tools/call') {
      const rawAuth = req.get('authorization') ?? req.get('Authorization');
      const match = typeof rawAuth === 'string' ? rawAuth.match(/^Bearer\s+(.+)$/i) : null;
      const bearer = match ? match[1] : null;

      if (!bearer || bearer.trim().length === 0) {
        const challenge = buildWwwAuthenticateChallenge(req, {
          error: 'invalid_token',
          errorDescription: 'No access token provided.',
        });
        res.setHeader('WWW-Authenticate', challenge);
        const response = buildAuthRequiredJsonRpcErrorResponse(req, 'Authentication required: no access token provided.');
        sendRpcResult(response);
        res.status(401).json(response);
        return;
      }

      try {
        const validated = await validateAccessToken(bearer);
        const authContext: AuthenticatedRequest['authContext'] = {
          token: validated.token,
          scopes: validated.scopes,
          subject: validated.subject,
          payload: validated.payload,
          validatedToken: validated,
        };

        const response = await deps.dispatcher.handle(req.body, {
          token: authContext.token,
          scopes: authContext.scopes,
          subject: authContext.subject,
          payload: authContext.payload,
          validatedToken: authContext.validatedToken,
        });

        sendRpcResult(response, authContext);
        res.json(response);
      } catch (error) {
        if (error instanceof TokenValidationError) {
          const challenge = buildWwwAuthenticateChallenge(req, {
            error: error.code,
            errorDescription: error.message,
          });
          res.setHeader('WWW-Authenticate', challenge);
          const response = buildAuthRequiredJsonRpcErrorResponse(req, `Authentication required: ${error.message}`, {
            error: error.code,
            errorDescription: error.message,
          });
          sendRpcResult(response);
          res.status(401).json(response);
          return;
        }
        next(error);
      }

      return;
    }

    // All other methods require authentication
    return requireBearer(req, res, async () => {
      const authContext = (req as AuthenticatedRequest).authContext;
      if (!authContext) {
        res.status(500).json({ status: 500, message: 'Authentication context missing.' });
        return;
      }

      try {
          logger.info(
            {
              method,
              authenticated: true,
              subject: authContext.subject,
            },
            'Handling authenticated JSON-RPC request',
          );

          const response = await deps.dispatcher.handle(req.body, {
            token: authContext.token,
            scopes: authContext.scopes,
            subject: authContext.subject,
            payload: authContext.payload,
            validatedToken: authContext.validatedToken,
          });

        sendRpcResult(response, authContext);
        res.json(response);
      } catch (error) {
        next(error);
      }
    });
  });

  app.post('/mcp/tools/call', requireBearer, async (req, res, next) => {
    const authContext = (req as AuthenticatedRequest).authContext;
    if (!authContext) {
      res.status(500).json({ status: 500, message: 'Authentication context missing.' });
      return;
    }

    try {
      const response = await deps.dispatcher.handle(
        {
          jsonrpc: '2.0',
          id: req.body?.id ?? null,
          method: 'tools/call',
          params: req.body,
        },
        {
          token: authContext.token,
          scopes: authContext.scopes,
          subject: authContext.subject,
          payload: authContext.payload,
          validatedToken: authContext.validatedToken,
        },
      );

      if ('error' in response) {
        throw new AppError(response.error.message || 'Tool invocation failed.', {
          status: 400,
          code: 'tool_call_failed',
          details: response.error,
        });
      }

      res.json(response.result);
    } catch (error) {
      next(error);
    }
  });

  // NOTE: /mcp POST is always enabled above.

  app.use((req, res) => {
    const accept = (req.get('accept') ?? '').toLowerCase();
    const expectsSse = req.path.startsWith('/sse') || accept.includes('text/event-stream');

    if (expectsSse) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.status(404);
      res.write('event: error\n');
      res.write(`data: ${JSON.stringify({ status: 404, code: 'not_found', message: 'Endpoint not found.' })}\n\n`);
      res.end();
      return;
    }

    res.status(404).json({
      status: 404,
      code: 'not_found',
      message: 'Endpoint not found.',
    });
  });

  app.use(errorHandler);

  return app;
}
