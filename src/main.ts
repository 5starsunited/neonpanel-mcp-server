import http from 'node:http';
import { config } from './config';
import { logger } from './logging/logger';
import { createApp } from './http/create-app';
import { createRpcDispatcher } from './mcp';
import { SseSessionManager } from './mcp/transport/sse';
import { SessionRegistry } from './mcp/session-registry';
import { OpenApiService } from './lib/openapi-service';

async function bootstrap() {
  const dispatcher = createRpcDispatcher();
  const sseManager = new SseSessionManager();
  const sessionRegistry = new SessionRegistry();
  const openApiService = new OpenApiService();

  // Warm the OpenAPI cache asynchronously
  openApiService
    .getDocument()
    .then(() => logger.info('OpenAPI schema loaded'))
    .catch((error) => logger.warn({ err: error }, 'Failed to warm OpenAPI schema cache'));

  const app = createApp({
    dispatcher,
    sseManager,
    sessionRegistry,
    openApiService,
  });

  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(config.port, () => {
      logger.info(
        { port: config.port, version: config.buildVersion },
        'NeonPanel MCP server listening',
      );
      resolve();
    });
  });

  const shutdown = (signal: NodeJS.Signals) => {
    logger.info({ signal }, 'Received shutdown signal');
    server.close((error) => {
      if (error) {
        logger.error({ err: error }, 'Error during HTTP server shutdown');
      } else {
        logger.info('HTTP server closed gracefully');
      }
      sseManager.closeAll();
      sessionRegistry.terminateAll();
      process.exit(error ? 1 : 0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((error) => {
  logger.error({ err: error }, 'Failed to bootstrap NeonPanel MCP server');
  process.exit(1);
});
