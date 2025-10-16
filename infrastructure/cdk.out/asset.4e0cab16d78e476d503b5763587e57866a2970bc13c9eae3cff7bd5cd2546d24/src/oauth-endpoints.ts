import express from 'express';
import crypto from 'crypto';
import axios from 'axios';

const router = express.Router();

export const RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource';
export const AUTHORIZATION_SERVER_PATH = '/.well-known/oauth-authorization-server';
export const OPENID_CONFIGURATION_PATH = '/.well-known/openid-configuration';

const DEFAULT_SCOPE_SET = [
  'read:inventory',
  'read:analytics',
  'read:companies',
  'read:reports',
  'read:warehouses',
  'read:revenue',
  'read:cogs',
  'read:landed-cost',
  'write:import'
];

const FALLBACK_AUTHORIZATION_SERVER = process.env.MCP_OAUTH_ISSUER || 'https://my.neonpanel.com';

function resolveForwardedProto(req: express.Request): string {
  const forwarded = req.headers['x-forwarded-proto'];
  if (Array.isArray(forwarded)) {
    return forwarded[0];
  }
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.protocol;
}

export function resolveBaseUrl(req: express.Request): string {
  const protocol = resolveForwardedProto(req);
  const host = req.get('host') || 'localhost';
  return `${protocol}://${host}`;
}

export function buildResourceMetadataUrl(req: express.Request): string {
  return `${resolveBaseUrl(req)}${RESOURCE_METADATA_PATH}`;
}

function resolveIssuer() {
  return process.env.MCP_OAUTH_ISSUER || FALLBACK_AUTHORIZATION_SERVER;
}

