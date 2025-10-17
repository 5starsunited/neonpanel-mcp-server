#!/bin/bash

# Quick OAuth test - gets auth URL, waits for code, completes flow

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Load credentials
CLIENT_ID=$(jq -r '.client_id' chatgpt-client-credentials.json)
CLIENT_SECRET=$(jq -r '.client_secret' chatgpt-client-credentials.json)

# Generate PKCE
CODE_VERIFIER=$(openssl rand -base64 32 | tr -d '=' | tr '+/' '-_')
CODE_CHALLENGE=$(echo -n "$CODE_VERIFIER" | openssl dgst -sha256 -binary | base64 | tr -d '=' | tr '+/' '-_')
STATE=$(openssl rand -hex 16)

# Build auth URL
AUTH_URL="https://my.neonpanel.com/oauth2/authorize"
AUTH_URL="${AUTH_URL}?client_id=${CLIENT_ID}"
AUTH_URL="${AUTH_URL}&redirect_uri=https://chat.openai.com/aip/g/callback"
AUTH_URL="${AUTH_URL}&response_type=code"
AUTH_URL="${AUTH_URL}&scope=dcr.create"
AUTH_URL="${AUTH_URL}&state=${STATE}"
AUTH_URL="${AUTH_URL}&code_challenge=${CODE_CHALLENGE}"
AUTH_URL="${AUTH_URL}&code_challenge_method=S256"

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Complete OAuth Flow Test${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}Step 1: Open this URL in your browser:${NC}"
echo ""
echo "$AUTH_URL"
echo ""
echo -e "${YELLOW}Step 2: After authorization, copy the 'code' parameter from the redirect URL${NC}"
echo ""
echo -e "You'll be redirected to: ${BLUE}https://chat.openai.com/aip/g/callback?code=...${NC}"
echo ""
read -p "Paste the authorization code (or full redirect URL): " AUTH_INPUT

# Extract code from input (handle both raw code and full URL)
if [[ "$AUTH_INPUT" == *"code="* ]]; then
    AUTH_CODE=$(echo "$AUTH_INPUT" | grep -oE 'code=[^&]+' | cut -d= -f2)
    echo "Extracted code: ${AUTH_CODE:0:20}..."
else
    AUTH_CODE="$AUTH_INPUT"
fi

echo ""
echo -e "${BLUE}Exchanging authorization code for access token...${NC}"
echo -e "${YELLOW}Using PUBLIC client (PKCE) - client_id as form parameter${NC}"

# Exchange token - PUBLIC CLIENT (no Basic Auth)
RESPONSE=$(curl -s -X POST "https://my.neonpanel.com/oauth2/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=authorization_code" \
    -d "client_id=${CLIENT_ID}" \
    -d "code=${AUTH_CODE}" \
    -d "redirect_uri=https://chat.openai.com/aip/g/callback" \
    -d "code_verifier=${CODE_VERIFIER}")

echo "Raw response:"
echo "$RESPONSE"
echo ""

# Check if response is valid JSON
if ! echo "$RESPONSE" | jq empty 2>/dev/null; then
    echo -e "${YELLOW}Invalid JSON response from token endpoint${NC}"
    exit 1
fi

# Check for error
ERROR=$(echo "$RESPONSE" | jq -r '.error // empty')
if [ -n "$ERROR" ]; then
    echo -e "${YELLOW}Token exchange failed:${NC}"
    echo "$RESPONSE" | jq .
    exit 1
fi

# Extract token
ACCESS_TOKEN=$(echo "$RESPONSE" | jq -r '.access_token')
echo -e "${GREEN}✓ Access token received!${NC}"
echo ""
echo "Token: ${ACCESS_TOKEN:0:30}..."
echo ""

# Decode token
echo -e "${BLUE}Token claims:${NC}"
PAYLOAD=$(echo "$ACCESS_TOKEN" | cut -d. -f2)
echo "$PAYLOAD=" | base64 -d 2>/dev/null | jq .
echo ""

# Test authenticated call
echo -e "${BLUE}Testing authenticated tool call: neonpanel.listCompanies${NC}"

TOOL_RESPONSE=$(curl -s -X POST "https://mcp.neonpanel.com/messages" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -d '{
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "neonpanel.listCompanies",
            "arguments": {
                "page": 1,
                "perPage": 5
            }
        }
    }')

# Check for error
TOOL_ERROR=$(echo "$TOOL_RESPONSE" | jq -r '.error // empty')
if [ -n "$TOOL_ERROR" ]; then
    echo -e "${YELLOW}Tool call failed:${NC}"
    echo "$TOOL_RESPONSE" | jq .
    exit 1
fi

echo -e "${GREEN}✓ Tool call successful!${NC}"
echo ""
echo -e "${BLUE}Response:${NC}"
echo "$TOOL_RESPONSE" | jq .

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✓ END-TO-END TEST COMPLETED SUCCESSFULLY!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
