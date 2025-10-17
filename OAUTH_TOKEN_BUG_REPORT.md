# OAuth Flow Bug Report

**Date**: October 17, 2025  
**Severity**: 🔴 **CRITICAL** - Blocks ChatGPT MCP integration

---

# OAuth Flow Bug Report - CORRECTED

**Date**: October 17, 2025  
**Status**: ⚠️ **TESTING IN PROGRESS** - Initial bug report was based on incorrect test

---

## Update: Initial Analysis Was Wrong!

### What I Thought
The OAuth server couldn't extract `client_id` from Basic Authentication header.

### What's Actually Happening
**ChatGPT uses PUBLIC clients with PKCE** - it sends `client_id` as a **form parameter**, NOT in Basic Auth!

```json
// From chatgpt-client-credentials.json:
{
  "token_endpoint_auth_method": "none",  // ← NO authentication!
  "client_id": "a89c4bddd6444d64a0962564e7950b7e04834690"
  // No client_secret!
}
```

### Correct Token Exchange Request

```bash
# ✅ CORRECT - Public client with PKCE
POST /oauth2/token HTTP/1.1
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&client_id=a89c4bddd6444d64a0962564e7950b7e04834690  # ← As form parameter
&code=<AUTHORIZATION_CODE>
&redirect_uri=https://chat.openai.com/aip/g/callback
&code_verifier=<CODE_VERIFIER>  # ← PKCE proof
```

```bash
# ❌ WRONG - What I was testing (confidential client)
POST /oauth2/token HTTP/1.1
Authorization: Basic base64(client_id:client_secret)  # ← Not used for public clients!
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=<AUTHORIZATION_CODE>
&redirect_uri=https://chat.openai.com/aip/g/callback
&code_verifier=<CODE_VERIFIER>
```

---

## Public vs Confidential Clients

### Public Client (ChatGPT MCP) ✅
- **No client_secret**
- **PKCE required** (code_challenge/code_verifier)
- **client_id in form data**
- `token_endpoint_auth_method: "none"`

### Confidential Client (Server-to-Server)
- **Has client_secret**
- **PKCE optional**
- **Basic Auth OR form data**
- `token_endpoint_auth_method: "client_secret_basic"` or `"client_secret_post"`

---

## Summary / Резюме

---

## Bug Details

### Error Message
```
TypeError: Neonpanel\Auth\Database\Repositories\OAuth2\ClientRepository::firstByClientId(): 
Argument #1 ($clientId) must be of type string, null given
```

### Location
**File**: `/var/www/html/modules/Auth/Database/Repositories/OAuth2/ClientRepository.php`  
**Line**: 15  
**Called from**: `/var/www/html/modules/Auth/Http/Controllers/OAuth2TokenController.php` (line 138)

### Request That Failed
```bash
POST https://my.neonpanel.com/oauth2/token
Content-Type: application/x-www-form-urlencoded
Authorization: Basic YTg5YzRiZGRkNjQ0NGQ2NGEwOTYyNTY0ZTc5NTBiN2UwNDgzNDY5MDpudWxs

grant_type=authorization_code
&code=<AUTHORIZATION_CODE>
&redirect_uri=https://chat.openai.com/aip/g/callback
&code_verifier=<CODE_VERIFIER>
```

### Expected Behavior
The OAuth server should:
1. Extract `client_id` and `client_secret` from the `Authorization: Basic` header
2. Decode the Base64 credentials
3. Parse `client_id:client_secret`
4. Call `ClientRepository::firstByClientId($clientId)` with the extracted string

### Actual Behavior
- Server fails to extract `client_id` from Basic Auth
- Passes `null` to `firstByClientId()`
- PHP TypeError thrown
- **Returns HTML error page instead of JSON** (violates OAuth 2.0 spec)

---

## Impact

### ❌ What's Broken
- Token exchange completely fails
- ChatGPT cannot complete OAuth flow
- MCP integration cannot authenticate
- No tools can be executed