function buildAuthorizationServerMetadata(req?: express.Request) {
  const issuer = resolveIssuer();
  const jwksUri = process.env.MCP_OAUTH_JWKS_URI || `${issuer}/.well-known/jwks.json`;
  
  // Keep registration_endpoint on same host as issuer (best practice)
  // MCP server will proxy DCR requests to this endpoint
  
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth2/authorize`,
    token_endpoint: `${issuer}/oauth2/token`,
    registration_endpoint: `${issuer}/oauth2/register`, // Same host as issuer
    scopes_supported: DEFAULT_SCOPE_SET,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'private_key_jwt', 'none'],
    jwks_uri: jwksUri
  };
}

// OAuth Protected Resource Metadata (RFC 9470)
router.get(RESOURCE_METADATA_PATH, (req, res) => {
  const baseUrl = resolveBaseUrl(req);
  const authorizationServer = resolveIssuer();

  res.json({
    authorization_servers: [authorizationServer],
    resources: [
      {
        resource: `${baseUrl}/mcp`,
        scopes: DEFAULT_SCOPE_SET
      }
    ]
  });
});

// OAuth 2.0 Authorization Server Metadata (RFC8414)
router.get(AUTHORIZATION_SERVER_PATH, (req, res) => {
  res.json(buildAuthorizationServerMetadata(req));
});

// OpenID Provider Configuration (OIDC Discovery)
router.get(OPENID_CONFIGURATION_PATH, (req, res) => {
  res.json({
    ...buildAuthorizationServerMetadata(req),
    issuer: resolveIssuer(),
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256']
  });
});

// OAuth Authorization Endpoint
router.get('/oauth/authorize', (req, res) => {
  const { 
    client_id, 
    redirect_uri, 
    response_type, 
    scope, 
    state, 
    code_challenge, 
    code_challenge_method 
  } = req.query;

  // Validate required parameters
  if (!client_id || !redirect_uri || !response_type || !state) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing required parameters'
    });
  }

  // Pass through to NeonPanel's OAuth - each client has their own callback URL
  const neonpanelAuthUrl = new URL('https://my.neonpanel.com/oauth2/authorize');
  neonpanelAuthUrl.searchParams.set('client_id', client_id as string);
  neonpanelAuthUrl.searchParams.set('redirect_uri', redirect_uri as string);
  neonpanelAuthUrl.searchParams.set('response_type', response_type as string);
  neonpanelAuthUrl.searchParams.set('scope', (scope as string) || 'read:inventory read:analytics');
  neonpanelAuthUrl.searchParams.set('state', state as string);
  
  if (code_challenge) {
    neonpanelAuthUrl.searchParams.set('code_challenge', code_challenge as string);
  }
  if (code_challenge_method) {
    neonpanelAuthUrl.searchParams.set('code_challenge_method', code_challenge_method as string);
  }

  res.redirect(neonpanelAuthUrl.toString());
});

// OAuth Token Endpoint
router.post('/oauth/token', async (req, res) => {
  const { 
    grant_type, 
    code, 
    redirect_uri, 
    client_id,
    client_secret,
    code_verifier,
    refresh_token,
    scope
  } = req.body;

  // Validate grant_type
  const supportedGrantTypes = ['authorization_code', 'refresh_token', 'client_credentials'];
  if (!grant_type || !supportedGrantTypes.includes(grant_type)) {
    return res.status(400).json({
      error: 'unsupported_grant_type',
      error_description: `Grant type must be one of: ${supportedGrantTypes.join(', ')}`
    });
  }

  try {
    // Build request body based on grant type
    const tokenParams: Record<string, string> = {
      grant_type: grant_type
    };

    if (grant_type === 'authorization_code') {
      if (!code) {
        return res.status(400).json({
          error: 'invalid_request',
          error_description: 'Missing required parameter: code'
        });
      }
      tokenParams.code = code;
      if (redirect_uri) tokenParams.redirect_uri = redirect_uri;
      if (client_id) tokenParams.client_id = client_id;
      if (code_verifier) tokenParams.code_verifier = code_verifier;
    } else if (grant_type === 'refresh_token') {
      if (!refresh_token) {
        return res.status(400).json({
          error: 'invalid_request',
          error_description: 'Missing required parameter: refresh_token'
        });
      }
      tokenParams.refresh_token = refresh_token;
      if (client_id) tokenParams.client_id = client_id;
      if (client_secret) tokenParams.client_secret = client_secret;
      if (scope) tokenParams.scope = scope;
    } else if (grant_type === 'client_credentials') {
      if (!client_id || !client_secret) {
        return res.status(400).json({
          error: 'invalid_request',
          error_description: 'Missing required parameters: client_id and client_secret'
        });
      }
      tokenParams.client_id = client_id;
      tokenParams.client_secret = client_secret;
      if (scope) tokenParams.scope = scope;
    }

    // Exchange with NeonPanel
    const tokenResponse = await axios.post(
      'https://my.neonpanel.com/oauth2/token',
      new URLSearchParams(tokenParams).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        validateStatus: () => true
      }
    );

    const rawData = tokenResponse.data;
    let parsedData: unknown = rawData;

    if (typeof rawData === 'string') {
      try {
        parsedData = JSON.parse(rawData);
      } catch {
        parsedData = rawData.trim();
      }
    }

    if (tokenResponse.status < 200 || tokenResponse.status >= 300) {
      const errorData =
        parsedData && typeof parsedData === 'object'
          ? parsedData as { error?: string; error_description?: string }
          : { error: 'server_error', error_description: String(parsedData) };

      return res.status(tokenResponse.status).json({
        error: errorData.error || 'invalid_grant',
        error_description: errorData.error_description || 'Token exchange failed'
      });
    }

    // Return the token data from NeonPanel
    res.status(tokenResponse.status).json(parsedData);
  } catch (error) {
    console.error('Token endpoint error:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Send more detailed error in development
    if (process.env.NODE_ENV === 'development') {
      return res.status(500).json({
        error: 'server_error',
        error_description: `Internal server error: ${errorMessage}`,
        stack: error instanceof Error ? error.stack : undefined
      });
    }
    
    res.status(500).json({
      error: 'server_error',
      error_description: `Internal server error: ${errorMessage}`
    });
  }
});

// Dynamic Client Registration Proxy (RFC 7591)
// ChatGPT requires DCR, but NeonPanel uses pre-registered clients
// Solution: Always return the same pre-registered client credentials
// This allows ChatGPT to "register" while using NeonPanel's static client
router.post('/oauth2/register', (req, res) => {
  // TODO: Add IAT (Initial Access Token) validation for production
  // const authHeader = req.headers.authorization;
  // if (!authHeader || !authHeader.startsWith('Bearer ')) {
  //   return res.status(401).json({
  //     error: 'invalid_client',
  //     error_description: 'Initial Access Token required'
  //   });
  // }

  const { 
    redirect_uris, 
    client_name, 
    client_uri, 
    logo_uri, 
    scope, 
    grant_types, 
    response_types,
    token_endpoint_auth_method,
    jwks_uri,
    jwks
  } = req.body;

  console.log('[DCR Proxy] Registration request received:', {
    client_name,
    redirect_uris,
    scope,
    grant_types,
    response_types,
    token_endpoint_auth_method
  });

  // Validate redirect_uris is present
  if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
    return res.status(400).json({
      error: 'invalid_redirect_uri',
      error_description: 'redirect_uris must be a non-empty array'
    });
  }

  // Determine auth method - prefer private_key_jwt for public clients
  const requestedAuthMethod = token_endpoint_auth_method || 'private_key_jwt';
  const useClientSecret = ['client_secret_basic', 'client_secret_post'].includes(requestedAuthMethod);

  // ALWAYS return the same pre-registered NeonPanel client
  // This is a "fake" DCR that makes ChatGPT happy while using static credentials
  const clientId = '1145f268-a864-11f0-8a3d-122c1fe52bef';
  const baseUrl = resolveBaseUrl(req);
  
  const response: any = {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    
    // Echo back EXACTLY what the client sent (critical for ChatGPT)
    redirect_uris: redirect_uris,
    client_name: client_name || 'MCP Connector',
    grant_types: grant_types || ['authorization_code', 'refresh_token'],
    response_types: response_types || ['code'],
    token_endpoint_auth_method: requestedAuthMethod,
    
    // Include registration management URIs
    registration_client_uri: `${baseUrl}/oauth2/register/${clientId}`,
    registration_access_token: crypto.randomBytes(32).toString('hex')
  };

  // Only include client_secret for secret-based auth methods
  if (useClientSecret) {
    response.client_secret = 'NbhL8t71IKgf5JDHI9LeyUrbFpcC4hDGA6aLray5iih4h7NalTxJhfeUFLOOs0pk';
    response.client_secret_expires_at = 0; // No expiration
  }

  // Include JWKS if using private_key_jwt
  if (requestedAuthMethod === 'private_key_jwt') {
    if (jwks_uri) {
      response.jwks_uri = jwks_uri;
    } else if (jwks) {
      response.jwks = jwks;
    } else {
      // Provide a default JWKS endpoint
      response.jwks_uri = `${baseUrl}/.well-known/jwks.json`;
    }
  }

  // Include optional fields if provided
  if (client_uri) response.client_uri = client_uri;
  if (logo_uri) response.logo_uri = logo_uri;
  if (scope) response.scope = scope;

  console.log('[DCR Proxy] Returning pre-registered client:', {
    client_id: response.client_id,
    redirect_uris: response.redirect_uris,
    grant_types: response.grant_types,
    token_endpoint_auth_method: response.token_endpoint_auth_method,
    has_client_secret: !!response.client_secret,
    has_jwks_uri: !!response.jwks_uri
  });

  res.status(201).json(response);
});

export default router;
