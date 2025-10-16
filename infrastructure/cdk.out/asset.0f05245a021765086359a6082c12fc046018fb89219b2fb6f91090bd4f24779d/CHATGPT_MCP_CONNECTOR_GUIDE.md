# ChatGPT MCP Connector Integration Guide

## For ChatGPT Workspace MCP Server Connector

### Quick Setup

**MCP Server URL**: `https://mcp.neonpanel.com`

### Step-by-Step Instructions

1. **Open ChatGPT Workspace**
2. **Go to Settings** → **Integrations** → **MCP Servers**
3. **Add New MCP Server**
   - **Name**: NeonPanel
   - **URL**: `https://mcp.neonpanel.com`
   - **Authentication**: OAuth 2.0

4. **Configure OAuth**:
   - **Client ID**: `1145f268-a864-11f0-8a3d-122c1fe52bef`
   - **Client Secret**: *(leave blank - public client)*
   - **Authorization URL**: `https://my.neonpanel.com/oauth2/authorize`
   - **Token URL**: `https://my.neonpanel.com/oauth2/token`
   - **Scope**: `read:inventory read:analytics read:companies read:reports read:warehouses read:revenue read:cogs read:landed-cost write:import`

5. **Save and Connect**

---

## Troubleshooting "Unsupported authorization header" Error

This error means ChatGPT is trying to use an authentication method that the server doesn't support.

### Possible Causes:

1. **ChatGPT trying to use DCR with IAT** - NeonPanel's DCR requires an Initial Access Token that ChatGPT doesn't have
2. **Wrong authentication endpoint** - ChatGPT might be trying to authenticate against the wrong URL
3. **Missing OAuth discovery** - ChatGPT can't find the OAuth configuration

### Solution 1: Use Pre-Registered Client (RECOMMENDED)

Use the pre-registered public client:
- **Client ID**: `1145f268-a864-11f0-8a3d-122c1fe52bef`
- This client is already configured in NeonPanel
- No DCR needed - bypasses the IAT requirement

### Solution 2: Check MCP Server URL Format

ChatGPT MCP connector expects specific URL patterns:

**Try these URLs:**

1. **Base URL**: `https://mcp.neonpanel.com`
2. **With /mcp**: `https://mcp.neonpanel.com/mcp`
3. **SSE Endpoint**: `https://mcp.neonpanel.com/sse`

### Solution 3: Verify OAuth Discovery

ChatGPT should auto-discover OAuth configuration from:
```
https://mcp.neonpanel.com/.well-known/oauth-authorization-server
```

This returns:
```json
{
  "issuer": "https://my.neonpanel.com",
  "authorization_endpoint": "https://my.neonpanel.com/oauth2/authorize",
  "token_endpoint": "https://my.neonpanel.com/oauth2/token",
  "registration_endpoint": "https://my.neonpanel.com/oauth2/register"
}
```

If ChatGPT sees `registration_endpoint`, it might try to use DCR. The problem is that endpoint requires an IAT token.

---

## Alternative: Manual Client Registration

If the pre-registered client doesn't work, you can register a new client manually.

### Step 1: Get IAT Token from NeonPanel Admin

### Step 2: Register Client

```bash
curl -X POST https://my.neonpanel.com/oauth2/register \
  -H "Authorization: Bearer YOUR_IAT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "ChatGPT MCP Connector",
    "redirect_uris": ["https://chat.openai.com/oauth/callback"],
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"],
    "token_endpoint_auth_method": "none"
  }'
```

### Step 3: Use Returned Client ID

Use the `client_id` from the response in ChatGPT's OAuth configuration.

---

## MCP Server Endpoints

Your MCP server supports these endpoints:

### Discovery Endpoints
- **MCP Info**: `GET /mcp`
- **MCP Capabilities**: `GET /mcp/capabilities`
- **OAuth Discovery**: `GET /.well-known/oauth-authorization-server`
- **OpenAPI Spec**: `GET /openapi.yaml` or `GET /openapi.json`

### MCP Protocol Endpoints
- **SSE Transport**: `GET /sse` (Server-Sent Events for MCP protocol)
- **HTTP Tools**: `POST /mcp/tools/call` (HTTP wrapper for testing)

### Available Capabilities (6 total)

1. **neonpanel.companies** - Company management
2. **neonpanel.warehouses** - Warehouse operations
3. **neonpanel.inventory** - Inventory item operations
4. **neonpanel.analytics** - Revenue and COGS analytics
5. **neonpanel.reports** - Report generation
6. **neonpanel.import** - Document import (bills, PDFs)

**Total Actions**: 11

---

## Testing the Connection

### Test OAuth Flow Manually

1. **Authorization Request**:
```
https://my.neonpanel.com/oauth2/authorize?client_id=1145f268-a864-11f0-8a3d-122c1fe52bef&redirect_uri=https://chat.openai.com/oauth/callback&response_type=code&scope=read:inventory%20read:analytics&state=random_state
```

2. **Login to NeonPanel** and authorize

3. **Exchange Code for Token**:
```bash
curl -X POST https://my.neonpanel.com/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code&code=AUTH_CODE&redirect_uri=https://chat.openai.com/oauth/callback&client_id=1145f268-a864-11f0-8a3d-122c1fe52bef"
```

### Test MCP Capabilities

```bash
curl https://mcp.neonpanel.com/mcp/capabilities | jq '.capabilities[].capability_name'
```

Expected output:
```
neonpanel.companies
neonpanel.warehouses
neonpanel.inventory
neonpanel.analytics
neonpanel.reports
neonpanel.import
```

---

## What ChatGPT Can Do Once Connected

1. **List Companies**: Access all your NeonPanel companies
2. **Manage Warehouses**: View warehouse information
3. **Search Inventory**: Find products by SKU, ASIN, or FNSKU
4. **Get COGS**: Retrieve cost of goods sold data
5. **Get Landed Costs**: Calculate manufacturing expenses
6. **Revenue Analytics**: Analyze revenue and COGS by period
7. **Generate Reports**: Access NeonPanel reports
8. **Import Documents**: Upload bills and invoices

---

## Next Steps if Still Getting Error

1. **Check MCP Server URL** - Try different URL formats:
   - `https://mcp.neonpanel.com`
   - `https://mcp.neonpanel.com/mcp`
   - `https://mcp.neonpanel.com/sse`

2. **Verify OAuth Client Configuration** - Double-check all OAuth settings

3. **Try SSE Endpoint Directly** - Some MCP connectors expect SSE: `https://mcp.neonpanel.com/sse`

4. **Check ChatGPT Console** - Look for more detailed error messages in browser developer tools

5. **Contact Support** - Provide this error to ChatGPT support: `"invalid_token","error_description":"Unsupported authorization header"`

---

**Last Updated**: October 16, 2025  
**MCP Server Status**: ✅ Online at https://mcp.neonpanel.com  
**OAuth Status**: ✅ Working with pre-registered client  
**DCR Status**: ✅ Available at https://my.neonpanel.com/oauth2/register (requires IAT)
