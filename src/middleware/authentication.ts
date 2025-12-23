import type { NextFunction, Request, Response } from 'express';
import type { JwtPayload } from 'jsonwebtoken';
import { validateAccessToken, TokenValidationError, type ValidatedAccessToken } from '../auth/token-validator';
import { logger } from '../logging/logger';
import { config } from '../config';

export interface AuthContext {
  token: string;
  scopes: string[];
  subject?: string;
  payload: JwtPayload;
  validatedToken: ValidatedAccessToken;
}

export interface AuthenticatedRequest extends Request {
  authContext?: AuthContext;
}

export async function requireBearer(req: Request, res: Response, next: NextFunction) {
  try {
    const bearer = extractBearerToken(req);
    if (!bearer) {
      attachAuthChallenge(req, res);
      return res.status(401).json({
        status: 401,
        code: 'missing_token',
        message: 'Authorization: Bearer token is required.',
      });
    }

    const validated = await validateAccessToken(bearer);
    (req as AuthenticatedRequest).authContext = {
      token: validated.token,
      scopes: validated.scopes,
      subject: validated.subject,
      payload: validated.payload,
      validatedToken: validated,
    };
    return next();
  } catch (error) {
    if (error instanceof TokenValidationError) {
      attachAuthChallenge(req, res, error);
      logger.warn({ err: error }, 'Access token validation failed');
      return res.status(error.status).json({
        status: error.status,
        code: error.code,
        message: error.message,
      });
    }

    logger.error({ err: error }, 'Unexpected error during access token validation');
    attachAuthChallenge(req, res);
    return res.status(500).json({
      status: 500,
      code: 'auth_internal_error',
      message: 'Failed to validate access token.',
    });
  }
}

function extractBearerToken(req: Request): string | null {
  const header = req.get('authorization') ?? req.get('Authorization');
  if (!header) {
    return null;
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function attachAuthChallenge(req: Request, res: Response, error?: TokenValidationError) {
  const parts = [`realm="${config.mcp.serverName}"`];
  const resource = buildResourceIdentifier(req);
  if (resource) {
    parts.push(`resource="${sanitizeHeaderValue(resource)}"`);
  }

  const resourceMetadataUrl = buildResourceMetadataUrl(req);
  if (resourceMetadataUrl) {
    parts.push(`resource_metadata="${sanitizeHeaderValue(resourceMetadataUrl)}"`);
  }

  if (error) {
    parts.push(`error="${error.code}"`);
    parts.push(`error_description="${sanitizeHeaderValue(error.message)}"`);
  }

  const headerValue = `Bearer ${parts.join(', ')}`;
  res.setHeader('WWW-Authenticate', headerValue);
}

function buildResourceMetadataUrl(req: Request): string | null {
  const forwardedProto = req.get('x-forwarded-proto');
  const proto = (typeof forwardedProto === 'string' && forwardedProto.length > 0
    ? forwardedProto.split(',')[0]?.trim()
    : req.protocol) || 'https';

  const forwardedHost = req.get('x-forwarded-host');
  const host =
    (typeof forwardedHost === 'string' && forwardedHost.length > 0 ? forwardedHost : null) ??
    (req.get('host') ?? req.get('Host') ?? null);

  if (!host) {
    return null;
  }

  return `${proto}://${host}/.well-known/oauth-protected-resource`;
}

function buildResourceIdentifier(req: Request): string | null {
  const forwardedProto = req.get('x-forwarded-proto');
  const proto = (typeof forwardedProto === 'string' && forwardedProto.length > 0
    ? forwardedProto.split(',')[0]?.trim()
    : req.protocol) || 'https';

  const forwardedHost = req.get('x-forwarded-host');
  const host =
    (typeof forwardedHost === 'string' && forwardedHost.length > 0 ? forwardedHost : null) ??
    (req.get('host') ?? req.get('Host') ?? null);

  if (!host) {
    return null;
  }

  return `${proto}://${host}`;
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/"/g, "'");
}
