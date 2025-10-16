#!/bin/bash

###############################################################################
# Register ChatGPT MCP Client with NeonPanel DCR
# 
# This script uses Dynamic Client Registration (RFC 7591) to register
# a new OAuth client specifically for ChatGPT MCP connector integration.
###############################################################################

set -e

IAT_TOKEN="$1"

if [ -z "$IAT_TOKEN" ]; then
    echo "❌ Error: Initial Access Token required"
    echo ""
    echo "Usage: ./register-chatgpt-client.sh <IAT_TOKEN>"
    echo ""
    echo "To get an IAT token:"
    echo "  1. Contact NeonPanel admin"
    echo "  2. Request IAT with scope 'dcr.create'"
    echo "  3. Token valid for 15 minutes"
    exit 1
fi

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Register ChatGPT MCP Client with NeonPanel DCR               ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""

BASE_URL="https://my.neonpanel.com"
DCR_URL="${BASE_URL}/oauth2/register"

# ChatGPT callback URLs
CHATGPT_CALLBACKS='["https://chatgpt.com/aip/callback","https://chat.openai.com/aip/callback"]'

# Required OAuth scopes for MCP tools
SCOPES="read:inventory read:analytics read:companies read:reports read:warehouses read:revenue read:cogs read:landed-cost write:import"

echo -e "${YELLOW}Registering client with:${NC}"
echo "  Client Name: ChatGPT MCP Connector"
echo "  Redirect URIs: ChatGPT callbacks"
echo "  Auth Method: none (public client)"
echo "  Grant Types: authorization_code, refresh_token"
echo "  Scopes: $SCOPES"
echo ""

# Prepare registration request
REGISTRATION_DATA=$(cat <<EOF
{
  "client_name": "ChatGPT MCP Connector",
  "redirect_uris": ${CHATGPT_CALLBACKS},
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none",
  "scope": "${SCOPES}",
  "application_type": "web"
}
EOF
)

echo -e "${YELLOW}Sending registration request...${NC}"
echo ""

# Make DCR request
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${DCR_URL}" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${IAT_TOKEN}" \
    -d "${REGISTRATION_DATA}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
RESPONSE_BODY=$(echo "$RESPONSE" | sed '$d')

echo -e "HTTP Status: ${HTTP_CODE}"
echo ""

if [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ SUCCESS! Client registered${NC}"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "CLIENT CREDENTIALS"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "$RESPONSE_BODY" | jq '.'
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "SAVE THESE CREDENTIALS"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    CLIENT_ID=$(echo "$RESPONSE_BODY" | jq -r '.client_id')
    CLIENT_SECRET=$(echo "$RESPONSE_BODY" | jq -r '.client_secret // "null"')
    
    echo -e "${YELLOW}Client ID:${NC}"
    echo "  $CLIENT_ID"
    echo ""
    
    if [ "$CLIENT_SECRET" != "null" ]; then
        echo -e "${YELLOW}Client Secret:${NC}"
        echo "  $CLIENT_SECRET"
        echo ""
    else
        echo -e "${YELLOW}Client Secret:${NC} (none - public client)"
        echo ""
    fi
    
    # Save to file
    OUTPUT_FILE="chatgpt-client-credentials.json"
    echo "$RESPONSE_BODY" | jq '.' > "$OUTPUT_FILE"
    echo -e "${GREEN}✅ Credentials saved to: $OUTPUT_FILE${NC}"
    echo ""
    
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "CHATGPT CONFIGURATION"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Go to ChatGPT → Settings → Integrations → MCP Servers → Add New"
    echo ""
    echo -e "${YELLOW}MCP Server URL:${NC}"
    echo "  https://mcp.neonpanel.com/mcp"
    echo ""
    echo -e "${YELLOW}Authentication: OAuth 2.0${NC}"
    echo ""
    echo -e "${YELLOW}Client ID:${NC}"
    echo "  $CLIENT_ID"
    echo ""
    if [ "$CLIENT_SECRET" != "null" ]; then
        echo -e "${YELLOW}Client Secret:${NC}"
        echo "  $CLIENT_SECRET"
        echo ""
    else
        echo -e "${YELLOW}Client Secret:${NC}"
        echo "  (leave empty)"
        echo ""
    fi
    echo -e "${YELLOW}Authorization URL:${NC}"
    echo "  https://my.neonpanel.com/oauth2/authorize"
    echo ""
    echo -e "${YELLOW}Token URL:${NC}"
    echo "  https://my.neonpanel.com/oauth2/token"
    echo ""
    echo -e "${YELLOW}Scopes:${NC}"
    echo "  $SCOPES"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo -e "${GREEN}🎉 Ready to configure ChatGPT!${NC}"
    echo ""
    exit 0
else
    echo -e "❌ FAILED - HTTP $HTTP_CODE"
    echo ""
    echo "Response:"
    echo "$RESPONSE_BODY" | jq '.' 2>/dev/null || echo "$RESPONSE_BODY"
    echo ""
    
    # Check for common errors
    if echo "$RESPONSE_BODY" | grep -q "bad_iss"; then
        echo "💡 Error: Wrong IAT issuer"
        echo "   IAT token must have issuer: https://my.neonpanel.com"
    elif echo "$RESPONSE_BODY" | grep -q "Unauthorized"; then
        echo "💡 Error: IAT token invalid or expired"
        echo "   IAT tokens expire in 15 minutes"
        echo "   Request a new IAT token from NeonPanel admin"
    elif echo "$RESPONSE_BODY" | grep -q "invalid_redirect_uri"; then
        echo "💡 Error: Redirect URI not allowed"
        echo "   Contact NeonPanel admin to whitelist ChatGPT callback URLs"
    fi
    
    exit 1
fi
