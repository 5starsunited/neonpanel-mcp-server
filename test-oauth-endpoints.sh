#!/bin/bash

# OAuth Token Exchange Test for my.neonpanel.com
# This script helps diagnose OAuth integration issues with ChatGPT

echo "=== OAuth Server Endpoints Test ==="
echo ""

# Test 1: OAuth Discovery
echo "1. Testing OAuth Discovery Endpoint..."
DISCOVERY=$(curl -s https://mcp.neonpanel.com/.well-known/oauth-authorization-server)
echo "   ✓ Discovery endpoint accessible"
echo "   Issuer: $(echo $DISCOVERY | jq -r '.issuer')"
echo "   Token Endpoint: $(echo $DISCOVERY | jq -r '.token_endpoint')"
echo ""

# Test 2: Authorization Endpoint
echo "2. Testing Authorization Endpoint..."
AUTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://my.neonpanel.com/oauth2/authorize)
if [ "$AUTH_STATUS" = "400" ]; then
  echo "   ✓ Authorization endpoint accessible (400 expected without params)"
else
  echo "   ✗ Authorization endpoint returned: $AUTH_STATUS"
fi
echo ""

# Test 3: Token Endpoint
echo "3. Testing Token Endpoint..."
TOKEN_STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://my.neonpanel.com/oauth2/token)
if [ "$TOKEN_STATUS" = "405" ]; then
  echo "   ✓ Token endpoint accessible (405 expected for GET, should use POST)"
else
  echo "   ✗ Token endpoint returned: $TOKEN_STATUS"
fi
echo ""

# Test 4: JWKS Endpoint
echo "4. Testing JWKS Endpoint..."
JWKS=$(curl -s https://my.neonpanel.com/.well-known/jwks.json)
KEY_COUNT=$(echo $JWKS | jq '.keys | length')
if [ "$KEY_COUNT" -gt 0 ]; then
  echo "   ✓ JWKS endpoint has $KEY_COUNT public key(s)"
  echo "   Key ID: $(echo $JWKS | jq -r '.keys[0].kid')"
else
  echo "   ✗ No keys found in JWKS"
fi
echo ""

# Test 5: Registration Endpoint
echo "5. Testing Dynamic Client Registration Endpoint..."
REG_STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://my.neonpanel.com/oauth2/register)
echo "   Status: $REG_STATUS"
if [ "$REG_STATUS" = "405" ] || [ "$REG_STATUS" = "400" ] || [ "$REG_STATUS" = "401" ]; then
  echo "   ✓ Registration endpoint accessible (needs POST with proper payload)"
else
  echo "   ⚠ Unexpected status: $REG_STATUS"
fi
echo ""

# Test 6: MCP Server Health
echo "6. Testing MCP Server Health..."
HEALTH=$(curl -s https://mcp.neonpanel.com/healthz)
STATUS=$(echo $HEALTH | jq -r '.status')
if [ "$STATUS" = "ok" ]; then
  echo "   ✓ MCP server is healthy"
  echo "   Version: $(echo $HEALTH | jq -r '.version')"
else
  echo "   ✗ MCP server health check failed"
fi
echo ""

# Test 7: MCP Server Root Info
echo "7. Testing MCP Server Info Endpoint..."
INFO=$(curl -s https://mcp.neonpanel.com/)
NAME=$(echo $INFO | jq -r '.name')
if [ "$NAME" != "null" ]; then
  echo "   ✓ MCP server info accessible"
  echo "   Name: $NAME"
  echo "   Protocol: $(echo $INFO | jq -r '.protocol')"
else
  echo "   ✗ MCP server info endpoint failed"
fi
echo ""

# Summary
echo "=== Summary ==="
echo ""
echo "OAuth Server: https://my.neonpanel.com"
echo "  - Authorization: https://my.neonpanel.com/oauth2/authorize"
echo "  - Token: https://my.neonpanel.com/oauth2/token"
echo "  - Registration: https://my.neonpanel.com/oauth2/register"
echo "  - JWKS: https://my.neonpanel.com/.well-known/jwks.json"
echo ""
echo "MCP Server: https://mcp.neonpanel.com"
echo "  - Discovery: https://mcp.neonpanel.com/.well-known/oauth-authorization-server"
echo "  - Messages: https://mcp.neonpanel.com/messages (POST, requires auth)"
echo "  - SSE: https://mcp.neonpanel.com/sse (GET, requires auth)"
echo ""
echo "=== Troubleshooting ChatGPT OAuth 500 Error ==="
echo ""
echo "The 500 error on /backend-api/aip/.../oauth/callback is happening on"
echo "CHATGPT'S backend, not on your OAuth server."
echo ""
echo "Possible causes:"
echo "  1. ChatGPT is failing to exchange the authorization code for tokens"
echo "  2. Token exchange is succeeding but token validation is failing"
echo "  3. ChatGPT's callback handler has a bug processing the response"
echo ""
echo "What you can check:"
echo "  1. Verify OAuth server logs at my.neonpanel.com for token exchange requests"
echo "  2. Check if token exchange requests are reaching your OAuth server"
echo "  3. Verify tokens issued have proper claims (iss, sub, exp, iat)"
echo "  4. Ensure CORS is not blocking requests from ChatGPT"
echo ""
echo "If all endpoints above show ✓, the issue is likely:"
echo "  - ChatGPT's OAuth client configuration"
echo "  - Token format/claims mismatch with what ChatGPT expects"
echo "  - Network/proxy issue between ChatGPT and my.neonpanel.com"
echo ""
