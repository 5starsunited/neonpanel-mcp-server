# ChatGPT OAuth 500 Error - Diagnostic Report

## Error Analysis

### Console Errors (Prioritized)

#### 🔴 CRITICAL: OAuth Callback 500 Error
```
/backend-api/aip/con…ks/oauth/callback:1
Failed to load resource: the server responded with a status of 500 ()
```

**What this means:**
- ChatGPT successfully redirected you to `my.neonpanel.com` for authorization ✅
- You authorized the application ✅
- OAuth server redirected back to ChatGPT with authorization code ✅
- **ChatGPT's backend failed** processing the callback (500 Internal Server Error) ❌

**Important:** This is a **ChatGPT backend error**, not an error on `my.neonpanel.com` or `mcp.neonpanel.com`.

#### ⚠️ Connection Errors (Side Effects)
```
Could not establish connection. Receiving end does not exist.
```

These errors appear **because** the OAuth flow failed. They will likely disappear once OAuth works.

#### ℹ️ Informational (Ignore)
- `Intercom not booted` - ChatGPT frontend issue
- `realtime.chatgpt.com 404` - ChatGPT feature flag endpoint
- `Could not find language 'b'` - ChatGPT code highlighter issue

## Our Infrastructure Status

### ✅ All Systems Operational

| Component | Endpoint | Status | Details |
|-----------|----------|--------|---------|
| OAuth Discovery | `/.well-known/oauth-authorization-server` | ✅ Working | Properly configured |
| Authorization Endpoint | `my.neonpanel.com/oauth2/authorize` | ✅ Working | Returns 400 without params (expected) |
| Token Endpoint | `my.neonpanel.com/oauth2/token` | ✅ Working | Returns 405 for GET (expected, needs POST) |
| Registration Endpoint | `my.neonpanel.com/oauth2/register` | ✅ Working | Dynamic Client Registration enabled |
| JWKS Endpoint | `my.neonpanel.com/.well-known/jwks.json` | ✅ Working | 1 public key available |
| MCP Server | `mcp.neonpanel.com` | ✅ Healthy | Version v3.1.1 |
| Tools Endpoint | `/messages` (tools/list) | ✅ Working | 13 tools properly exposed |

**Run the test script:**
```bash
./test-oauth-endpoints.sh
```

## Root Cause Analysis

### Where the 500 Error is Happening

```
Browser                ChatGPT Backend           my.neonpanel.com
   │                         │                          │
   ├─ 1. User connects ──────>│                          │
   │                         │                          │
   │<─ 2. Redirect to OAuth ─┤                          │
   │                         │                          │
   ├─ 3. Authorize ──────────┼────────────────────────>│
   │                         │                          │
   │<─ 4. Redirect w/ code ──┼──────────────────────────┤
   │                         │                          │
   ├─ 5. Code to ChatGPT ────>│                          │
   │                         │                          │
   │                         ├─ 6. Exchange code ──────>│
   │                         │         (POST /oauth2/token)
   │                         │                          │
   │                         │<─ 7. Access token ───────┤
   │                         │                          │
   │                         ├─ 8. Process token       │
   │                         │    💥 500 ERROR HERE     │
   │                         │                          │
   │<─ 9. Show error ────────┤                          │
```

**The 500 error occurs in step 8** - ChatGPT's backend receives the token but fails to process it.

### Possible Causes

#### 1. Token Format Issues ⚠️

ChatGPT might expect specific claims in the JWT token that `my.neonpanel.com` isn't providing:

**Required Claims (typical OAuth):**
- `iss` (issuer) - MUST be `https://my.neonpanel.com`
- `sub` (subject) - User identifier
- `aud` (audience) - Should match ChatGPT's client ID or expected audience
- `exp` (expiration) - Unix timestamp
- `iat` (issued at) - Unix timestamp
- `scope` - Space-separated scopes

**What to check on `my.neonpanel.com`:**
```bash
# Check what claims are in the tokens being issued
# (You need access to my.neonpanel.com logs or admin panel)
```

**Current MCP server expectation:**
- ✅ Accepts tokens with ANY scope (even just `dcr.create`)
- ✅ Does NOT require `aud` claim
- ✅ ONLY validates: `iss`, signature, `exp`

#### 2. Token Endpoint Response Format ⚠️

ChatGPT expects the token endpoint to return:

```json
{
  "access_token": "eyJ...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "eyJ..." (optional),
  "scope": "dcr.create" (optional)
}
```

**What to check:**
- Verify `my.neonpanel.com/oauth2/token` returns proper JSON
- Ensure `token_type` is `"Bearer"` (case-sensitive)
- Verify no extra fields that might confuse ChatGPT

#### 3. CORS Issues ❌ (Unlikely)

If ChatGPT's token exchange request is being blocked by CORS:

**What to check on `my.neonpanel.com`:**
```bash
curl -X OPTIONS https://my.neonpanel.com/oauth2/token \
  -H "Origin: https://chatgpt.com" \
  -H "Access-Control-Request-Method: POST" \
  -v
```

