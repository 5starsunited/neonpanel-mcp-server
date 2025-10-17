import jwt, {
  JwtHeader,
  JwtPayload,
  SigningKeyCallback,
  VerifyErrors,
  VerifyOptions,
} from 'jsonwebtoken';
import jwksClient, { JwksClient } from 'jwks-rsa';
import { config } from '../config';

export interface ValidatedAccessToken {
  token: string;
  payload: JwtPayload;
  scopes: string[];
  subject?: string;
  issuer?: string;
  audience?: string | string[];
  expiresAt?: number;
  issuedAt?: number;
}

export class TokenValidationError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(message: string, code = 'invalid_token', status = 401, cause?: Error) {
    super(message);
    this.name = 'TokenValidationError';
    this.code = code;
    this.status = status;
    if (cause && cause.stack) {
      this.stack = `${this.name}: ${this.message}\nCaused by: ${cause.stack}`;
    }
  }
}

export function isTokenValidationError(error: unknown): error is TokenValidationError {
  return error instanceof TokenValidationError;
}

const jwks: JwksClient = jwksClient({
  jwksUri: config.neonpanel.jwksUri,
  cache: true,
  cacheMaxEntries: toPositiveInt(process.env.NEONPANEL_JWKS_CACHE_MAX_ENTRIES, 10),
  cacheMaxAge: toPositiveInt(process.env.NEONPANEL_JWKS_CACHE_MS, 10 * 60 * 1000),
  rateLimit: true,
  jwksRequestsPerMinute: toPositiveInt(process.env.NEONPANEL_JWKS_REQUESTS_PER_MINUTE, 30),
});

export async function validateAccessToken(token: string): Promise<ValidatedAccessToken> {
  if (!token || typeof token !== 'string') {
    throw new TokenValidationError('Missing OAuth access token.');
  }

  const verifyOptions: VerifyOptions = {
    algorithms: ['RS256'],
    issuer: config.neonpanel.issuer,
    audience: config.neonpanel.expectedAudience,
  };

  const payload = await new Promise<JwtPayload>((resolve, reject) => {
    jwt.verify(token, getSigningKey, verifyOptions, (err, decoded) => {
      if (err) {
        return reject(normalizeJwtError(err));
      }

      if (!decoded || typeof decoded === 'string') {
        return reject(new TokenValidationError('Token payload is not a JWT object.'));
      }

      resolve(decoded);
    });
  });

  const scopes = extractScopes(payload);

  if (scopes.length === 1 && scopes[0] === 'dcr.create') {
    throw new TokenValidationError('Initial access tokens (scope dcr.create) are not permitted for MCP requests.');
  }

  const requiredScopes = config.neonpanel.requiredScopes;
  if (requiredScopes.length > 0) {
    const missing = requiredScopes.filter((scope) => !scopes.includes(scope));
    if (missing.length > 0) {
      throw new TokenValidationError(`Access token missing required scopes: ${missing.join(', ')}`);
    }
  }

  return {
    token,
    payload,
    scopes,
    subject: payload.sub,
    issuer: payload.iss,
    audience: payload.aud,
    expiresAt: typeof payload.exp === 'number' ? payload.exp : undefined,
    issuedAt: typeof payload.iat === 'number' ? payload.iat : undefined,
  };
}

function getSigningKey(header: JwtHeader, callback: SigningKeyCallback) {
  if (!header.kid) {
    callback(new TokenValidationError('Token header missing key identifier (kid).'));
    return;
  }

  jwks.getSigningKey(header.kid)
    .then(key => {
      const signingKey = typeof key.getPublicKey === 'function'
        ? key.getPublicKey()
        : (key as unknown as { rsaPublicKey?: string }).rsaPublicKey;

      if (!signingKey) {
        callback(new TokenValidationError('Unable to resolve signing key for token.'));
        return;
      }

      callback(null, signingKey);
    })
    .catch(err => {
      callback(normalizeJwtError(err));
    });
}

function normalizeJwtError(error: VerifyErrors | Error): TokenValidationError {
  if (error instanceof TokenValidationError) {
    return error;
  }

  const name = (error as VerifyErrors).name;

  switch (name) {
    case 'TokenExpiredError':
      return new TokenValidationError('Access token has expired.');
    case 'JsonWebTokenError':
      return new TokenValidationError(error.message || 'Access token is not valid.');
    case 'NotBeforeError':
      return new TokenValidationError('Access token is not yet valid.');
    default:
      return new TokenValidationError(error.message || 'Failed to validate access token.');
  }
}

function extractScopes(payload: JwtPayload): string[] {
  const scopes: string[] = [];

  if (typeof payload.scope === 'string') {
    scopes.push(...payload.scope.split(/\s+/));
  }

  if (Array.isArray((payload as Record<string, unknown>).scp)) {
    const scp = (payload as Record<string, unknown>).scp as unknown[];
    for (const item of scp) {
      if (typeof item === 'string') {
        scopes.push(item);
      }
    }
  }

  return Array.from(new Set(scopes.filter(Boolean)));
}

function toPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
