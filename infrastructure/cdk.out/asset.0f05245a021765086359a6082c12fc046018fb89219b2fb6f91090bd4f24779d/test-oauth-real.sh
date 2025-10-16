#!/bin/bash

# OAuth2 Compliance Testing with Real NeonPanel Credentials
# Testing MCP Server at mcp.neonpanel.com

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
MCP_BASE_URL="${MCP_BASE_URL:-https://mcp.neonpanel.com}"
NEONPANEL_BASE_URL="https://my.neonpanel.com"

# Real credentials from NeonPanel
CLIENT_ID="1145f268-a864-11f0-8a3d-122c1fe52bef"
CLIENT_SECRET="NbhL8t71IKgf5JDHI9LeyUrbFpcC4hDGA6aLray5iih4h7NalTxJhfeUFLOOs0pk"
REDIRECT_URI="https://mcp.neonpanel.com/callback"

# Test counters
PASSED=0
FAILED=0

# Helper functions
print_test() {
    echo -e "\n${YELLOW}=== TEST: $1 ===${NC}"
}

print_pass() {
    echo -e "${GREEN}✓ PASS${NC}: $1"
    ((PASSED++))
}

print_fail() {
    echo -e "${RED}✗ FAIL${NC}: $1"
    ((FAILED++))
}

print_summary() {
    echo -e "\n${YELLOW}=== TEST SUMMARY ===${NC}"
    echo -e "Passed: ${GREEN}${PASSED}${NC}"
    echo -e "Failed: ${RED}${FAILED}${NC}"
    echo -e "Total:  $((PASSED + FAILED))"
    
    if [ $FAILED -eq 0 ]; then
        echo -e "\n${GREEN}🎉 ALL TESTS PASSED!${NC}"
        return 0
    else
        echo -e "\n${RED}❌ SOME TESTS FAILED${NC}"
        return 1
    fi
}

# PKCE helper functions
generate_code_verifier() {
    # Generate a random 43-character code verifier (valid for PKCE)
    LC_ALL=C tr -dc 'A-Za-z0-9_-' < /dev/urandom | head -c 43
}

generate_code_challenge() {
    # Generate S256 code challenge from verifier
    echo -n "$1" | shasum -a 256 | awk '{print $1}' | xxd -r -p | base64 | tr '+/' '-_' | tr -d '='
}

# Generate PKCE parameters
CODE_VERIFIER=$(generate_code_verifier)
CODE_CHALLENGE=$(generate_code_challenge "$CODE_VERIFIER")

echo "=========================================="
echo "OAuth2 Compliance Testing - Real Credentials"
echo "=========================================="
echo "MCP Server: $MCP_BASE_URL"
echo "NeonPanel: $NEONPANEL_BASE_URL"
echo "Client ID: $CLIENT_ID"
echo "Redirect URI: $REDIRECT_URI"
echo "=========================================="

# TEST 1: OAuth 2.0 Protected Resource Metadata (RFC 9728)
print_test "OAuth 2.0 Protected Resource Metadata (RFC 9728)"
RESPONSE=$(curl -s -w "\n%{http_code}" "$MCP_BASE_URL/.well-known/oauth-protected-resource")
HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
    AUTH_SERVER=$(echo "$BODY" | jq -r '.authorization_servers[0]' 2>/dev/null || echo "")
    if [ "$AUTH_SERVER" = "$NEONPANEL_BASE_URL" ]; then
        print_pass "Protected resource metadata correct"
    else
        print_fail "Wrong authorization server: $AUTH_SERVER"
    fi
else
    print_fail "HTTP $HTTP_CODE - Expected 200"
fi

