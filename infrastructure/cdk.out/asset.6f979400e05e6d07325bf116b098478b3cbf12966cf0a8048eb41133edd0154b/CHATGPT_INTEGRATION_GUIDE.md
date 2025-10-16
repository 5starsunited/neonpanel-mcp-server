# ChatGPT Integration Guide

## How to Add NeonPanel to ChatGPT

### Option 1: Import OpenAPI Spec Directly (RECOMMENDED)

1. **Go to ChatGPT** → Create a new GPT
2. **Configure** → **Actions** → **Create new action**
3. **Import from URL**: `https://mcp.neonpanel.com/openapi.yaml`
4. **Authentication**: Select **OAuth**
   - **Client ID**: Leave blank (ChatGPT will use DCR)
   - **Client Secret**: Leave blank (ChatGPT will use DCR)
   - **Authorization URL**: `https://my.neonpanel.com/oauth2/authorize`
   - **Token URL**: `https://my.neonpanel.com/oauth2/token`
   - **Scope**: `read:inventory read:analytics read:companies read:reports read:warehouses read:revenue read:cogs read:landed-cost`

### Option 2: Manual OAuth Configuration

If ChatGPT doesn't auto-discover the DCR endpoint, you need to register a client manually first.

#### Step 1: Get Initial Access Token (IAT)

Contact NeonPanel admin to get an IAT token for DCR.

#### Step 2: Register OAuth Client

```bash
curl -X POST https://my.neonpanel.com/oauth2/register \
  -H "Authorization: Bearer YOUR_IAT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "ChatGPT NeonPanel Integration",
    "redirect_uris": ["https://chat.openai.com/aip/oauth/callback"],
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"],
    "token_endpoint_auth_method": "none",
    "scope": "read:inventory read:analytics read:companies read:reports read:warehouses read:revenue read:cogs read:landed-cost"
  }'
```

You'll get a response like:
```json
{
  "client_id": "abc123...",
  "client_id_issued_at": 1234567890,
  "redirect_uris": ["https://chat.openai.com/aip/oauth/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none"
}
```

#### Step 3: Configure in ChatGPT

1. **Actions** → **Authentication** → **OAuth**
2. **Client ID**: Use the `client_id` from Step 2
3. **Client Secret**: Leave blank (public client)
4. **Authorization URL**: `https://my.neonpanel.com/oauth2/authorize`
5. **Token URL**: `https://my.neonpanel.com/oauth2/token`
6. **Scope**: `read:inventory read:analytics read:companies read:reports read:warehouses read:revenue read:cogs read:landed-cost`

---

## Troubleshooting

### Error: "invalid_token" / "Unsupported authorization header"

**Cause**: ChatGPT is trying to use an Initial Access Token (IAT) to register via DCR, but:
1. NeonPanel DCR requires an IAT token
2. ChatGPT doesn't have one configured

**Solutions**:

#### Solution A: Use Pre-Registered Client (EASIEST)

NeonPanel has a pre-registered client for ChatGPT:
- **Client ID**: `1145f268-a864-11f0-8a3d-122c1fe52bef`
- **Client Secret**: Not needed (public client, use PKCE)
- Use this in ChatGPT's OAuth configuration

#### Solution B: Configure IAT in ChatGPT (if supported)

Some platforms allow you to configure an IAT token. Check if ChatGPT Actions supports custom headers for DCR.

#### Solution C: Temporary DCR Proxy (workaround)

If ChatGPT can't handle IAT-protected DCR, you could temporarily add a public DCR endpoint (no IAT required) just for ChatGPT registration.

---

## Testing Steps

After configuration:

1. **Test Action** in ChatGPT GPT builder
2. Should redirect to: `https://my.neonpanel.com/oauth2/authorize`
3. Login with NeonPanel credentials
4. Authorize the application
5. Should redirect back to ChatGPT with auth code
6. ChatGPT exchanges code for access token
7. **Test with a query**: "Show me my inventory items"

---

## Available Actions

Once configured, ChatGPT can:

1. **search** - Search inventory or financial data
2. **fetch** - Get details for specific items
3. **get_inventory_items** - List inventory with filters
4. **get_item_cogs** - Get COGS for an item
5. **get_item_landed_cost** - Get landed cost for an item
6. **get_revenue_and_cogs** - Get revenue and COGS analytics

---

## Current Status

✅ **MCP Server**: https://mcp.neonpanel.com  
✅ **OAuth Discovery**: https://mcp.neonpanel.com/.well-known/oauth-authorization-server  
✅ **OpenAPI Spec**: https://mcp.neonpanel.com/openapi.yaml  
✅ **DCR Endpoint**: https://my.neonpanel.com/oauth2/register (requires IAT)  
✅ **Pre-registered Client**: Available (ID: 1145f268-a864-11f0-8a3d-122c1fe52bef)

---

## Quick Fix for Current Error

The "unsupported authorization header" error means ChatGPT is trying to call the DCR endpoint without proper authentication.

**Immediate Solution**: Use the pre-registered client ID in ChatGPT's OAuth configuration instead of relying on automatic DCR.

1. Go to ChatGPT Actions → Authentication
2. Select **OAuth**
3. **Client ID**: `1145f268-a864-11f0-8a3d-122c1fe52bef`
4. **Client Secret**: Leave blank
5. **Authorization URL**: `https://my.neonpanel.com/oauth2/authorize`
6. **Token URL**: `https://my.neonpanel.com/oauth2/token`
7. **Scope**: `read:inventory read:analytics read:companies read:reports read:warehouses read:revenue read:cogs read:landed-cost`
8. **Authorization Method**: Authorization header (default)
9. **Token Exchange Method**: Basic authorization header

Save and test!
