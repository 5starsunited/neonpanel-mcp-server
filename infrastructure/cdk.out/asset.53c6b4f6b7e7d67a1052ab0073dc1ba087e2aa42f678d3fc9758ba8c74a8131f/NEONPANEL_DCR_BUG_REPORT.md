# 🐛 NeonPanel API DCR Bug Report

**Date**: October 16, 2025  
**Status**: ❌ DCR endpoint exists but has critical bug  
**Priority**: HIGH - Blocks ChatGPT integration

---

## 🎯 Summary

The DCR endpoint at `https://my.neonpanel.com/oauth2/register` exists and accepts requests but crashes with an undefined variable error on **every request**.

---

## 🔴 The Bug

**File**: `/var/www/html/modules/Auth/Http/Controllers/OAuth2Controller.php`  
**Line**: 139  
**Error**: `ErrorException: Undefined variable $secretHash`

### Stack Trace (abbreviated)
```
ErrorException: Undefined variable $secretHash 
in file /var/www/html/modules/Auth/Http/Controllers/OAuth2Controller.php 
on line 139

#0 HandleExceptions->handleError(2, 'Undefined varia...', '/var/www/html/m...', 139)
#1 OAuth2Controller.php(139): {closure}(2, 'Undefined varia...', '/var/www/html/m...', 139)
#2 OAuth2Controller->register(Object(OAuth2RegisterRequest))
```

---

## ✅ What's Working

- ✅ Endpoint exists at correct URL
- ✅ Accepts POST requests
- ✅ Initial Access Token (IAT) authentication working
- ✅ Content-Type validation working
- ✅ Request reaches the controller

---

## ❌ What's Broken

- ❌ Line 139 references undefined variable `$secretHash`
- ❌ **ALL** registration requests fail with HTTP 500
- ❌ No successful registrations possible

---

## 🧪 Test Results

Ran comprehensive test suite with 10 different scenarios:

| Test Scenario | Expected | Actual | Result |
|--------------|----------|---------|--------|
| Minimal registration | 201 | 500 | ❌ FAIL |
| Full registration | 201 | 500 | ❌ FAIL |
| client_secret_post | 201 | 500 | ❌ FAIL |
| private_key_jwt + JWKS | 201 | 500 | ❌ FAIL |
| Multiple redirect URIs | 201 | 500 | ❌ FAIL |
| Missing redirect_uris | 400 | 500 | ❌ FAIL |
| Empty redirect_uris | 400 | 500 | ❌ FAIL |
| Invalid redirect_uris | 400 | 500 | ❌ FAIL |
| Client credentials | 201 | 500 | ❌ FAIL |
| Custom scope | 201 | 500 | ❌ FAIL |

**Result**: 0/10 tests passed - ALL fail with same error

---

## 🔧 Likely Cause

The variable `$secretHash` is used on line 139 but:
- Not defined earlier in the function
- Not passed as a parameter
- Not retrieved from the request

### Possible fixes:

1. **If client_secret should be hashed:**
   ```php
   // Before line 139, add:
   $secretHash = hash('sha256', $clientSecret);
   ```

2. **If $secretHash should be $clientSecret:**
   ```php
   // Change line 139 from:
   'client_secret' => $secretHash
   // To:
   'client_secret' => $clientSecret
   ```

3. **If secret is not needed for this flow:**
   ```php
   // Remove or conditionally include the line with $secretHash
   ```

---

## 📋 How to Reproduce

### Test Command
```bash
curl -X POST https://my.neonpanel.com/oauth2/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <IAT_TOKEN>" \
  -d '{
    "redirect_uris": ["https://chat.openai.com/aip/oauth/callback"],
    "client_name": "Test Client"
  }'
```

### Expected Response (HTTP 201)
```json
{
  "client_id": "1145f268-a864-11f0-8a3d-122c1fe52bef",
  "client_id_issued_at": 1760620448,
  "redirect_uris": ["https://chat.openai.com/aip/oauth/callback"],
  "client_name": "Test Client",
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none"
}
```

### Actual Response (HTTP 500)
```html
ErrorException: Undefined variable $secretHash 
in file /var/www/html/modules/Auth/Http/Controllers/OAuth2Controller.php 
on line 139
```

---

## 🎯 What We Need

1. **Fix the undefined variable** on line 139
2. **Test with our test script** to verify all scenarios work
3. **Let us know** when it's deployed so we can verify

---

## 🧪 Testing After Fix

We have a comprehensive test script ready:

```bash
cd /Users/mikesorochev/GitHub Projects/NeonaSphera/providers/neonpanel-mcp
./test-neonpanel-dcr-comprehensive.sh "<NEW_IAT_TOKEN>"
```

This will test:
- ✅ Minimal registration
- ✅ Full registration with all fields
- ✅ Different auth methods (none, client_secret_post, private_key_jwt)
- ✅ Multiple redirect URIs
- ✅ Invalid requests (should return 400)
- ✅ Different grant types

**Target**: 10/10 tests passing

---

## 📞 Contact

When fixed, please:
1. Generate a new IAT token (the current one expires in 15 minutes)
2. Let us know so we can run the full test suite
3. We'll verify and proceed with ChatGPT integration

---

## 📚 References

- **RFC 7591**: Dynamic Client Registration Protocol
- **OpenAI DCR Requirements**: https://platform.openai.com/docs/actions/authentication
- **Our DCR proxy implementation** (for reference): `providers/neonpanel-mcp/src/oauth-endpoints.ts` lines 260-355 (now removed)

---

**Priority**: HIGH - This is the last blocker for ChatGPT MCP integration! 🚀
