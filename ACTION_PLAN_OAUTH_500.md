# 🔍 Action Plan: Fix ChatGPT OAuth 500 Error

## The Problem

**Error:** `500 on /backend-api/aip/connectors/oauth/callback`

**Where:** ChatGPT's backend (after OAuth redirect from my.neonpanel.com)

**Impact:** OAuth flow completes but fails at the final step, preventing MCP connection

## What We Know ✅

### Our Infrastructure is Working
- ✅ MCP Server (`mcp.neonpanel.com`) - Healthy, v3.1.1
- ✅ OAuth Discovery - Properly configured
- ✅ 13 Tools - Properly exposed with flat schemas
- ✅ Token Validation - Accepts any valid token from my.neonpanel.com

### OAuth Flow So Far
1. ✅ ChatGPT discovers OAuth endpoints
2. ✅ User redirects to my.neonpanel.com for authorization
3. ✅ User authorizes the application
4. ✅ my.neonpanel.com redirects back to ChatGPT with authorization code
5. ❓ ChatGPT exchanges code for token at my.neonpanel.com
6. ❌ ChatGPT's callback handler crashes with 500 error

## What to Check on `my.neonpanel.com`

### 1. Server Logs (CRITICAL)

**Check if token exchange requests are arriving:**

```bash
# SSH into my.neonpanel.com server
ssh your-server

# Check OAuth server logs
tail -f /var/log/oauth/*.log | grep "oauth2/token"

# Or if using Laravel:
tail -f storage/logs/laravel.log | grep "oauth2/token"

# Look for recent requests
grep "oauth2/token" /var/log/*.log | tail -50
```

**What to look for:**
- ✅ POST requests from ChatGPT to `/oauth2/token`
- ❌ 400/401/500 errors in token exchange
- ❌ Missing parameters (code, redirect_uri, client_id)
- ❌ PKCE verification failures
- ❌ Invalid authorization code

### 2. Token Response Format

**The token endpoint MUST return:**

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "optional-refresh-token",
  "scope": "dcr.create"
}
```

**Common mistakes:**
- ❌ `token_type` is lowercase `"bearer"` (should be `"Bearer"`)
- ❌ Missing `expires_in` field
- ❌ Extra fields that ChatGPT doesn't expect
- ❌ Returning HTML error page instead of JSON

**How to verify:**
```bash
# On my.neonpanel.com server, check token controller
# Example for Laravel:
cat app/Http/Controllers/OAuth2/TokenController.php
```

### 3. JWT Token Claims

**The access_token JWT MUST include:**

```json
{
  "iss": "https://my.neonpanel.com",
  "sub": "user-12345",
  "aud": "chatgpt-client-id-or-mcp-audience",
  "exp": 1729180000,
  "iat": 1729176400,
  "scope": "dcr.create"
}
```

**How to verify:**
1. Get a token from the OAuth flow
2. Decode it at https://jwt.io
3. Check all claims are present

### 4. PKCE Verification

**ChatGPT uses PKCE (Proof Key for Code Exchange):**

1. ChatGPT sends `code_challenge` in authorization request
2. ChatGPT sends `code_verifier` in token exchange
3. Server must verify: `SHA256(code_verifier) == code_challenge`

**Check if PKCE is enabled:**
```bash
# On my.neonpanel.com
# Check OAuth configuration
cat config/oauth.php | grep -i pkce
```

### 5. Redirect URI Validation

**The redirect_uri in token exchange MUST exactly match authorization request:**

```
Authorization: redirect_uri=https://chatgpt.com/backend-api/aip/connectors/oauth/callback
Token Exchange: redirect_uri=https://chatgpt.com/backend-api/aip/connectors/oauth/callback
```

**Common issues:**
- ❌ Trailing slash mismatch
- ❌ HTTP vs HTTPS
- ❌ Different subdomain
- ❌ Different path

**How to check:**
```bash
# Check registered clients
# Example SQL query:
SELECT id, name, redirect FROM oauth_clients WHERE name LIKE '%chatgpt%';
```

### 6. Client Authentication

**ChatGPT might be using one of these methods:**

**Option A: No client secret** (`token_endpoint_auth_methods_supported: ["none"]`)
```bash
POST /oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&
code=abc123&
redirect_uri=https://chatgpt.com/...&
client_id=chatgpt-client-id&
code_verifier=xyz789
```

**Option B: Client secret (Basic Auth)**
```bash
POST /oauth2/token
Authorization: Basic base64(client_id:client_secret)
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&
code=abc123&
redirect_uri=https://chatgpt.com/...&
code_verifier=xyz789
```

**How to check:**
```bash
# Look at the Authorization header in token exchange requests
# In server logs
```

## Testing Checklist

### ☑️ Run These Commands

```bash
# 1. Verify all our endpoints (should all pass ✅)
./test-oauth-endpoints.sh

# 2. Check my.neonpanel.com is accessible from public internet
curl -I https://my.neonpanel.com/oauth2/token

# 3. Verify JWKS endpoint returns keys
curl -s https://my.neonpanel.com/.well-known/jwks.json | jq .

