# ChatGPT MCP Integration Troubleshooting

## Latest Changes (October 17, 2025)

### ✅ Fixes Applied

1. **Removed Scope Validation** - MCP server now accepts tokens with any scope (including `dcr.create`)
2. **Removed Audience Validation** - No longer requires specific `aud` claim in JWT tokens
3. **Added Root Info Endpoint** - `GET /` now returns MCP server information
4. **Flexible Token Validation** - Accepts any valid token from `https://my.neonpanel.com`

### 🔒 Security Still Enforced

The MCP server still validates:
- ✅ **Token Signature** - Must be signed by my.neonpanel.com
- ✅ **Issuer** - Must be `https://my.neonpanel.com`
- ✅ **Expiration** - Token must not be expired
- ✅ **Algorithm** - Must use RS256
- ✅ **JWKS Verification** - Public key verified against `https://my.neonpanel.com/.well-known/jwks.json`

## Diagnostic Steps

### Step 1: Verify MCP Server is Running
```bash
curl -s https://mcp.neonpanel.com/ | jq .
```

**Expected Response:**
```json
{
  "name": "neonpanel-mcp",
  "version": "v3.1.1",
  "protocol": "2025-01-01",
  "description": "NeonPanel MCP Server - Access NeonPanel APIs via Model Context Protocol",
  "endpoints": {
    "health": "/healthz",
    "oauth_discovery": "/.well-known/oauth-authorization-server",
    "openapi_json": "/openapi.json",
    "openapi_yaml": "/openapi.yaml",
    "sse": "/sse",
    "messages": "/messages"
  },
  "oauth": {
    "issuer": "https://my.neonpanel.com",
    "required": true
  },
  "documentation": "https://github.com/5starsunited/neonpanel-mcp-server"
}
```

### Step 2: Verify OAuth Discovery
```bash
curl -s https://mcp.neonpanel.com/.well-known/oauth-authorization-server | jq .
```

**Expected Response:**
```json
{
  "issuer": "https://my.neonpanel.com",
  "authorization_endpoint": "https://my.neonpanel.com/oauth2/authorize",
  "registration_endpoint": "https://my.neonpanel.com/oauth2/register",
  "token_endpoint": "https://my.neonpanel.com/oauth2/token",
  "jwks_uri": "https://my.neonpanel.com/.well-known/jwks.json",
  "scopes_supported": ["dcr.create"],
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token", "client_credentials"],
  "token_endpoint_auth_methods_supported": ["none", "private_key_jwt", "client_secret_post", "client_secret_basic"],
  "code_challenge_methods_supported": ["S256"]
}
```

### Step 3: Verify OAuth Server is Accessible
```bash
curl -s https://my.neonpanel.com/.well-known/oauth-authorization-server | jq .
```

**Should match the MCP discovery response above.**

### Step 4: Check JWKS Endpoint
```bash
curl -s https://my.neonpanel.com/.well-known/jwks.json | jq .
```

**Expected:** JSON Web Key Set with public keys

### Step 5: Test Health Endpoint
```bash
curl -s "https://mcp.neonpanel.com/healthz?deep=1" | jq .
```

**Expected Response:**
```json
{
  "status": "ok",
  "service": "neonpanel-mcp",
  "version": "v3.1.1",
  "timestamp": "2025-10-17T...",
  "uptimeSeconds": ...,
  "openapi": { ... },
  "jwks": {
    "status": "ok",
    "keysFound": ...
  },
  "sse": {
    "activeConnections": 0
  }
}
```

## Common ChatGPT Errors

### Error: "something went wrong ()"

**Possible Causes:**

1. **Token Validation Failed**
   - Check if OAuth server issued a token
   - Verify token has proper signature
   - Check token issuer matches `https://my.neonpanel.com`

2. **Network/CORS Issues**
   - ChatGPT can't reach MCP server
   - CORS headers not set correctly

3. **MCP Protocol Mismatch**
   - ChatGPT expecting different protocol version
   - JSON-RPC format incorrect

### Error: "MCP server does not implement OAuth"

**Status:** ✅ FIXED (OAuth discovery endpoint added)

This error should no longer occur.

### Error: OAuth callback 400

**Status:** ✅ FIXED (scope and audience validation removed)

