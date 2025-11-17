#!/bin/bash
# Simple OAuth PKCE Flow Test
set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "Loading client credentials..."
CLIENT_ID=$(jq -r '.client_id' chatgpt-client-credentials.json)
REDIRECT_URI="https://chat.openai.com/aip/callback"

echo "Generating PKCE challenge..."
CODE_VERIFIER=$(openssl rand -base64 32 | tr -d '=' | tr '+/' '-_')
CODE_CHALLENGE=$(echo -n "$CODE_VERIFIER" | openssl dgst -sha256 -binary | base64 | tr -d '=' | tr '+/' '-_')
STATE=$(openssl rand -hex 16)

echo ""
echo -e "${YELLOW}=== STEP 1: AUTHORIZE ===${NC}"
echo "Open this URL in browser:"
echo ""
AUTH_URL="https://my.neonpanel.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=dcr.create&state=${STATE}&code_challenge=${CODE_CHALLENGE}&code_challenge_method=S256"
echo "$AUTH_URL"
echo ""
echo "After authorizing, you'll be redirected to:"
echo "https://chat.openai.com/aip/callback?code=XXXXX&state=..."
echo ""
echo "Paste the FULL redirect URL here:"
read -p "> " REDIRECT_URL

# Extract code
AUTH_CODE=$(echo "$REDIRECT_URL" | grep -oE 'code=[^&]+' | cut -d= -f2)

if [ -z "$AUTH_CODE" ]; then
    echo -e "${RED}ERROR: Could not extract code${NC}"
    exit 1
fi

echo ""
echo -e "${YELLOW}=== STEP 2: TOKEN EXCHANGE ===${NC}"
echo "Exchanging code for token..."

RESPONSE=$(curl -s -X POST "https://my.neonpanel.com/oauth2/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=authorization_code" \
    -d "client_id=${CLIENT_ID}" \
    -d "code=${AUTH_CODE}" \
    -d "redirect_uri=${REDIRECT_URI}" \
    -d "code_verifier=${CODE_VERIFIER}")

echo "$RESPONSE" | jq .

# Check for access token
ACCESS_TOKEN=$(echo "$RESPONSE" | jq -r '.access_token // empty')

if [ -z "$ACCESS_TOKEN" ]; then
    echo -e "${RED}ERROR: No access token received${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✓ Got access token!${NC}"
echo "Token: ${ACCESS_TOKEN:0:30}..."

echo ""
echo -e "${YELLOW}=== STEP 3: TEST MCP CALL ===${NC}"
echo "Calling neonpanel.listCompanies..."

MCP_RESPONSE=$(curl -s -X POST "https://mcp.neonpanel.com/messages" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -d '{
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "neonpanel.listCompanies",
            "arguments": {"page": 1, "perPage": 3}
        }
    }')

echo "$MCP_RESPONSE" | jq .

if echo "$MCP_RESPONSE" | jq -e '.result' > /dev/null; then
    echo ""
    echo -e "${GREEN}✓✓✓ END-TO-END TEST PASSED! ✓✓✓${NC}"
else
    echo ""
    echo -e "${RED}✗ MCP call failed${NC}"
    exit 1
fi
