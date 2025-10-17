import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

type Context = {
  correlationId: string;
};

const storage = new AsyncLocalStorage<Context>();
const HEADER_NAME = 'x-correlation-id';

export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const headerValue = req.header(HEADER_NAME);
  const correlationId = sanitizeCorrelationId(headerValue) ?? randomUUID();

  res.setHeader(HEADER_NAME, correlationId);

  storage.run({ correlationId }, () => {
    next();
  });
}

function sanitizeCorrelationId(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 128) {
    return null;
  }

  return trimmed;
}

export function getCorrelationId(): string | undefined {
  const store = storage.getStore();
  return store?.correlationId;
}