# TEST 2: Authorization Server Metadata (RFC 8414)
print_test "Authorization Server Metadata Discovery (RFC 8414)"
RESPONSE=$(curl -s -w "\n%{http_code}" "$MCP_BASE_URL/.well-known/oauth-authorization-server")
HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
    TOKEN_ENDPOINT=$(echo "$BODY" | jq -r '.token_endpoint' 2>/dev/null || echo "")
    AUTH_ENDPOINT=$(echo "$BODY" | jq -r '.authorization_endpoint' 2>/dev/null || echo "")
    
    if [[ "$TOKEN_ENDPOINT" == *"/oauth2/token"* ]] && [[ "$AUTH_ENDPOINT" == *"/oauth2/authorize"* ]]; then
        print_pass "Metadata endpoints correct (/oauth2/)"
    else
        print_fail "Wrong endpoint paths: auth=$AUTH_ENDPOINT, token=$TOKEN_ENDPOINT"
    fi
else
    print_fail "HTTP $HTTP_CODE - Expected 200"
fi

# TEST 3: Authorization Endpoint with PKCE
print_test "Authorization Endpoint with PKCE (RFC 7636)"
STATE="test_state_$(date +%s)"
AUTH_URL="$MCP_BASE_URL/oauth/authorize?client_id=$CLIENT_ID&redirect_uri=$REDIRECT_URI&response_type=code&state=$STATE&code_challenge=$CODE_CHALLENGE&code_challenge_method=S256&scope=read:inventory"

echo "Authorization URL: $AUTH_URL"
echo "Code Verifier: $CODE_VERIFIER"
echo "Code Challenge: $CODE_CHALLENGE"

RESPONSE=$(curl -s -i -w "\n%{http_code}" "$AUTH_URL")
HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)

if [ "$HTTP_CODE" = "302" ] || [ "$HTTP_CODE" = "301" ]; then
    LOCATION=$(echo "$RESPONSE" | grep -i "^location:" | cut -d' ' -f2- | tr -d '\r\n')
    if [[ "$LOCATION" == *"my.neonpanel.com/oauth2/authorize"* ]]; then
        print_pass "Redirects to NeonPanel with correct parameters"
        echo "Redirect Location: $LOCATION"
    else
        print_fail "Wrong redirect location: $LOCATION"
    fi
else
    print_fail "HTTP $HTTP_CODE - Expected 302"
fi

# TEST 4: Token Endpoint - Client Credentials Grant
print_test "Token Endpoint - Client Credentials Grant"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$MCP_BASE_URL/oauth/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=client_credentials&client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET&scope=read:inventory")

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "Response: $BODY"

if [ "$HTTP_CODE" = "200" ]; then
    ACCESS_TOKEN=$(echo "$BODY" | jq -r '.access_token' 2>/dev/null || echo "")
    if [ -n "$ACCESS_TOKEN" ] && [ "$ACCESS_TOKEN" != "null" ]; then
        print_pass "Client credentials grant successful"
        echo "Access Token: ${ACCESS_TOKEN:0:20}..."
        
        # Save token for later tests
        echo "$ACCESS_TOKEN" > /tmp/neonpanel_test_token.txt
    else
        print_fail "No access_token in response: $BODY"
    fi
else
    print_fail "HTTP $HTTP_CODE - Expected 200. Response: $BODY"
fi

# TEST 5: Token Endpoint - Invalid Grant Type
print_test "Token Endpoint - Invalid Grant Type (Should Fail)"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$MCP_BASE_URL/oauth/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=invalid_grant&client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET")

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "400" ]; then
    ERROR=$(echo "$BODY" | jq -r '.error' 2>/dev/null || echo "")
    if [ "$ERROR" = "unsupported_grant_type" ]; then
        print_pass "Properly rejects invalid grant type"
    else
        print_fail "Wrong error: $ERROR"
    fi
else
    print_fail "HTTP $HTTP_CODE - Expected 400"
fi

# TEST 6: Token Endpoint - Missing Client ID
print_test "Token Endpoint - Missing Client ID (Should Fail)"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$MCP_BASE_URL/oauth/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=client_credentials&client_secret=$CLIENT_SECRET")

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "400" ]; then
    print_pass "Properly rejects missing client_id"
