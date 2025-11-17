import express from 'express';
import cors from 'cors';
import type { Application, Request, Response } from 'express';
import type { JwtPayload } from 'jsonwebtoken';
import { config } from '../config';
import { correlationIdMiddleware } from '../middleware/correlation-id';
import { requestLogger } from '../middleware/request-logger';
import { requireBearer, AuthenticatedRequest } from '../middleware/authentication';
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

export interface AppDependencies {
  dispatcher: RpcDispatcher;
  sseManager: SseSessionManager;
  sessionRegistry: SessionRegistry;
  openApiService: OpenApiService;
}

function createPublicRpcContext(): RpcContext {
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

const DEFAULT_PLUGIN_SCOPE = 'read:inventory read:analytics read:companies read:reports read:warehouses read:revenue read:cogs read:landed-cost write:import';

function buildAbsoluteUrl(req: Request, path: string) {
  const forwardedProto = req.get('x-forwarded-proto');
  const protocol = forwardedProto ? forwardedProto.split(',')[0].trim() : req.protocol;
  const host = req.get('host') ?? 'localhost';
  const base = `${protocol}://${host}`;
  return path ? `${base}${path}` : base;
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
        scope: DEFAULT_PLUGIN_SCOPE,
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
        auth: tool.auth,
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

  app.get('/healthz', async (req, res, next) => {
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
  });

  // OAuth 2.0 Authorization Server Metadata (RFC 8414)
  // Proxies to my.neonpanel.com OAuth server which supports dynamic callback URLs
  app.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res.json({
      issuer: "https://my.neonpanel.com",
      authorization_endpoint: "https://my.neonpanel.com/oauth2/authorize",
      registration_endpoint: "https://my.neonpanel.com/oauth2/register",
      token_endpoint: "https://my.neonpanel.com/oauth2/token",
      jwks_uri: "https://my.neonpanel.com/.well-known/jwks.json",
      scopes_supported: ["dcr.create"],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token", "client_credentials"],
      token_endpoint_auth_methods_supported: ["none", "private_key_jwt", "client_secret_post", "client_secret_basic"],
      code_challenge_methods_supported: ["S256"],
    });
  });

  app.get('/.well-known/oauth-protected-resource', (_req, res) => {
    const resource = config.neonpanel.expectedAudience;
    const scopes = config.neonpanel.requiredScopes;
    const scopesSupported = scopes.length > 0 ? scopes : ['neonpanel.mcp'];
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

  app.get('/sse', requireBearer, (req: Request, res: Response) => {
    const authContext = (req as AuthenticatedRequest).authContext;
    if (!authContext) {
      res.status(500).json({ status: 500, message: 'Authentication context missing.' });
      return;
    }

    try {
      const session = deps.sseManager.connect(res);

      if (typeof res.flushHeaders === 'function') {
        // Ensure headers + ready event reach the client immediately after connect
        res.flushHeaders();
      }

      deps.sessionRegistry.register(session, authContext);
      logger.info(
        {
          sessionId: session.id,
          subject: authContext.subject,
          scopes: authContext.scopes,
        },
        'SSE connection opened',
      );

      res.on('close', () => {
        deps.sessionRegistry.unregister(session.id);
        logger.info({ sessionId: session.id }, 'SSE connection closed');
      });
    } catch (error) {
      logger.warn({ err: error }, 'Failed to establish SSE session');

      if (!res.headersSent) {
        res.status(503).json({
          status: 503,
          code: 'sse_unavailable',
          message: 'Maximum number of SSE connections reached.',
        });
      } else {
        // Headers already flushed; emit SSE error frame before closing connection
        if (typeof res.write === 'function') {
          res.write('event: error\n');
          res.write(`data: ${JSON.stringify({ code: 'sse_unavailable', message: 'Failed to establish SSE session.' })}\n\n`);
        }
        res.end();
      }
    }
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
    const publicMethods = ['initialize', 'tools/list'];
    const authorizationHeader = req.get('authorization');
    const hasAuthHeader = typeof authorizationHeader === 'string' && authorizationHeader.trim().length > 0;
    const isPublicMethod = publicMethods.includes(method);
    const handleAsPublic = isPublicMethod && !hasAuthHeader;
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

  if (config.features.enableStreamableTransport) {
    app.post('/mcp', requireBearer, rateLimit(), async (req, res, next) => {
      const authContext = (req as AuthenticatedRequest).authContext;
      if (!authContext) {
        res.status(500).json({ status: 500, message: 'Authentication context missing.' });
        return;
      }

      try {
        const response = await deps.dispatcher.handle(req.body, {
          token: authContext.token,
          scopes: authContext.scopes,
          subject: authContext.subject,
          payload: authContext.payload,
          validatedToken: authContext.validatedToken,
        });
        res.json(response);
      } catch (error) {
        next(error);
      }
    });
  }

  app.use((_req, res) => {
    res.status(404).json({
      status: 404,
      code: 'not_found',
      message: 'Endpoint not found.',
    });
  });

  app.use(errorHandler);

  return app;
}
