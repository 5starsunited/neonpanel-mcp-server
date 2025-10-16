import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import oauthEndpoints, { buildResourceMetadataUrl } from './oauth-endpoints.js';
import { registerExecRoute } from './routes/exec-route.js';
import {
  validateAccessToken,
  isTokenValidationError,
  ValidatedAccessToken,
} from './auth/token-validator.js';
import { z } from 'zod';
import { getAccount, searchOrders } from './clients/neonpanel-api.js';
import type { NeonPanelApiOptions } from './clients/neonpanel-api.js';

const app = express();
app.set('trust proxy', true);

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'Cache-Control', 'Accept'],
  exposedHeaders: ['WWW-Authenticate']
}));

app.use(express.json());
app.use('/', oauthEndpoints);

const NEONPANEL_BASE_URL = process.env.NEONPANEL_BASE_URL || 'https://my.neonpanel.com';
const SSE_HEARTBEAT_MS = Number.parseInt(process.env.SSE_HEARTBEAT_MS || '15000', 10);
const SERVER_INFO = {
  name: 'neonpanel-mcp',
  version: '1.0.0'
};
const SERVER_PROTOCOL_VERSION = process.env.MCP_PROTOCOL_VERSION || '2025-01-01';

interface ActiveSession {
  transport: SSEServerTransport;
  bearerToken: string;
  validatedToken: ValidatedAccessToken;
}

interface RequestWithAuth extends Request {
  bearerToken?: string;
  validatedToken?: ValidatedAccessToken;
  auth?: Record<string, unknown>;
}

type AuthChallengeOptions = {
  error?: string;
  scope?: string;
  description?: string;
};

const activeSessions = new Map<string, ActiveSession>();

function attachAuthChallenge(res: Response, req: Request, options: AuthChallengeOptions = {}) {
  const metadataUrl = buildResourceMetadataUrl(req);
  const parts = [`realm="mcp"`, `resource_metadata="${metadataUrl}"`];

  if (options.error) {
    parts.push(`error="${options.error}"`);
  }

  if (options.description) {
    parts.push(`error_description="${options.description}"`);
  }

  if (options.scope) {
    parts.push(`scope="${options.scope}"`);
  }

  res.setHeader('WWW-Authenticate', `Bearer ${parts.join(', ')}`);
}

/**
 * Extract Bearer token from Authorization header.
 */
function extractBearerToken(req: Request): string | null {
  const auth = req.get('authorization') || req.get('Authorization');
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

/**
 * Require and validate a NeonPanel OAuth access token.
 */
async function requireBearer(req: Request, res: Response, next: NextFunction) {
  const token = extractBearerToken(req);

  if (!token) {
    attachAuthChallenge(res, req, { error: 'invalid_token', description: 'Missing Bearer access token.' });
    return res.status(401).json({
      error: 'invalid_token',
      error_description: "Unsupported authorization header. Use 'Authorization: Bearer <token>'."
    });
  }

  try {
    const validation = await validateAccessToken(token);
    const authReq = req as RequestWithAuth;
    authReq.bearerToken = token;
    authReq.validatedToken = validation;
    return next();
  } catch (error) {
    const description = isTokenValidationError(error)
      ? error.message
      : 'Failed to validate access token.';

    attachAuthChallenge(res, req, { error: 'invalid_token', description });
    return res.status(401).json({
      error: 'invalid_token',
      error_description: description
    });
  }
}

const tools: Tool[] = [
  {
    name: 'neonpanel.getAccount',
    description: 'Retrieve core account details from NeonPanel, including profile and status metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        accountId: {
          type: 'string',
          description: 'NeonPanel account identifier (UUID or numeric ID depending on workspace).'
        },
        useUserToken: {
          type: 'boolean',
          description: 'Set true to call NeonPanel using the inbound user access token instead of the server IAT.'
        }
      },
      required: ['accountId']
    }
  },
  {
    name: 'neonpanel.searchOrders',
    description: 'Search NeonPanel orders with optional filters for time range, status, and free-text query.',
    inputSchema: {
      type: 'object',
      properties: {
        q: {
          type: 'string',
          description: 'Free-text search applied to order attributes (SKU, marketplace, buyer, etc.).'
        },
        from: {
          type: 'string',
          description: 'ISO 8601 timestamp marking the inclusive start date for the search window.'
        },
        to: {
          type: 'string',
          description: 'ISO 8601 timestamp marking the inclusive end date for the search window.'
        },
        status: {
          type: 'string',
          description: 'Optional order status filter (e.g., SHIPPED, OPEN, CANCELLED).'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of orders to return. Defaults to provider standard.',
          minimum: 1,
          maximum: 200
        },
        useUserToken: {
          type: 'boolean',
          description: 'Set true to call NeonPanel using the inbound user access token instead of the server IAT.'
        }
      }
    }
  }
];

const getAccountArgsSchema = z.object({
  accountId: z.string().min(1),
  useUserToken: z.boolean().optional(),
});

const searchOrdersArgsSchema = z.object({
  q: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  status: z.string().optional(),
  limit: z.number().int().positive().max(200).optional(),
  useUserToken: z.boolean().optional(),
});

const mcpServer = new Server(
  SERVER_INFO,
  {
    capabilities: {
      tools: {},
    },
  }
);

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