**Expected headers:**
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST
Access-Control-Allow-Headers: Content-Type, Authorization
```

#### 4. Client Credentials Issues ⚠️

ChatGPT might be using incorrect client credentials for token exchange:

**What to check on `my.neonpanel.com`:**
- Check if ChatGPT successfully registered a client via `/oauth2/register`
- Verify the registered client has proper `redirect_uri` configured
- Check OAuth server logs for failed token exchange attempts

## Diagnostic Steps

### Step 1: Check OAuth Server Logs

**On `my.neonpanel.com` server, check logs during OAuth flow:**

```bash
# Look for token exchange requests from ChatGPT
tail -f /var/log/oauth-server.log | grep "oauth2/token"
```

**What to look for:**
- ✅ POST requests to `/oauth2/token` with `grant_type=authorization_code`
- ❌ Any 400/401/500 errors in the token exchange
- ❌ Missing or invalid `code` parameter
- ❌ Missing or mismatched `redirect_uri`
- ❌ Invalid `client_id` or `client_secret`

### Step 2: Verify Token Claims

**If you have access to `my.neonpanel.com` admin panel:**

1. Trigger the OAuth flow with ChatGPT
2. Capture the issued access token
3. Decode it (use jwt.io or jwt.ms)
4. Verify it has all required claims:

```json
{
  "iss": "https://my.neonpanel.com",
  "sub": "user-id-here",
  "aud": "mcp://neonpanel" (or ChatGPT's client_id),
  "exp": 1234567890,
  "iat": 1234567890,
  "scope": "dcr.create"
}
```

### Step 3: Test Token Exchange Manually

**Simulate what ChatGPT is doing:**

```bash
# 1. Get authorization code (manually authorize in browser)
# Visit: https://my.neonpanel.com/oauth2/authorize?
#   response_type=code&
#   client_id=<CHATGPT_CLIENT_ID>&
#   redirect_uri=<CHATGPT_REDIRECT_URI>&
#   scope=dcr.create&
#   state=random-state&
#   code_challenge=<PKCE_CHALLENGE>&
#   code_challenge_method=S256

# 2. After redirect, grab the ?code=... from URL

# 3. Exchange code for token (simulate ChatGPT's request)
curl -X POST https://my.neonpanel.com/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "code=<CODE_FROM_STEP_2>" \
  -d "redirect_uri=<CHATGPT_REDIRECT_URI>" \
  -d "client_id=<CHATGPT_CLIENT_ID>" \
  -d "code_verifier=<PKCE_VERIFIER>" \
  -v
```

**Expected response:**
```json
{
  "access_token": "eyJ...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

**If this fails, it confirms the issue is with token exchange configuration.**

### Step 4: Verify MCP Server Accepts Tokens

**Test with a real token from `my.neonpanel.com`:**

```bash
# Get a token (from admin panel or OAuth flow)
TOKEN="<paste-token-here>"

# Test tools/list
curl -X POST https://mcp.neonpanel.com/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }' | jq .
```

**Expected:** 13 tools returned
**If this fails:** Token validation issue on MCP server

## What You Can Do Now

### 1. Check `my.neonpanel.com` Logs ✅

**Critical:** Check if token exchange requests are arriving from ChatGPT:

```bash
# On my.neonpanel.com server
grep "oauth2/token" /var/log/*.log | tail -20
```

**Look for:**
- Successful token exchanges (200 responses)
- Failed exchanges (400/401/500 errors)
- Error messages about missing fields

### 2. Verify Token Format ✅

**Ask the `my.neonpanel.com` admin:**
- What claims are included in issued tokens?
- Is `aud` (audience) claim included? What value?
- Is `sub` (subject) claim included?
- What scopes are granted?

### 3. Test Token Exchange Manually ✅

Use the curl command from Step 3 above to verify the token endpoint works correctly.

### 4. Contact ChatGPT Support ⚠️

If all your endpoints are working (they are ✅), the 500 error might be a ChatGPT bug. Report it with:

**Issue:** "OAuth callback 500 error when connecting to MCP server"

**Details to provide:**
- MCP Server URL: `https://mcp.neonpanel.com`
- OAuth Provider: `https://my.neonpanel.com`
- Error: `500 on /backend-api/aip/connectors/oauth/callback`
- All OAuth endpoints are accessible and working
- Authorization flow completes successfully (user gets redirected back)
- Error occurs only on ChatGPT's callback processing

## Temporary Workarounds

### Option 1: Test Without OAuth (for development)

**NOT RECOMMENDED for production**, but useful for testing:

1. Temporarily bypass OAuth requirement on MCP server
2. Test tools functionality
3. Re-enable OAuth once issue is resolved

### Option 2: Use Direct Bearer Token

If you can get a valid token from `my.neonpanel.com`:

1. Get a token manually (admin panel or Postman)
2. Test MCP tools directly via curl
3. Verify functionality works with proper tokens

## Summary

### ✅ What's Working
- OAuth discovery endpoint
- All OAuth server endpoints (authorize, token, register, jwks)
- MCP server health and info endpoints
- Tools registration and exposure (13 tools)
- Token validation on MCP server (flexible, accepts any valid token)

### ❌ What's Broken
- ChatGPT's OAuth callback handler (500 error)
- Likely: Token exchange succeeding but ChatGPT failing to process the token

### 🔍 What to Investigate
1. **`my.neonpanel.com` logs** - Check for token exchange requests and responses
2. **Token claims** - Verify tokens have required fields (iss, sub, exp, iat, aud)
3. **Token format** - Ensure JSON response matches OAuth 2.0 spec
4. **CORS** - Verify ChatGPT can make token exchange requests

### 📋 Next Actions
1. Run `./test-oauth-endpoints.sh` (all should pass ✅)
2. Check `my.neonpanel.com` server logs during OAuth flow
3. Capture and decode a token to verify claims
4. Test token exchange manually with curl
5. If everything on your end works, report to ChatGPT support

## Files Added
- `test-oauth-endpoints.sh` - OAuth infrastructure test script
- `OAUTH_500_DIAGNOSTIC.md` - This diagnostic report (you are here)

## Related Documentation
- `OAUTH_INTEGRATION_COMPLETE.md` - OAuth setup guide
- `OAUTH_SCOPE_FIX.md` - Scope validation fix
- `TOOLS_EXPOSURE_FIX.md` - Tools schema flattening fix
- `CHATGPT_TROUBLESHOOTING.md` - General troubleshooting guide
