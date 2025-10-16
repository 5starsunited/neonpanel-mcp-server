#!/bin/bash

# Simple OAuth2 Testing with Real NeonPanel Credentials

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Configuration
MCP_BASE_URL="https://mcp.neonpanel.com"
CLIENT_ID="1145f268-a864-11f0-8a3d-122c1fe52bef"
CLIENT_SECRET="NbhL8t71IKgf5JDHI9LeyUrbFpcC4hDGA6aLray5iih4h7NalTxJhfeUFLOOs0pk"
REDIRECT_URI="https://mcp.neonpanel.com/callback"

PASSED=0
FAILED=0

print_test() {
    echo -e "\n${YELLOW}=== $1 ===${NC}"
}

print_pass() {
    echo -e "${GREEN}✓ $1${NC}"
    ((PASSED++))
}

print_fail() {
    echo -e "${RED}✗ $1${NC}"
    ((FAILED++))
}

echo "=========================================="
echo "OAuth2 Testing with Real Credentials"
echo "=========================================="
echo "MCP Server: $MCP_BASE_URL"
echo "Client ID: $CLIENT_ID"
echo "=========================================="

# TEST 1: Protected Resource Metadata
print_test "TEST 1: Protected Resource Metadata"
HTTP_CODE=$(curl -s -o /tmp/test1.json -w "%{http_code}" "$MCP_BASE_URL/.well-known/oauth-protected-resource")
if [ "$HTTP_CODE" = "200" ]; then
    AUTH_SERVER=$(cat /tmp/test1.json | jq -r '.authorization_servers[0]')
    echo "Authorization Server: $AUTH_SERVER"
    if [ "$AUTH_SERVER" = "https://my.neonpanel.com" ]; then
        print_pass "Protected resource metadata correct"
    else
        print_fail "Wrong authorization server"
    fi
else
    print_fail "HTTP $HTTP_CODE (expected 200)"
fi

# TEST 2: Authorization Server Metadata
print_test "TEST 2: Authorization Server Metadata"
HTTP_CODE=$(curl -s -o /tmp/test2.json -w "%{http_code}" "$MCP_BASE_URL/.well-known/oauth-authorization-server")
if [ "$HTTP_CODE" = "200" ]; then
    TOKEN_EP=$(cat /tmp/test2.json | jq -r '.token_endpoint')
    AUTH_EP=$(cat /tmp/test2.json | jq -r '.authorization_endpoint')
    echo "Token Endpoint: $TOKEN_EP"
    echo "Auth Endpoint: $AUTH_EP"
    
    if [[ "$TOKEN_EP" == *"/oauth2/token"* ]] && [[ "$AUTH_EP" == *"/oauth2/authorize"* ]]; then
        print_pass "Metadata endpoints use /oauth2/ paths"
    else
        print_fail "Wrong endpoint paths"
    fi
else
    print_fail "HTTP $HTTP_CODE (expected 200)"
fi

# TEST 3: Authorization Endpoint
print_test "TEST 3: Authorization Endpoint"
STATE="test_$(date +%s)"
AUTH_URL="$MCP_BASE_URL/oauth/authorize?client_id=$CLIENT_ID&redirect_uri=$REDIRECT_URI&response_type=code&state=$STATE"
echo "Testing: $AUTH_URL"

HTTP_CODE=$(curl -s -o /tmp/test3.txt -w "%{http_code}" -i "$AUTH_URL")
if [ "$HTTP_CODE" = "302" ] || [ "$HTTP_CODE" = "301" ]; then
    LOCATION=$(grep -i "^location:" /tmp/test3.txt | cut -d' ' -f2- | tr -d '\r\n')
    echo "Redirect: $LOCATION"
    
    if [[ "$LOCATION" == *"my.neonpanel.com/oauth2/authorize"* ]]; then
        print_pass "Redirects to NeonPanel OAuth2 endpoint"
    else
        print_fail "Wrong redirect location"
    fi
else
    print_fail "HTTP $HTTP_CODE (expected 302)"
fi

# TEST 4: Client Credentials Grant
print_test "TEST 4: Client Credentials Grant"
HTTP_CODE=$(curl -s -o /tmp/test4.json -w "%{http_code}" -X POST "$MCP_BASE_URL/oauth/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=client_credentials&client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET&scope=read:inventory")

echo "HTTP Status: $HTTP_CODE"
cat /tmp/test4.json | jq '.' 2>/dev/null || cat /tmp/test4.json