mcpServer.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const { name, arguments: args } = request.params;
  const rawArgs = (args as Record<string, unknown>) || {};

  const authInfo = (extra?.authInfo as { bearerToken?: string; validatedToken?: ValidatedAccessToken } | undefined) || {};
  const userToken = authInfo.bearerToken;
  const subject = authInfo.validatedToken?.subject;

  console.log(`[tools/call] ${name} requested by ${subject ?? 'unknown-subject'}`);

  const runWithOptions = async <T>(useUserToken: boolean | undefined, exec: (options: NeonPanelApiOptions) => Promise<T>) => {
    const options: NeonPanelApiOptions = {};
    if (useUserToken) {
      if (!userToken) {
        throw new Error('User token not available for this session.');
      }
      options.useUserToken = true;
      options.userToken = userToken;
    }
    return exec(options);
  };

  try {
    switch (name) {
      case 'neonpanel.getAccount': {
        const parsed = getAccountArgsSchema.parse(rawArgs);
        const account = await runWithOptions(parsed.useUserToken, (options) => getAccount(parsed.accountId, options));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ account }, null, 2)
            }
          ]
        };
      }

      case 'neonpanel.searchOrders': {
        const parsed = searchOrdersArgsSchema.parse(rawArgs);
        const { useUserToken, ...filters } = parsed;
        const orders = await runWithOptions(useUserToken, (options) => searchOrders(filters, options));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ orders }, null, 2)
            }
          ]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    const description = error?.message || 'Tool execution failed.';
    throw new Error(`Tool execution failed: ${description}`);
  }
});

app.get('/healthz', (_req, res) => {
  res.json({
    status: 'ok',
    service: SERVER_INFO.name,
    baseUrl: NEONPANEL_BASE_URL,
    protocolVersion: SERVER_PROTOCOL_VERSION,
    ts: new Date().toISOString()
  });
});

app.options('/sse', (_req, res) => {
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Cache-Control, Content-Type');
  res.status(204).end();
});

app.get('/sse', requireBearer, async (req, res) => {
  const authReq = req as RequestWithAuth;
  const bearerToken = authReq.bearerToken as string;
  const validatedToken = authReq.validatedToken as ValidatedAccessToken;

  try {
    const transport = new SSEServerTransport('/messages', res);
    await mcpServer.connect(transport);

    const sessionId = transport.sessionId;
    activeSessions.set(sessionId, {
      transport,
      bearerToken,
      validatedToken
    });

    transport.onclose = () => {
      activeSessions.delete(sessionId);
    };

    res.write(`event: ready\ndata: ${JSON.stringify({ ok: true, sessionId, subject: validatedToken.subject ?? null, scopes: validatedToken.scopes })}\n\n`);

    const heartbeat = setInterval(() => {
      if (res.writableEnded) {
        clearInterval(heartbeat);
        return;
      }
      res.write(`event: ping\ndata: ${Date.now()}\n\n`);
    }, SSE_HEARTBEAT_MS);

    req.on('close', () => {
      clearInterval(heartbeat);
      activeSessions.delete(sessionId);
    });
  } catch (error) {
    console.error('SSE connection error:', error);
    res.status(500).end();
  }
});

app.options('/messages', (_req, res) => {
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Cache-Control, Content-Type');
  res.status(204).end();
});

app.post('/messages', requireBearer, async (req, res) => {
  const authReq = req as RequestWithAuth;
  const incomingValidation = authReq.validatedToken;
  const querySession = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;
  const headerSession = req.get('mcp-session-id') || req.get('MCP-Session-Id');
  const sessionId = querySession || headerSession || undefined;

  if (!sessionId) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing sessionId. Provide ?sessionId=... or MCP-Session-Id header.'
    });
  }

  const session = activeSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({
      error: 'unknown_session',
      error_description: 'No active SSE session found for the provided sessionId.'
    });
  }

  if (!incomingValidation || session.validatedToken.token !== incomingValidation.token) {
    attachAuthChallenge(res, req, { error: 'invalid_token', description: 'Token does not match active SSE session.' });
    return res.status(403).json({
      error: 'invalid_token',
      error_description: 'Token does not match active SSE session.'
    });
  }

  try {
    const transportReq = req as RequestWithAuth;
    const clientId = typeof session.validatedToken.payload?.client_id === 'string'
      ? session.validatedToken.payload.client_id
      : undefined;
    transportReq.auth = {
      token: session.bearerToken,
      scopes: session.validatedToken.scopes,
      clientId,
      subject: session.validatedToken.subject,
      issuer: session.validatedToken.issuer,
    };

    await session.transport.handlePostMessage(transportReq as unknown as Request, res, req.body);
  } catch (error) {
    console.error('Error handling /messages payload:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error', error_description: 'Failed to process MCP message.' });
    }
  }
});

registerExecRoute(app, {
  neonpanelBaseUrl: NEONPANEL_BASE_URL,
  attachAuthChallenge,
});

const PORT = process.env.PORT || 3030;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`NeonPanel MCP server running on :${PORT}`);
    console.log(`Health: http://localhost:${PORT}/healthz`);
    console.log(`SSE:    http://localhost:${PORT}/sse`);
    console.log(`POST:   http://localhost:${PORT}/messages`);
  });
}

export default app;
