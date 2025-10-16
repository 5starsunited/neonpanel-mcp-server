# ChatGPT MCP Connector - Configuration Guide

## ✅ Fixed: "Unsupported authorization header" Error

**Problem:** ChatGPT was getting 401 error when trying to connect to `/mcp` endpoint.

**Solution:** Added Bearer token authentication to `/mcp` endpoint (in addition to `/sse/`).

---

## ChatGPT Workspace MCP Server Configuration

### Step 1: Navigate to MCP Settings
1. Open ChatGPT
2. Go to **Settings** → **Integrations** → **MCP Servers**
3. Click **"Add New MCP Server"** or **"+"**

### Step 2: Enter Server Details

**MCP Server URL:** 
```
https://mcp.neonpanel.com/mcp
```

**Authentication Type:** OAuth 2.0

### Step 3: OAuth Configuration

#### Option A: Dynamic Client Registration (if ChatGPT supports IAT)
- Let ChatGPT auto-discover and register
- ChatGPT will call: `https://my.neonpanel.com/oauth2/register`
- **Issue:** ChatGPT doesn't have IAT token (Initial Access Token)
- **Result:** Registration will fail

#### Option B: Manual OAuth Configuration (Recommended)

**Authorization URL:**
```
https://my.neonpanel.com/oauth2/authorize
```

**Token URL:**
```
https://my.neonpanel.com/oauth2/token
```

**Scopes:** (space-separated)
```
read:inventory read:analytics read:companies read:reports read:warehouses read:revenue read:cogs read:landed-cost write:import
```

**Client ID:** 
```
(Leave empty for now - see below)
```

**Client Secret:**
```
(Leave empty - public client)
```

---

## Problem: ChatGPT Needs a Client ID

