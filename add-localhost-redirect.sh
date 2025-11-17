#!/bin/bash
# Add localhost redirect URI for testing
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

CLIENT_ID=$(jq -r '.client_id' chatgpt-client-credentials.json)
RAT=$(jq -r '.registration_access_token' chatgpt-client-credentials.json)

echo -e "${YELLOW}Adding http://localhost:8888/callback to redirect URIs...${NC}"

RESPONSE=$(curl -s -X PATCH "https://my.neonpanel.com/oauth2/register/${CLIENT_ID}" \
    -H "Authorization: Bearer ${RAT}" \
    -H "Content-Type: application/json" \
    -d '{
        "redirect_uris": [
            "https://chatgpt.com/aip/callback",
            "https://chat.openai.com/aip/callback",
            "http://localhost:8888/callback"
        ]
    }')

echo "$RESPONSE" | jq .

# Update local file
echo "$RESPONSE" | jq . > chatgpt-client-credentials.json

echo ""
echo -e "${GREEN}✓ Client updated! You can now run ./test-auto.sh${NC}"