### ✅ What Works
- OAuth discovery endpoint (https://my.neonpanel.com/.well-known/oauth-authorization-server)
- Client registration (DCR)
- Authorization endpoint (user can authorize)
- Authorization code is generated
- MCP server public discovery (tools/list, initialize)

---

## Root Cause

The `OAuth2TokenController` is not properly extracting credentials from the `Authorization: Basic` header.

### Possible Issues

1. **Missing Basic Auth Parsing**
   ```php
   // Likely missing in OAuth2TokenController::handleAuthorizationCode()
   $authHeader = $request->header('Authorization');
   // Not extracting: base64_decode(substr($authHeader, 6))
   // Not splitting: explode(':', $credentials)
   ```

2. **Expecting Client Credentials in POST Body**
   - Server might expect `client_id` and `client_secret` in the request body
   - But RFC 6749 allows Basic Auth (which is more secure)

3. **Middleware Issue**
   - Basic Auth middleware not configured for `/oauth2/token`
   - Request credentials not being populated in `$request`

---

## How To Fix

### Option 1: Fix Basic Auth Parsing (Recommended)

**File**: `modules/Auth/Http/Controllers/OAuth2TokenController.php`

```php
protected function handleAuthorizationCode(Request $request, array $params)
{
    // Extract client credentials from Authorization header
    $authHeader = $request->header('Authorization');
    
    if ($authHeader && strpos($authHeader, 'Basic ') === 0) {
        $credentials = base64_decode(substr($authHeader, 6));
        list($clientId, $clientSecret) = explode(':', $credentials, 2);
    } else {
        // Fall back to POST body
        $clientId = $request->input('client_id');
        $clientSecret = $request->input('client_secret');
    }
    
    // Now clientId is guaranteed to be a string or null (which should error properly)
    $client = $this->clientRepository->firstByClientId($clientId);
    
    // ... rest of the code
}
```

### Option 2: Support Both Methods

```php
protected function extractClientCredentials(Request $request): array
{
    // Try Basic Auth first (more secure)
    $authHeader = $request->header('Authorization');
    if ($authHeader && str_starts_with($authHeader, 'Basic ')) {
        $encoded = substr($authHeader, 6);
        $decoded = base64_decode($encoded);
        if ($decoded && str_contains($decoded, ':')) {
            [$clientId, $clientSecret] = explode(':', $decoded, 2);
            return compact('clientId', 'clientSecret');
        }
    }
    
    // Fall back to POST body
    return [
        'clientId' => $request->input('client_id'),
        'clientSecret' => $request->input('client_secret'),
    ];
}
```

### Option 3: Return Proper OAuth Error (Also Needed)

**The server MUST return JSON errors, not HTML**:

```php
// In exception handler or OAuth controller
if ($request->is('oauth2/*')) {
    return response()->json([
        'error' => 'invalid_client',
        'error_description' => 'Client authentication failed',
    ], 401);
}
```

---

## Testing

### Before Fix
```bash
curl -X POST https://my.neonpanel.com/oauth2/token \
  -u "CLIENT_ID:CLIENT_SECRET" \
  -d "grant_type=authorization_code" \
  -d "code=AUTH_CODE" \
  -d "redirect_uri=https://chat.openai.com/aip/g/callback" \
  -d "code_verifier=VERIFIER"

# Returns: HTML error page with TypeError
```

### After Fix (Expected)
```bash
curl -X POST https://my.neonpanel.com/oauth2/token \
  -u "CLIENT_ID:CLIENT_SECRET" \
  -d "grant_type=authorization_code" \
  -d "code=AUTH_CODE" \
  -d "redirect_uri=https://chat.openai.com/aip/g/callback" \
  -d "code_verifier=VERIFIER"

# Returns: JSON with access_token
{
  "access_token": "eyJ...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "...",
  "scope": "dcr.create"
}
```

---

## Reproduction Steps

1. Run the end-to-end test script:
   ```bash
   ./complete-oauth-test.sh
   ```

2. Open the authorization URL in browser

3. Authorize the application

4. Copy the authorization code from the redirect

5. Paste into the script

6. **Observe**: TypeError returned as HTML instead of access token as JSON

---

## Related Files

### On my.neonpanel.com
- `modules/Auth/Http/Controllers/OAuth2TokenController.php` (line 138)
- `modules/Auth/Database/Repositories/OAuth2/ClientRepository.php` (line 15)
- Possible missing middleware: `modules/Auth/Http/Middleware/ParseBasicAuth.php` (?)

### Test Scripts (This Repo)
- `complete-oauth-test.sh` - Full OAuth flow test
- `test-chatgpt-flow.sh` - Comprehensive ChatGPT flow simulator
- `test-oauth-endpoints.sh` - OAuth infrastructure tests (all passing except token exchange)

---

## Stack Trace

```
TypeError: Neonpanel\Auth\Database\Repositories\OAuth2\ClientRepository::firstByClientId(): 
Argument #1 ($clientId) must be of type string, null given

Called at:
#0 OAuth2TokenController.php(138): ClientRepository->firstByClientId(NULL)
#1 OAuth2TokenController.php(44): handleAuthorizationCode(Request, Array)
#2 ControllerDispatcher.php(46): token(Request)
#3 Route.php(262): dispatch()
```

---

## Why Basic Auth Instead of Query Parameters?

### Security Best Practices

**Query parameters are inherently insecure for credentials**:

1. **Logged Everywhere** 🔴
   ```bash
   # Query params appear in:
   # - Web server access logs (nginx, Apache)
   # - Application logs
   # - Proxy/CDN logs (Cloudflare, etc.)
   # - Load balancer logs
   # - Browser history
   # - Browser cache
   # - Referer headers
   ```

2. **Basic Auth Headers Are NOT Logged** ✅
   ```bash
   # Standard web servers don't log Authorization headers
   # Only the request line is logged:
   # "POST /oauth2/token HTTP/1.1" 200
   ```

3. **URL Sharing Risk** 🔴
   ```
   # Someone copies URL to send to colleague:
   https://api.example.com/oauth?client_secret=abc123
   # Secret is now in Slack, email, etc.
   ```

### OAuth 2.0 Client Authentication Methods

**RFC 6749 Section 2.3.1** defines three methods (in order of security):

#### 1. Basic Authentication (Most Secure) ⭐
```http
POST /oauth2/token HTTP/1.1
Authorization: Basic YWJjMTIzOnNlY3JldDEyMw==
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code=xyz
```
- **Pros**: Not logged, not cached, not in history
- **Cons**: None
- **Used by**: ChatGPT, GitHub, Stripe, most OAuth clients

#### 2. POST Body (Acceptable)
```http
POST /oauth2/token HTTP/1.1
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code=xyz&client_id=abc&client_secret=secret
```
- **Pros**: Not in URL
- **Cons**: May appear in application logs
- **Used by**: Some legacy clients

#### 3. Query Parameters (Discouraged) ❌
```http
POST /oauth2/token?client_id=abc&client_secret=secret HTTP/1.1

grant_type=authorization_code&code=xyz
```
- **Pros**: None
- **Cons**: Logged everywhere, major security risk
- **Used by**: Almost nobody (violates security best practices)

### Industry Standard

**All major OAuth providers require Basic Auth**:
- ✅ Google OAuth
- ✅ GitHub OAuth
- ✅ Microsoft Azure AD
- ✅ Auth0
- ✅ Okta
- ✅ Stripe

## OAuth 2.0 Spec Compliance

### Violated RFCs

1. **RFC 6749 Section 5.2** - Token Endpoint Error Response
   > The authorization server MUST return errors as JSON

2. **RFC 2617** - HTTP Basic Authentication
   > Clients MAY use the HTTP Basic authentication scheme to authenticate with the authorization server

3. **RFC 6749 Section 2.3.1** - Client Password (Most Important)
   > The authorization server MUST support the HTTP Basic authentication scheme for authenticating clients that were issued a client password.
   
   ⚠️ **This is a MUST requirement, not optional**

---

## Priority

🔴 **CRITICAL** - This blocks the entire ChatGPT MCP integration.

### Why Critical?
- Without token exchange, ChatGPT cannot get an access token
- Without an access token, no tools can be executed
- The entire MCP server is useless without working OAuth
- Affects all MCP clients that use Basic Auth (industry standard)

---

## Recommendations

1. **Immediate**: Fix Basic Auth extraction in `OAuth2TokenController`
2. **Immediate**: Return JSON errors from OAuth endpoints
3. **Soon**: Add integration tests for OAuth token endpoint
4. **Soon**: Test with multiple auth methods (Basic Auth + POST body)
5. **Future**: Consider using a battle-tested OAuth library (Laravel Passport/Sanctum)

---

## Next Steps

1. ✅ Bug identified and documented
2. ⏳ Fix Basic Auth parsing on my.neonpanel.com
3. ⏳ Deploy fix to production
4. ⏳ Run `./complete-oauth-test.sh` to verify
5. ⏳ Test with ChatGPT MCP Connector
6. ⏳ Celebrate 🎉

---

**Contact**: Mike Sorochev  
**Repo**: https://github.com/5starsunited/neonpanel-mcp-server  
**Date**: October 17, 2025