ChatGPT requires either:
1. **Dynamic Client Registration** - ChatGPT auto-registers (requires IAT token we don't provide)
2. **Pre-configured Client ID** - You provide existing client credentials

Since ChatGPT can't register without IAT, you need to **manually register a client** first.

---

## Solution: Register Client with IAT Token

### You need an IAT (Initial Access Token) from NeonPanel team

**Step 1: Get IAT Token**
Contact NeonPanel admin to generate IAT with:
- Issuer: `https://my.neonpanel.com`
- Scope: `dcr.create`
- Expiration: 15 minutes

**Step 2: Register Client for ChatGPT**

```bash
# Replace <IAT_TOKEN> with actual token
curl -X POST https://my.neonpanel.com/oauth2/register \
  -H "Authorization: Bearer <IAT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "ChatGPT MCP Connector",
    "redirect_uris": [
      "https://chatgpt.com/aip/callback",
      "https://chat.openai.com/aip/callback"
    ],
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"],
    "token_endpoint_auth_method": "none",
    "scope": "read:inventory read:analytics read:companies read:reports read:warehouses read:revenue read:cogs read:landed-cost write:import"
  }'
```

**Step 3: Save Response**

Response will include:
```json
{
  "client_id": "abc123...",
  "client_secret": null,
  "redirect_uris": [...],
  "grant_types": [...],
  "token_endpoint_auth_method": "none"
}
```

**Step 4: Configure ChatGPT with Client ID**

Go back to ChatGPT MCP settings and enter:
- **Client ID:** `abc123...` (from response)
- **Client Secret:** (leave empty)

---

## Alternative: Use Existing Pre-registered Client

If you have access to NeonPanel admin panel, check for existing OAuth clients:

**Dashboard → OAuth Clients → Look for:**
- Client with `token_endpoint_auth_method = "none"` (public client)
- Redirect URIs include ChatGPT callback URLs
- Scopes include all required MCP scopes

**If found, use that client_id directly in ChatGPT configuration.**

---

## Testing the Connection

### Step 1: Click "Test" or "Connect"
ChatGPT will:
1. Redirect to: `https://my.neonpanel.com/oauth2/authorize?client_id=...`
2. Show NeonPanel login page
3. After login, show authorization consent
4. Redirect back to ChatGPT with authorization code

### Step 2: ChatGPT Exchanges Code for Token
ChatGPT calls:
```
POST https://my.neonpanel.com/oauth2/token
```

With:
- `grant_type=authorization_code`
- `code=<auth_code>`
- `client_id=<your_client_id>`
- `redirect_uri=<chatgpt_callback>`

### Step 3: ChatGPT Connects to MCP Server
ChatGPT calls:
```
GET https://mcp.neonpanel.com/mcp
Authorization: Bearer <access_token>
```

Server responds with SSE stream and MCP protocol initialization.

### Step 4: Test MCP Tools
In ChatGPT, try:
- "List my companies"
- "Show inventory items"
- "Get revenue analytics"

---

## Troubleshooting

### Error: "Unsupported authorization header"
**Status:** ✅ FIXED (as of Oct 16, 2025)

The `/mcp` endpoint now properly accepts Bearer tokens.

### Error: "invalid_client" during OAuth
**Cause:** Client ID doesn't exist or redirect_uri mismatch

**Solution:**
1. Verify client_id is correct
2. Check redirect_uri matches exactly what's registered
3. Register new client with correct ChatGPT callback URLs

### Error: "access_denied" during authorization
**Cause:** User denied consent or insufficient permissions

**Solution:**
1. User must click "Authorize" on consent screen
2. Verify user has access to NeonPanel companies/inventory
3. Check OAuth scopes match user permissions

### Error: "invalid_grant" during token exchange
**Cause:** Authorization code expired or already used

**Solution:**
1. Authorization codes expire in ~10 minutes
2. Restart OAuth flow from beginning
3. Check system clock sync between servers

### ChatGPT Shows "Connection Failed"
**Possible causes:**
1. Missing Bearer token authentication ✅ FIXED
2. CORS headers not allowing Authorization ✅ FIXED
3. Access token expired (get new one via refresh token)
4. Network/firewall blocking SSE connections

**Debug steps:**
```bash
# Test connection manually
curl -N https://mcp.neonpanel.com/mcp \
  -H "Authorization: Bearer <your_token>"

# Should see SSE events:
# event: endpoint
# data: /mcp?sessionId=...
```

---

## Security Notes

### Public Client (No Secret)
ChatGPT uses a **public client** (no client_secret) because:
- Client secret can't be safely stored in browser/frontend
- Uses PKCE (Proof Key for Code Exchange) instead
- Each user authorizes with their own credentials
- Tokens are scoped to individual user permissions

### PKCE Flow
1. ChatGPT generates random `code_verifier`
2. Creates `code_challenge = SHA256(code_verifier)`
3. Sends `code_challenge` in authorization request
4. Sends `code_verifier` in token request
5. Server validates: `SHA256(code_verifier) === code_challenge`
6. Prevents authorization code interception attacks

### Token Security
- Access tokens expire (typically 1 hour)
- Refresh tokens used to get new access tokens
- Each user gets unique tokens
- Tokens never shared between users
- Revoking user access revokes all their tokens

---

## Quick Reference

### URLs
- **MCP Server:** `https://mcp.neonpanel.com/mcp`
- **OAuth Authorize:** `https://my.neonpanel.com/oauth2/authorize`
- **OAuth Token:** `https://my.neonpanel.com/oauth2/token`
- **DCR (register):** `https://my.neonpanel.com/oauth2/register` (requires IAT)

### Required OAuth Scopes
```
read:inventory read:analytics read:companies read:reports read:warehouses read:revenue read:cogs read:landed-cost write:import
```

### ChatGPT Redirect URIs
```
https://chatgpt.com/aip/callback
https://chat.openai.com/aip/callback
```

### MCP Capabilities
- `search` - Search inventory/finance data
- `fetch` - Fetch item details
- `get_inventory_items` - List inventory
- `get_item_cogs` - Get COGS data
- `get_item_landed_cost` - Get landed cost
- `get_revenue_and_cogs` - Revenue analytics

---

## Status: ✅ READY FOR INTEGRATION

**What's Working:**
- ✅ `/mcp` endpoint accepts Bearer tokens
- ✅ CORS allows Authorization header
- ✅ SSE transport established correctly
- ✅ WWW-Authenticate challenge on 401
- ✅ OAuth discovery pointing to NeonPanel
- ✅ All 19 Bearer auth tests passing

**What You Need:**
- [ ] Client ID (via DCR with IAT, or use pre-registered client)
- [ ] ChatGPT MCP connector configuration
- [ ] Test OAuth flow
- [ ] Test tool execution

**Next Step:** Get IAT token from NeonPanel team OR find existing public client ID, then configure ChatGPT.
