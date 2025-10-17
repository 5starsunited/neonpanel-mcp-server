import type { NextFunction, Request, Response } from 'express';
import { isAppError, isJsonRpcError } from '../lib/errors';
import { logger } from '../logging/logger';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (isJsonRpcError(err)) {
    logger.error({ err }, 'JSON-RPC handler failed');
    return res.status(err.status).json({
      status: err.status,
      code: err.code,
      message: err.message,
      details: err.details,
    });
  }

  if (isAppError(err)) {
    logger.error({ err }, 'Application error handled');
    return res.status(err.status).json({
      status: err.status,
      code: err.code,
      message: err.message,
      details: err.details,
    });
  }

  logger.error({ err }, 'Unhandled error');
  return res.status(500).json({
    status: 500,
    code: 'internal_error',
    message: 'Unexpected error occurred.',
  });
}
