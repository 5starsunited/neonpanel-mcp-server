# ChatGPT MCP Connector - Setup Guide

## Overview
This guide explains how to connect the NeonPanel MCP Server to ChatGPT using the MCP Connector.

## Server Information

**MCP Server URL:** `https://mcp.neonpanel.com`

## Prerequisites

1. **NeonPanel Account**: You need an active NeonPanel account at https://my.neonpanel.com
2. **OAuth Client Registration**: Register your ChatGPT client with NeonPanel's OAuth server

## OAuth Configuration

The MCP server exposes OAuth 2.0 Authorization Server Metadata at:
```
https://mcp.neonpanel.com/.well-known/oauth-authorization-server
```

### OAuth Endpoints

| Endpoint | URL |
|----------|-----|
| **Issuer** | `https://my.neonpanel.com` |
| **Authorization** | `https://my.neonpanel.com/oauth2/authorize` |
| **Token** | `https://my.neonpanel.com/oauth2/token` |
| **Registration** | `https://my.neonpanel.com/oauth2/register` |
| **JWKS** | `https://my.neonpanel.com/.well-known/jwks.json` |

### Supported Scopes

- `read:inventory` - Read inventory data
- `read:analytics` - Read analytics data
- `read:companies` - Read company information
- `read:reports` - Read reports
- `read:warehouses` - Read warehouse data
- `read:revenue` - Read revenue data
- `read:cogs` - Read cost of goods sold
- `read:landed-cost` - Read landed cost data
- `write:import` - Import data

### OAuth Flow

The server supports:
- **Grant Types**: `authorization_code`, `refresh_token`
- **Response Types**: `code`
- **PKCE**: Required (S256 code challenge method)
- **Token Auth Methods**: `client_secret_post`, `client_secret_basic`

## Steps to Connect ChatGPT

### 1. Register OAuth Client (if needed)

If you don't have OAuth credentials yet, register your client:

```bash
curl -X POST https://my.neonpanel.com/oauth2/register \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "ChatGPT MCP Connector",
    "redirect_uris": ["YOUR_CHATGPT_REDIRECT_URI"],
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"],
    "token_endpoint_auth_method": "client_secret_post",
    "scope": "read:inventory read:companies read:warehouses read:reports"
  }'
```

Save the `client_id` and `client_secret` from the response.

### 2. Configure ChatGPT MCP Connector

In ChatGPT's MCP Connector configuration:

1. **MCP Server URL**: `https://mcp.neonpanel.com`
2. **OAuth Configuration**: Auto-discovered from `/.well-known/oauth-authorization-server`
3. **Client ID**: Use your OAuth `client_id`
4. **Client Secret**: Use your OAuth `client_secret`
5. **Scopes**: Select the scopes you need (e.g., `read:companies read:inventory`)

### 3. Authorization Flow

1. ChatGPT will redirect you to: `https://my.neonpanel.com/oauth2/authorize`
2. Log in to your NeonPanel account
3. Authorize the requested scopes
4. You'll be redirected back to ChatGPT with an authorization code
5. ChatGPT exchanges the code for an access token

### 4. Using the Tools

Once connected, you can use these MCP tools in ChatGPT:

#### Company Tools
- **`neonpanel.listCompanies`** - List all companies you have access to
- **`neonpanel.listReports`** - Get available reports

#### Inventory Tools
- **`neonpanel.listInventoryItems`** - List inventory items with filters
- **`neonpanel.getInventoryDetails`** - Get detailed inventory information
- **`neonpanel.getInventoryLandedCost`** - Get landed cost for inventory
- **`neonpanel.getInventoryCogs`** - Get cost of goods sold

#### Warehouse Tools
- **`neonpanel.listWarehouses`** - List warehouses for a company
- **`neonpanel.getWarehouseBalances`** - Get inventory balances per warehouse