if [ "$HTTP_CODE" = "200" ]; then
    ACCESS_TOKEN=$(cat /tmp/test4.json | jq -r '.access_token')
    if [ -n "$ACCESS_TOKEN" ] && [ "$ACCESS_TOKEN" != "null" ]; then
        print_pass "Client credentials grant successful"
        echo "Access Token: ${ACCESS_TOKEN:0:30}..."
        echo "$ACCESS_TOKEN" > /tmp/access_token.txt
    else
        print_fail "No access_token in response"
    fi
else
    print_fail "HTTP $HTTP_CODE (expected 200)"
fi

# TEST 5: Invalid Grant Type
print_test "TEST 5: Invalid Grant Type (should fail)"
HTTP_CODE=$(curl -s -o /tmp/test5.json -w "%{http_code}" -X POST "$MCP_BASE_URL/oauth/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=invalid_grant&client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET")

if [ "$HTTP_CODE" = "400" ]; then
    ERROR=$(cat /tmp/test5.json | jq -r '.error')
    echo "Error: $ERROR"
    if [ "$ERROR" = "unsupported_grant_type" ]; then
        print_pass "Properly rejects invalid grant type"
    else
        print_fail "Wrong error type: $ERROR"
    fi
else
    print_fail "HTTP $HTTP_CODE (expected 400)"
fi

# TEST 6: Missing Client ID
print_test "TEST 6: Missing Client ID (should fail)"
HTTP_CODE=$(curl -s -o /tmp/test6.json -w "%{http_code}" -X POST "$MCP_BASE_URL/oauth/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=client_credentials&client_secret=$CLIENT_SECRET")

if [ "$HTTP_CODE" = "400" ]; then
    print_pass "Properly rejects missing client_id"
else
    print_fail "HTTP $HTTP_CODE (expected 400)"
fi

# TEST 7: WWW-Authenticate Header
print_test "TEST 7: WWW-Authenticate Challenge Header"
curl -s -i "$MCP_BASE_URL/api/inventory" > /tmp/test7.txt
WWW_AUTH=$(grep -i "^www-authenticate:" /tmp/test7.txt | cut -d' ' -f2- | tr -d '\r\n')

if [[ "$WWW_AUTH" == Bearer* ]]; then
    print_pass "WWW-Authenticate header present"
    echo "Header: $WWW_AUTH"
else
    print_fail "Missing WWW-Authenticate header"
fi

# TEST 8: API Call with Token
if [ -f /tmp/access_token.txt ]; then
    print_test "TEST 8: API Call with Access Token"
    ACCESS_TOKEN=$(cat /tmp/access_token.txt)
    
    HTTP_CODE=$(curl -s -o /tmp/test8.json -w "%{http_code}" "$MCP_BASE_URL/api/inventory" \
        -H "Authorization: Bearer $ACCESS_TOKEN")
    
    echo "HTTP Status: $HTTP_CODE"
    
    if [ "$HTTP_CODE" = "200" ]; then
        print_pass "API accepts access token"
        echo "Response preview:"
        cat /tmp/test8.json | jq '.' 2>/dev/null | head -20 || cat /tmp/test8.json | head -200
    else
        print_fail "HTTP $HTTP_CODE when calling API with token"
        cat /tmp/test8.json
    fi
fi

# TEST 9: Refresh Token Grant Support
print_test "TEST 9: Refresh Token Grant Type Support"
HTTP_CODE=$(curl -s -o /tmp/test9.json -w "%{http_code}" -X POST "$MCP_BASE_URL/oauth/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=refresh_token&refresh_token=dummy_token&client_id=$CLIENT_ID")

ERROR=$(cat /tmp/test9.json | jq -r '.error' 2>/dev/null)
if [ "$ERROR" != "unsupported_grant_type" ]; then
    print_pass "Refresh token grant type is supported"
else
    print_fail "Refresh token grant type not supported"
fi

# Summary
echo ""
echo "=========================================="
echo "TEST SUMMARY"
echo "=========================================="
echo -e "Passed: ${GREEN}${PASSED}${NC}"
echo -e "Failed: ${RED}${FAILED}${NC}"
echo "Total:  $((PASSED + FAILED))"

# Cleanup
rm -f /tmp/test*.json /tmp/test*.txt /tmp/access_token.txt

if [ $FAILED -eq 0 ]; then
    echo -e "\n${GREEN}🎉 ALL TESTS PASSED!${NC}"
    exit 0
else
    echo -e "\n${RED}❌ SOME TESTS FAILED${NC}"
    exit 1
fi
