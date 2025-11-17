#!/bin/bash
# Automated OAuth PKCE Flow Test
set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo "Loading client credentials..."
CLIENT_ID=$(jq -r '.client_id' chatgpt-client-credentials.json)
REDIRECT_URI="http://localhost:8888/callback"

echo "Generating PKCE challenge..."
CODE_VERIFIER=$(openssl rand -base64 32 | tr -d '=' | tr '+/' '-_')
CODE_CHALLENGE=$(echo -n "$CODE_VERIFIER" | openssl dgst -sha256 -binary | base64 | tr -d '=' | tr '+/' '-_')
STATE=$(openssl rand -hex 16)

echo ""
echo -e "${YELLOW}=== STEP 1: AUTHORIZE ===${NC}"

AUTH_URL="https://my.neonpanel.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=dcr.create&state=${STATE}&code_challenge=${CODE_CHALLENGE}&code_challenge_method=S256"

echo "Opening browser for authorization..."
echo ""
echo -e "${BLUE}URL: $AUTH_URL${NC}"
echo ""

# Open browser
if command -v open &> /dev/null; then
    open "$AUTH_URL"
elif command -v xdg-open &> /dev/null; then
    xdg-open "$AUTH_URL"
else
    echo "Please open this URL manually: $AUTH_URL"
fi

# Start a local server to catch the redirect
echo ""
echo -e "${YELLOW}Starting local callback server on port 8888...${NC}"
echo "Waiting for OAuth callback..."

# Create a temporary file to store the code
TEMP_FILE=$(mktemp)

# Start Python server to catch the callback
python3 -c "
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import sys

class CallbackHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Suppress logs
    
    def do_GET(self):
        query = urlparse(self.path).query
        params = parse_qs(query)
        
        if 'code' in params:
            code = params['code'][0]
            # Write code to temp file
            with open('$TEMP_FILE', 'w') as f:
                f.write(code)
            
            # Send success response
            self.send_response(200)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            html = '<html><body style=\"font-family: sans-serif; padding: 50px; text-align: center;\"><h1 style=\"color: green;\">Authorization Successful!</h1><p>You can close this window and return to the terminal.</p></body></html>'
            self.wfile.write(html.encode())
            # Shutdown server
            sys.exit(0)
        elif 'error' in params:
            error = params['error'][0]
            self.send_response(400)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            html = '<html><body style=\"font-family: sans-serif; padding: 50px; text-align: center;\"><h1 style=\"color: red;\">Authorization Failed</h1><p>Error: ' + error + '</p></body></html>'
            self.wfile.write(html.encode())
            sys.exit(1)

with HTTPServer(('localhost', 8888), CallbackHandler) as server:
    server.serve_forever()
" &

SERVER_PID=$!

# Wait for the code (with timeout)
TIMEOUT=120
ELAPSED=0
while [ ! -s "$TEMP_FILE" ] && [ $ELAPSED -lt $TIMEOUT ]; do
    sleep 1
    ELAPSED=$((ELAPSED + 1))
    if ! ps -p $SERVER_PID > /dev/null 2>&1; then
        break
    fi
done

# Kill the server if still running
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

if [ ! -s "$TEMP_FILE" ]; then
    echo -e "${RED}ERROR: Timeout waiting for authorization${NC}"
    rm -f "$TEMP_FILE"
    exit 1
fi

AUTH_CODE=$(cat "$TEMP_FILE")
rm -f "$TEMP_FILE"

echo ""
echo -e "${GREEN}✓ Authorization code received${NC}"
echo "Code: ${AUTH_CODE:0:20}..."

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
            "arguments": {"page": 1, "perPage": 10}
        }
    }')

echo "$MCP_RESPONSE" | jq .

if echo "$MCP_RESPONSE" | jq -e '.result' > /dev/null; then
    echo ""
    echo -e "${GREEN}════════════════════════════════════════${NC}"
    echo -e "${GREEN}✓✓✓ END-TO-END TEST PASSED! ✓✓✓${NC}"
    echo -e "${GREEN}════════════════════════════════════════${NC}"
    echo ""
    echo "Summary:"
    echo "  ✓ OAuth authorization successful"
    echo "  ✓ Token exchange successful"
    echo "  ✓ MCP server authentication successful"
    echo "  ✓ Tool execution successful"
else
    echo ""
    echo -e "${RED}✗ MCP call failed${NC}"
    exit 1
fi