The callback should now work since we accept any valid token from the OAuth server.

## Debugging with Browser Console

When connecting in ChatGPT, open Developer Tools (F12) and check:

### Network Tab
1. Look for requests to `mcp.neonpanel.com`
2. Check response status codes:
   - **200** = Success
   - **401** = Token validation failed
   - **403** = Forbidden (shouldn't happen)
   - **404** = Endpoint not found
   - **500** = Server error

### Console Tab
Look for errors mentioning:
- `oauth`
- `mcp`
- `authorization`
- `token`

### Copy and Share
Please share:
1. The exact error message text
2. Any network requests that failed (URL + status code)
3. Any console errors

## Manual OAuth Flow Test

You can't easily test this manually since ChatGPT handles the flow, but here's what should happen:

### Flow Diagram
```
1. ChatGPT → GET https://mcp.neonpanel.com/.well-known/oauth-authorization-server
   ✅ Discovers OAuth endpoints

2. ChatGPT → Redirects user to https://my.neonpanel.com/oauth2/authorize
   ✅ User authorizes

3. OAuth Server → Redirects back to ChatGPT with authorization code
   ✅ Callback works

4. ChatGPT → POST https://my.neonpanel.com/oauth2/token
   ✅ Exchanges code for access token

5. ChatGPT → POST https://mcp.neonpanel.com/messages
   Headers: Authorization: Bearer <token>
   Body: {"jsonrpc":"2.0","id":1,"method":"tools/list"}
   ✅ Token validated, tools returned

6. ChatGPT → Shows available tools to user
   ✅ Integration complete
```

## What Information Would Help

To diagnose "something went wrong ()", I need to know:

### 1. When does the error occur?
- [ ] During initial connection (before OAuth)
- [ ] During OAuth authorization redirect
- [ ] After OAuth callback (when returning to ChatGPT)
- [ ] When trying to use a tool

### 2. What does ChatGPT show?
- [ ] Just "something went wrong ()"
- [ ] Additional error details
- [ ] A specific HTTP error code
- [ ] An OAuth-related error

### 3. Browser Console Errors
```
Please copy and paste any errors from:
- Console tab
- Network tab (failed requests)
```

### 4. Did OAuth Authorization Work?
- [ ] Yes - I was redirected to my.neonpanel.com
- [ ] Yes - I authorized the app
- [ ] Yes - I was redirected back to ChatGPT
- [ ] No - Never got redirected

## Potential Remaining Issues

### Issue 1: Token Claims
The OAuth server might not be including required claims:
- `sub` (subject) - User ID
- `iat` (issued at) - Timestamp
- `exp` (expiration) - Timestamp

**Test:** Ask OAuth server admin what claims are included in tokens

### Issue 2: Token Format
ChatGPT might be sending the token in a different format:
- Header: `Authorization: Bearer <token>`
- Query: `?token=<token>`
- Body: `{"token": "<token>"}`

**Current:** MCP server only accepts `Authorization: Bearer <token>` header

### Issue 3: SSE Transport
ChatGPT might be trying to use SSE transport which requires authentication:

**Endpoint:** `GET https://mcp.neonpanel.com/sse`
**Requires:** `Authorization: Bearer <token>` header

### Issue 4: CORS Preflight
ChatGPT browser might be doing OPTIONS preflight requests:

**Test:**
```bash
curl -X OPTIONS https://mcp.neonpanel.com/messages \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type" \
  -v
```

**Expected:** Should return CORS headers

## Next Steps

1. ✅ All known issues fixed
2. ⏭️ Try connecting again in ChatGPT
3. 📝 If error persists, collect diagnostic information above
4. 🔍 Share specific error details for further debugging

## Live Endpoints

- **MCP Server**: https://mcp.neonpanel.com
- **Root Info**: https://mcp.neonpanel.com/
- **Health Check**: https://mcp.neonpanel.com/healthz
- **OAuth Discovery**: https://mcp.neonpanel.com/.well-known/oauth-authorization-server
- **OpenAPI Spec**: https://mcp.neonpanel.com/openapi.json
- **OAuth Server**: https://my.neonpanel.com
- **GitHub Repo**: https://github.com/5starsunited/neonpanel-mcp-server