# 4. Test CORS (if needed)
curl -X OPTIONS https://my.neonpanel.com/oauth2/token \
  -H "Origin: https://chatgpt.com" \
  -H "Access-Control-Request-Method: POST" \
  -v
```

### ☑️ Manual Token Exchange Test

**Simulate what ChatGPT is doing:**

```bash
# Step 1: Authorize manually in browser
# Visit this URL (replace CLIENT_ID):
https://my.neonpanel.com/oauth2/authorize?response_type=code&client_id=YOUR_CLIENT_ID&redirect_uri=http://localhost:8000/callback&scope=dcr.create&state=test123&code_challenge=CHALLENGE&code_challenge_method=S256

# Step 2: After redirect, grab the code from URL
# Example: http://localhost:8000/callback?code=ABC123&state=test123

# Step 3: Exchange code for token
curl -X POST https://my.neonpanel.com/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "code=ABC123" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "redirect_uri=http://localhost:8000/callback" \
  -d "code_verifier=VERIFIER" \
  -v

# Expected response:
# {
#   "access_token": "eyJ...",
#   "token_type": "Bearer",
#   "expires_in": 3600
# }
```

## Common Issues & Fixes

### Issue 1: Authorization Code Already Used
**Error:** `invalid_grant` or `authorization code has been used`

**Fix:** Authorization codes are single-use. Need to generate a new one for each test.

### Issue 2: Code Expired
**Error:** `invalid_grant` or `authorization code expired`

**Fix:** Codes typically expire after 60 seconds. Complete token exchange faster.

### Issue 3: PKCE Verification Failed
**Error:** `invalid_request` or `code_verifier does not match code_challenge`

**Fix:** 
- Ensure PKCE is properly implemented
- Verify `SHA256(code_verifier) == code_challenge`
- Check code_verifier is sent in token exchange

### Issue 4: Invalid Redirect URI
**Error:** `invalid_grant` or `redirect_uri mismatch`

**Fix:**
- Ensure exact match (including trailing slash)
- Check registered redirect URIs for the client
- Verify ChatGPT's redirect URI is whitelisted

### Issue 5: Token Format Invalid
**Error:** ChatGPT 500 but my.neonpanel.com logs show 200

**Fix:**
- Verify token response is valid JSON
- Ensure `token_type` is `"Bearer"` (capital B)
- Check all required fields are present
- Decode JWT to verify claims

## Next Steps

### Immediate Actions

1. **Check my.neonpanel.com logs** (during next OAuth attempt)
   ```bash
   ssh your-server
   tail -f /var/log/oauth/*.log
   # Then try connecting in ChatGPT
   ```

2. **Capture token exchange request**
   - Look for POST to `/oauth2/token`
   - Check request parameters
   - Check response status and body

3. **Verify token claims**
   - Get an access token from the logs
   - Decode at https://jwt.io
   - Verify all required claims present

### If Logs Show Errors

**If 400/401 on token exchange:**
- ❌ Client credentials wrong
- ❌ Code invalid/expired
- ❌ Redirect URI mismatch
- ❌ PKCE verification failed

**Fix:** Check client configuration, enable better logging

**If 200 on token exchange:**
- ✅ Token issued successfully
- ❌ ChatGPT failing to process token
- ❌ Token format/claims issue

**Fix:** Verify token format matches OAuth 2.0 spec

### If Logs Show Success

**If token exchange shows 200 in logs but ChatGPT still shows 500:**

This means ChatGPT received the token but failed to:
1. Validate the token signature
2. Parse the token claims
3. Store the token for later use

**Possible causes:**
- JWKS endpoint not accessible from ChatGPT
- Token signature algorithm mismatch (we advertise RS256)
- Missing required claims in token
- Token format doesn't match ChatGPT's expectations

**To verify:**
```bash
# Ensure JWKS is publicly accessible
curl -s https://my.neonpanel.com/.well-known/jwks.json

# Verify JWT can be validated
# Use the access token from logs and verify at jwt.io
```

## Summary

### ✅ What's Working
- MCP server infrastructure
- OAuth discovery
- Tools exposure (13 tools)
- Token validation on MCP server

### ❓ What to Check
1. **my.neonpanel.com server logs** during OAuth flow
2. **Token exchange** - is it succeeding or failing?
3. **Token format** - does it match OAuth 2.0 spec?
4. **Token claims** - are all required fields present?

### 🎯 Expected Outcome

After checking logs, you should find one of:

**Scenario A:** Token exchange failing (400/401)
→ Fix client config, PKCE, redirect URI

**Scenario B:** Token exchange succeeding (200) but wrong format
→ Fix token response JSON structure

**Scenario C:** Everything working on my.neonpanel.com
→ Report to ChatGPT support (their bug)

## Files to Reference

- `test-oauth-endpoints.sh` - Test all OAuth endpoints
- `OAUTH_500_DIAGNOSTIC.md` - Detailed diagnostic guide
- `OAUTH_INTEGRATION_COMPLETE.md` - OAuth setup documentation

---

**Start here:** Check `my.neonpanel.com` logs during next OAuth connection attempt! 🔍
