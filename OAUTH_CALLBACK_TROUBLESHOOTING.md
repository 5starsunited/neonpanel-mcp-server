# OAuth Callback 400 Error - Troubleshooting Guide

## Issue
ChatGPT MCP Connector is getting a **400 error** on the OAuth callback:
```
/backend-api/aip/con…ks/oauth/callback:1 
Failed to load resource: the server responded with a status of 400 ()
```

## Root Cause
The OAuth configuration is pointing to `https://my.neonpanel.com` for authorization, token, and registration endpoints, but ChatGPT's callback is failing. This could be due to:

1. **Mismatched Redirect URI** - The redirect URI registered with NeonPanel doesn't match what ChatGPT is using
2. **OAuth Server Configuration** - The OAuth server at `my.neonpanel.com` isn't properly configured to handle ChatGPT's callbacks
3. **Missing CORS Headers** - The OAuth server might not be allowing requests from ChatGPT's domain

## Solutions

### Option 1: Use NeonPanel's OAuth Server (Recommended if it exists)

If `https://my.neonpanel.com` has a working OAuth server:

1. **Register ChatGPT as an OAuth Client**:
```bash
curl -X POST https://my.neonpanel.com/oauth2/register \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "ChatGPT MCP Connector",
    "redirect_uris": [
      "https://chatgpt.com/aip/oauth/callback",
      "https://chat.openai.com/aip/oauth/callback"
    ],
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"],
    "token_endpoint_auth_method": "client_secret_post"
  }'
```

2. **Verify the redirect URIs** match what ChatGPT expects
3. **Test the OAuth flow** manually to ensure it works

### Option 2: Implement OAuth Endpoints on MCP Server (Alternative)

If `my.neonpanel.com` doesn't have OAuth endpoints, we need to implement them on the MCP server:

#### A. Add OAuth Authorization Endpoint

This endpoint handles the OAuth authorization request and redirects to login.

```typescript
// Add to src/http/create-app.ts

app.get('/oauth2/authorize', (req, res) => {
  // Extract OAuth parameters
  const {
    client_id,
    redirect_uri,
    response_type,
    scope,
    state,
    code_challenge,
    code_challenge_method
  } = req.query;

  // Validate parameters
  if (!client_id || !redirect_uri || response_type !== 'code') {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing or invalid OAuth parameters'
    });
  }

  // Store PKCE challenge for later verification
  // (In production, store in Redis/database)
  
  // Redirect to NeonPanel login with return URL
  const loginUrl = new URL('https://my.neonpanel.com/login');
  loginUrl.searchParams.set('return_to', req.originalUrl);
  
  res.redirect(loginUrl.toString());
});
```

#### B. Add OAuth Token Endpoint

```typescript
app.post('/oauth2/token', express.json(), async (req, res) => {
  const { grant_type, code, redirect_uri, client_id, code_verifier } = req.body;

  if (grant_type === 'authorization_code') {
    // Verify authorization code
    // Verify PKCE code_verifier matches code_challenge
    // Generate access token
    
    res.json({
      access_token: 'generated_access_token',
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: 'generated_refresh_token',
      scope: 'requested_scopes'
    });
  } else if (grant_type === 'refresh_token') {
    // Handle refresh token
    res.json({
      access_token: 'new_access_token',
      token_type: 'Bearer',
      expires_in: 3600
    });
  } else {
    res.status(400).json({
      error: 'unsupported_grant_type'
    });
  }
});
```

### Option 3: Update OAuth Configuration to Use MCP Server Domain

If we implement OAuth on the MCP server, update the configuration:

```typescript
// In src/http/create-app.ts, update /.well-known/oauth-authorization-server

app.get('/.well-known/oauth-authorization-server', (req, res) => {
  // Use the MCP server's own domain instead of my.neonpanel.com
  const baseUrl = `https://${req.get('host')}`;
  
  res.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth2/authorize`,
    token_endpoint: `${baseUrl}/oauth2/token`,
    registration_endpoint: `${baseUrl}/oauth2/register`,
    jwks_uri: `${baseUrl}/.well-known/jwks.json`,
    // ... rest of configuration
  });
});
```

## Immediate Debugging Steps

### 1. Check OAuth Server Availability
```bash
# Test if OAuth endpoints exist
curl -I https://my.neonpanel.com/oauth2/authorize
curl -I https://my.neonpanel.com/oauth2/token
curl -I https://my.neonpanel.com/oauth2/register
```

### 2. Check Redirect URI Configuration
The 400 error often means the `redirect_uri` doesn't match. ChatGPT typically uses:
- `https://chatgpt.com/aip/oauth/callback`
- `https://chat.openai.com/aip/oauth/callback`

### 3. Enable CORS on OAuth Endpoints
If the OAuth server exists, ensure it has CORS headers:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

### 4. Check OAuth Server Logs
Look for errors in `my.neonpanel.com` logs around the time of the callback.

## Quick Fix for Testing

If you want to test the MCP server without OAuth for now:

### Use Bearer Token Directly

1. Get a valid bearer token from NeonPanel
2. Configure ChatGPT to use "API Key" authentication instead of OAuth
3. Use the token directly

However, this won't work with ChatGPT's MCP Connector which requires OAuth.

## Recommended Action

**For immediate testing**: Check if `my.neonpanel.com` has OAuth endpoints configured. If not, we need to either:

1. **Set them up on `my.neonpanel.com`**, OR
2. **Implement OAuth endpoints on the MCP server** (`mcp.neonpanel.com`)

Which approach would you prefer? Let me know and I can implement the necessary changes.

## Additional Notes

The other errors you're seeing (Intercom, preloaded resources) are **ChatGPT frontend warnings** and won't affect the OAuth flow. They're just optimization warnings from ChatGPT's own code.

The critical issue is the **400 error on the OAuth callback**, which needs to be resolved by ensuring:
1. OAuth endpoints exist and work correctly
2. Redirect URIs are properly configured
3. CORS is enabled if needed
4. The OAuth flow completes successfully
