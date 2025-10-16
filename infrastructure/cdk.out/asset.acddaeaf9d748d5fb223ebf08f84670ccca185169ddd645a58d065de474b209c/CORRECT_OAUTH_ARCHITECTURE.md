# Correct MCP + NeonPanel OAuth Architecture

## ✅ Correct Understanding

The architecture is:

```
┌─────────────────────────────────────────────────────────────────┐
│  ChatGPT discovers OAuth endpoints from MCP server               │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│  GET https://mcp.neonpanel.com/.well-known/oauth-authorization-server │
│                                                                   │
│  Returns:                                                         │
│  {                                                                │
│    "issuer": "https://my.neonpanel.com",                         │
│    "authorization_endpoint": "https://my.neonpanel.com/oauth2/authorize", │
│    "token_endpoint": "https://my.neonpanel.com/oauth2/token",    │
│    "registration_endpoint": "https://my.neonpanel.com/oauth2/register" │
│  }                                                                │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│  ChatGPT performs OAuth flow with NeonPanel OAuth Server         │
│                                                                   │
│  1. Authorization request to my.neonpanel.com/oauth2/authorize   │
│  2. User logs in with NeonPanel credentials                      │
│  3. User authorizes ChatGPT                                      │
│  4. Redirect back to ChatGPT with auth code                      │
│  5. Token request to my.neonpanel.com/oauth2/token               │
│  6. Receives: access_token, refresh_token, expires_in            │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│  ChatGPT calls MCP Server with NeonPanel access token            │
│                                                                   │
│  GET https://mcp.neonpanel.com/mcp                               │
│  Authorization: Bearer <neonpanel_access_token>                  │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│  MCP Server validates token and calls NeonPanel API              │
│                                                                   │
│  1. Validates token (JWT signature, expiration, scopes)          │
│  2. Uses same token to call NeonPanel API                        │
│     GET https://my.neonpanel.com/api/v1/inventory-items         │
│     Authorization: Bearer <neonpanel_access_token>               │
│  3. Returns data to ChatGPT via MCP protocol                     │
└─────────────────────────────────────────────────────────────────┘
```

## 🔑 Key Points

1. **NeonPanel OAuth is the authorization server** for both:
   - ChatGPT → MCP authentication
   - MCP → NeonPanel API authentication

2. **Same token used everywhere**:
   - ChatGPT gets token from NeonPanel OAuth
   - ChatGPT sends token to MCP server
   - MCP server uses same token for NeonPanel API

3. **MCP server's role**:
   - Acts as OAuth **resource server** (not auth server)
   - Validates tokens issued by NeonPanel
   - Proxies NeonPanel API calls with validated token

4. **IAT token**:
   - Only needed for DCR (Dynamic Client Registration)
   - ChatGPT uses it to register itself with NeonPanel OAuth
   - Not used for regular API calls

## 🔧 What Needs to Change

### Current Implementation
✅ Accepts Bearer tokens
✅ Requires Authorization header
❌ Doesn't validate token with NeonPanel
❌ Assumes token is always valid

### Required Changes

1. **Add Token Validation**
   - Verify JWT signature (if JWT)
   - Check token expiration
   - Validate issuer is `my.neonpanel.com`
   - Verify required scopes

2. **Token Introspection** (if opaque tokens)
   - Call NeonPanel token introspection endpoint
   - Verify token is active
   - Cache validation results

3. **Use User's Token for API Calls**
   - Don't need separate IAT for API calls
   - Use the user's access token from ChatGPT
   - Each user's requests use their own token (proper multi-tenancy)

## 📋 Implementation Plan

### Option 1: JWT Validation (if NeonPanel uses JWT)

```typescript
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

const client = jwksClient({
  jwksUri: 'https://my.neonpanel.com/.well-known/jwks.json'
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
}

async function validateToken(token: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    jwt.verify(token, getKey, {
      issuer: 'https://my.neonpanel.com',
      algorithms: ['RS256']
    }, (err, decoded) => {
      if (err) {
        reject(err);
      } else {
        resolve(true);
      }
    });
  });
}
```

### Option 2: Token Introspection (if opaque tokens)

```typescript
async function validateToken(token: string): Promise<boolean> {
  const response = await fetch('https://my.neonpanel.com/oauth2/introspect', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      token: token,
      token_type_hint: 'access_token'
    })
  });
  
  const result = await response.json();
  return result.active === true;
}
```

### Updated Middleware

```typescript
async function requireBearer(req: Request, res: Response, next: express.NextFunction) {
  const token = extractBearerToken(req);
  
  if (!token) {
    attachAuthChallenge(res, req);
    return res.status(401).json({
      error: "invalid_token",
      error_description: "Missing Authorization header. Use 'Authorization: Bearer <token>'."
    });
  }
  
  try {
    // Validate token with NeonPanel OAuth
    const isValid = await validateToken(token);
    
    if (!isValid) {
      attachAuthChallenge(res, req);
      return res.status(401).json({
        error: "invalid_token",
        error_description: "Token is invalid or expired."
      });
    }
    
    // Store token for API calls
    (req as any).bearerToken = token;
    return next();
  } catch (error) {
    attachAuthChallenge(res, req);
    return res.status(401).json({
      error: "invalid_token",
      error_description: "Token validation failed."
    });
  }
}
```

## 🎯 Next Steps

1. **Determine token format**:
   - Are NeonPanel OAuth tokens JWT or opaque?
   - Check: `https://my.neonpanel.com/.well-known/jwks.json` (exists = JWT)

2. **Implement validation**:
   - If JWT: Install `jsonwebtoken` and `jwks-rsa`, validate signatures
   - If opaque: Call token introspection endpoint

3. **Test flow**:
   - Get real access token from NeonPanel OAuth
   - Test MCP endpoint with that token
   - Verify it validates correctly

4. **Remove IAT from MCP operations**:
   - IAT only needed for DCR
   - Regular operations use user's access token

## 📝 Summary

- ✅ NeonPanel OAuth is the authorization server
- ✅ MCP server is an OAuth resource server
- ✅ Same token used for MCP and NeonPanel API
- ❌ Need to add token validation
- ❌ Need to determine token format (JWT vs opaque)

**The current Bearer token acceptance is correct, we just need to add validation!**