else
    print_fail "HTTP $HTTP_CODE - Expected 400"
fi

# TEST 7: WWW-Authenticate Challenge Header
print_test "WWW-Authenticate Challenge Header (RFC 6750)"
RESPONSE=$(curl -s -i "$MCP_BASE_URL/api/inventory")
WWW_AUTH=$(echo "$RESPONSE" | grep -i "^www-authenticate:" | cut -d' ' -f2- | tr -d '\r\n')

if [[ "$WWW_AUTH" == Bearer* ]]; then
    print_pass "WWW-Authenticate header present"
    echo "Header: $WWW_AUTH"
else
    print_fail "Missing or invalid WWW-Authenticate header"
fi

# TEST 8: Test with Access Token (if we got one)
if [ -f /tmp/neonpanel_test_token.txt ]; then
    print_test "API Call with Access Token"
    ACCESS_TOKEN=$(cat /tmp/neonpanel_test_token.txt)
    
    RESPONSE=$(curl -s -w "\n%{http_code}" "$MCP_BASE_URL/api/inventory" \
        -H "Authorization: Bearer $ACCESS_TOKEN")
    
    HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
    BODY=$(echo "$RESPONSE" | sed '$d')
    
    if [ "$HTTP_CODE" = "200" ]; then
        print_pass "API accepts access token"
        echo "Response preview: ${BODY:0:100}..."
    else
        print_fail "HTTP $HTTP_CODE when calling API with token"
        echo "Response: $BODY"
    fi
    
    rm /tmp/neonpanel_test_token.txt
fi

# TEST 9: PKCE Code Exchange Simulation
print_test "PKCE Parameters Format Validation"
# Verify code_verifier and code_challenge are correctly formatted
if [ ${#CODE_VERIFIER} -eq 43 ] && [ ${#CODE_CHALLENGE} -eq 43 ]; then
    print_pass "PKCE parameters correctly formatted"
    echo "Verifier length: ${#CODE_VERIFIER}"
    echo "Challenge length: ${#CODE_CHALLENGE}"
else
    print_fail "Invalid PKCE parameter lengths"
fi

# TEST 10: Token Introspection (if endpoint exists)
print_test "Token Introspection Endpoint Check"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$MCP_BASE_URL/oauth/introspect" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "token=dummy_token&client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET")

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "501" ]; then
    print_pass "Introspection endpoint responds (200) or not implemented (501)"
else
    echo "Note: Introspection endpoint returned HTTP $HTTP_CODE (optional feature)"
fi

# TEST 11: CORS Headers
print_test "CORS Headers for Browser Compatibility"
RESPONSE=$(curl -s -i -X OPTIONS "$MCP_BASE_URL/oauth/token" \
    -H "Origin: https://chatgpt.com" \
    -H "Access-Control-Request-Method: POST")

CORS_HEADER=$(echo "$RESPONSE" | grep -i "^access-control-allow-origin:" | cut -d' ' -f2- | tr -d '\r\n')

if [ -n "$CORS_HEADER" ]; then
    print_pass "CORS headers present"
    echo "CORS Origin: $CORS_HEADER"
else
    echo "Warning: No CORS headers (might cause issues in browser)"
fi

# TEST 12: Refresh Token (if we have one from previous tests)
print_test "Refresh Token Grant Type Support"
# This test requires a real authorization code flow to get a refresh token
# For now, just verify the endpoint accepts the grant type
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$MCP_BASE_URL/oauth/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=refresh_token&refresh_token=dummy_token&client_id=$CLIENT_ID")

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed '$d')

# Should fail but not with "unsupported_grant_type"
ERROR=$(echo "$BODY" | jq -r '.error' 2>/dev/null || echo "")
if [ "$ERROR" != "unsupported_grant_type" ]; then
    print_pass "Refresh token grant type is supported"
else
    print_fail "Refresh token grant type not supported"
fi

# Print summary
print_summary
