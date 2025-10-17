import express from 'express';
import cors from 'cors';
import type { Application, Request, Response } from 'express';
import { config } from '../config';
import { correlationIdMiddleware } from '../middleware/correlation-id';
import { requestLogger } from '../middleware/request-logger';
import { requireBearer, AuthenticatedRequest } from '../middleware/authentication';
import { rateLimit } from '../middleware/rate-limit';
import { errorHandler } from '../middleware/error-handler';
import { logger } from '../logging/logger';
import { RpcDispatcher } from '../mcp/rpc/dispatcher';
import { SseSessionManager } from '../mcp/transport/sse';
import { SessionRegistry } from '../mcp/session-registry';
import type { OpenApiService } from '../lib/openapi-service';
import { checkJwks } from '../lib/health';

export interface AppDependencies {
  dispatcher: RpcDispatcher;
  sseManager: SseSessionManager;
  sessionRegistry: SessionRegistry;
  openApiService: OpenApiService;
}

export function createApp(deps: AppDependencies): Application {
  const app = express();
  app.disable('x-powered-by');

  app.use(cors());
  app.use(correlationIdMiddleware);
  app.use(requestLogger as any);
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

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

    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    try {
      const session = deps.sseManager.connect(res);
      deps.sessionRegistry.register(session, authContext);

      res.on('close', () => {
        deps.sessionRegistry.unregister(session.id);
      });
    } catch (error) {
      logger.warn({ err: error }, 'Failed to establish SSE session');
      res.status(503).json({
        status: 503,
        code: 'sse_unavailable',
        message: 'Maximum number of SSE connections reached.',
      });
    }
  });

  app.post('/messages', requireBearer, rateLimit(), async (req, res, next) => {
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

      const sessions = deps.sessionRegistry.findMatchingSessions(authContext);
      for (const record of sessions) {
        deps.sseManager.send(record.session.id, {
          event: 'rpc.result',
          data: response,
        });
      }

      res.json(response);
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
