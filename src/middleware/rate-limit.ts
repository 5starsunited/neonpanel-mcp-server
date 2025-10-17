import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';

type Bucket = {
  count: number;
  expiresAt: number;
};

const buckets = new Map<string, Bucket>();

export function rateLimit() {
  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
    const key = req.ip || req.headers['x-forwarded-for']?.toString() || 'unknown';
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.expiresAt <= now) {
      buckets.set(key, {
        count: 1,
        expiresAt: now + config.rateLimit.windowMs,
      });
      return next();
    }

    if (bucket.count >= config.rateLimit.max) {
      res.setHeader('Retry-After', Math.ceil((bucket.expiresAt - now) / 1000).toString());
      return res.status(429).json({
        status: 429,
        code: 'rate_limit_exceeded',
        message: 'Too many requests. Please retry shortly.',
      });
    }

    bucket.count += 1;
    return next();
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.expiresAt <= now) {
      buckets.delete(key);
    }
  }
}, config.rateLimit.windowMs).unref();