#### Document Import Tools
- **`neonpanel.getImportInstructions`** - Get import format instructions
- **`neonpanel.createDocuments`** - Create documents from JSON
- **`neonpanel.createDocumentsByPdf`** - Create documents from PDF URL
- **`neonpanel.checkImportStatus`** - Check import processing status

#### Analytics Tools
- **`neonpanel.getRevenueAndCogs`** - Get revenue and COGS analytics

## Example Prompts

Once connected, try asking ChatGPT:

- *"List all my companies in NeonPanel"*
- *"Show me the inventory for company [UUID]"*
- *"What are the warehouses for my company?"*
- *"Get the revenue and COGS for Q1 2024"*
- *"Show me the inventory details for item [ID]"*
- *"What's the landed cost for inventory item [ID] in warehouse [UUID]?"*

## Troubleshooting

### Error: "MCP server does not implement OAuth"
- **Solution**: Ensure you're using the latest deployed version with the `/.well-known/oauth-authorization-server` endpoint
- **Check**: Visit https://mcp.neonpanel.com/.well-known/oauth-authorization-server to verify it returns OAuth configuration

### Error: "401 Unauthorized"
- **Cause**: Invalid or expired access token
- **Solution**: Re-authorize the connection in ChatGPT to refresh the token

### Error: "403 Forbidden"
- **Cause**: Missing required scopes
- **Solution**: Re-authorize with the correct scopes

### Connection Timeout
- **Check Health**: Visit https://mcp.neonpanel.com/healthz
- **Status**: Should return `{"status":"ok"}`

## Testing the Connection

### 1. Test OAuth Discovery
```bash
curl https://mcp.neonpanel.com/.well-known/oauth-authorization-server | jq .
```

### 2. Test Health Endpoint
```bash
curl https://mcp.neonpanel.com/healthz | jq .
```

### 3. Test with Bearer Token
```bash
curl -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -X POST https://mcp.neonpanel.com/messages \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "params": {},
    "id": 1
  }' | jq .
```

## MCP Protocol Details

- **Protocol**: MCP (Model Context Protocol)
- **Version**: 2025-01-01
- **Transport**: SSE (Server-Sent Events) for real-time updates
- **RPC**: JSON-RPC 2.0 over HTTPS
- **Authentication**: OAuth 2.0 with Bearer tokens

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/healthz` | GET | Health check |
| `/sse` | GET | SSE connection (requires auth) |
| `/messages` | POST | JSON-RPC endpoint (requires auth) |
| `/openapi.json` | GET | OpenAPI specification (JSON) |
| `/openapi.yaml` | GET | OpenAPI specification (YAML) |
| `/.well-known/oauth-authorization-server` | GET | OAuth server metadata |

## Rate Limiting

- **Window**: 10 seconds
- **Max Requests**: 30 per window
- **Applies to**: All authenticated endpoints

## Security

- ✅ **HTTPS Only**: All communications encrypted
- ✅ **CORS Enabled**: Cross-origin requests supported
- ✅ **JWKS Validation**: Tokens validated against NeonPanel's public keys
- ✅ **PKCE Required**: S256 code challenge for authorization
- ✅ **Token Expiration**: Access tokens have limited lifetime
- ✅ **Refresh Tokens**: Supported for long-lived sessions

## Support

For issues or questions:
- **Documentation**: https://docs.neonpanel.com
- **Server Health**: https://mcp.neonpanel.com/healthz
- **OAuth Config**: https://mcp.neonpanel.com/.well-known/oauth-authorization-server

## Advanced Configuration

### Custom Scopes
Request only the scopes you need:
```
read:companies read:inventory read:warehouses
```

### Long-lived Sessions
Enable refresh tokens for sessions that persist across conversations.

### Webhook Integration
Future enhancement: Real-time notifications via SSE transport.

---

**Server Version**: v3.1.1  
**Last Updated**: October 17, 2025  
**Server URL**: https://mcp.neonpanel.com
