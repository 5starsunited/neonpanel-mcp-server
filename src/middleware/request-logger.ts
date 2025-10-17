import pinoHttp from 'pino-http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { logger } from '../logging/logger';
import { getCorrelationId } from './correlation-id';

function resolveLogLevel(res: ServerResponse<IncomingMessage>, error: Error | undefined) {
  if (error) {
    return 'error';
  }

  const status = res.statusCode ?? 0;
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'info';
}

export const requestLogger = pinoHttp({
  logger,
  customLogLevel: resolveLogLevel,
  customProps: () => {
    const correlationId = getCorrelationId();
    return correlationId ? { correlationId } : {};
  },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie'],
  },
});
