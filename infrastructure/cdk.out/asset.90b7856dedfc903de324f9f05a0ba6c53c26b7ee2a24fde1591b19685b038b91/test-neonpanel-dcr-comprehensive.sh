#!/bin/bash

# Comprehensive DCR Testing Script
# Tests multiple scenarios to catch bugs in NeonPanel API DCR implementation

set -e

BASE_URL="https://my.neonpanel.com"
DCR_URL="${BASE_URL}/oauth2/register"
IAT_TOKEN="$1"

if [ -z "$IAT_TOKEN" ]; then
    echo "❌ Error: Initial Access Token required"
    echo "Usage: ./test-neonpanel-dcr-comprehensive.sh <IAT_TOKEN>"
    exit 1
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "🧪 Comprehensive NeonPanel API DCR Testing"
echo "=========================================="
echo ""

TEST_PASSED=0
TEST_FAILED=0
TESTS_RUN=0

run_test() {
    local test_name="$1"
    local test_data="$2"
    local expected_status="$3"
    
    TESTS_RUN=$((TESTS_RUN + 1))
    echo ""
    echo -e "${BLUE}Test $TESTS_RUN: $test_name${NC}"
    echo "---"
    
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${DCR_URL}" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer ${IAT_TOKEN}" \
        -d "$test_data" 2>&1 || echo "000")
    
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    RESPONSE_BODY=$(echo "$RESPONSE" | sed '$d')
    
    echo "HTTP Status: ${HTTP_CODE}"
    
    if [ "$HTTP_CODE" == "$expected_status" ]; then
        echo -e "${GREEN}✅ Status code correct${NC}"
        TEST_PASSED=$((TEST_PASSED + 1))
        
        # Additional validations for successful responses
        if [ "$HTTP_CODE" == "201" ]; then
            # Validate response structure
            CLIENT_ID=$(echo "$RESPONSE_BODY" | jq -r '.client_id // empty' 2>/dev/null)
            REDIRECT_URIS=$(echo "$RESPONSE_BODY" | jq -r '.redirect_uris // empty' 2>/dev/null)
            
            if [ -n "$CLIENT_ID" ]; then
                echo -e "   ${GREEN}✅ client_id present: $CLIENT_ID${NC}"
            else
                echo -e "   ${RED}❌ client_id missing${NC}"
                TEST_FAILED=$((TEST_FAILED + 1))
            fi
            
            if [ -n "$REDIRECT_URIS" ]; then
                echo -e "   ${GREEN}✅ redirect_uris present${NC}"
            else
                echo -e "   ${RED}❌ redirect_uris missing${NC}"
                TEST_FAILED=$((TEST_FAILED + 1))
            fi
        fi
        
        # Show full response for debugging
        echo ""
        echo "Response body:"
        echo "$RESPONSE_BODY" | jq '.' 2>/dev/null || echo "$RESPONSE_BODY"
        
    else
        echo -e "${RED}❌ Expected $expected_status, got $HTTP_CODE${NC}"
        TEST_FAILED=$((TEST_FAILED + 1))
        
        # Show error details
        echo ""
        echo "Response body:"
        echo "$RESPONSE_BODY" | jq '.' 2>/dev/null || echo "$RESPONSE_BODY"
    fi
}

# Test 1: Basic registration with minimal required fields
run_test "Minimal registration (required fields only)" \
'{
  "redirect_uris": ["https://chat.openai.com/aip/oauth/callback"]
}' \
"201"

# Test 2: Full registration with all optional fields
run_test "Full registration (all fields)" \
'{
  "redirect_uris": ["https://chat.openai.com/aip/oauth/callback", "https://mcp.neonpanel.com/callback"],
  "client_name": "ChatGPT Test Client",
  "client_uri": "https://openai.com",
  "logo_uri": "https://openai.com/logo.png",
  "scope": "openid profile email",
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none"
}' \
"201"

# Test 3: Registration with client_secret_post auth method
run_test "Registration with client_secret_post" \
'{
  "redirect_uris": ["https://chat.openai.com/aip/oauth/callback"],
  "client_name": "Test Client Secret",
  "token_endpoint_auth_method": "client_secret_post",
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"]
}' \
"201"

# Test 4: Registration with private_key_jwt and JWKS URI
run_test "Registration with private_key_jwt + jwks_uri" \
'{
  "redirect_uris": ["https://chat.openai.com/aip/oauth/callback"],
  "client_name": "Test Private Key JWT",
  "token_endpoint_auth_method": "private_key_jwt",
  "jwks_uri": "https://example.com/.well-known/jwks.json",
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"]
}' \
"201"

# Test 5: Registration with multiple redirect URIs
run_test "Multiple redirect URIs" \
'{
  "redirect_uris": [
    "https://chat.openai.com/aip/oauth/callback",
    "https://mcp.neonpanel.com/callback",
    "http://localhost:3000/callback"
  ],
  "client_name": "Multi-Redirect Client"
}' \
"201"

# Test 6: Invalid - missing redirect_uris
run_test "Invalid: Missing redirect_uris" \
'{
  "client_name": "Invalid Client"
}' \
"400"

# Test 7: Invalid - empty redirect_uris array
run_test "Invalid: Empty redirect_uris array" \
'{
  "redirect_uris": [],
  "client_name": "Invalid Client"
}' \
"400"

# Test 8: Invalid - redirect_uris not an array
run_test "Invalid: redirect_uris not an array" \
'{
  "redirect_uris": "https://chat.openai.com/aip/oauth/callback",
  "client_name": "Invalid Client"
}' \
"400"

# Test 9: Client credentials grant type
run_test "Client credentials grant" \
'{
  "redirect_uris": ["https://chat.openai.com/aip/oauth/callback"],
  "client_name": "Client Credentials Test",
  "grant_types": ["client_credentials"],
  "token_endpoint_auth_method": "client_secret_post"
}' \
"201"

# Test 10: Registration with custom scope
run_test "Custom scope" \
'{
  "redirect_uris": ["https://chat.openai.com/aip/oauth/callback"],
  "client_name": "Custom Scope Client",
  "scope": "read:servers write:servers read:analytics"
}' \
"201"

# Summary
echo ""
echo "=========================================="
echo "📊 Comprehensive Test Results"
echo "=========================================="
echo -e "Total Tests Run: ${BLUE}${TESTS_RUN}${NC}"
echo -e "Tests Passed: ${GREEN}${TEST_PASSED}${NC}"
echo -e "Tests Failed: ${RED}${TEST_FAILED}${NC}"
echo ""

if [ $TEST_FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ ALL TESTS PASSED! NeonPanel API DCR is working correctly!${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Deploy MCP server without DCR proxy"
    echo "2. Update integration tests"
    echo "3. Test with ChatGPT"
    exit 0
else
    echo -e "${YELLOW}⚠️  Some tests failed. Review the errors above.${NC}"
    echo ""
    if [ $TEST_PASSED -gt 0 ]; then
        echo -e "${GREEN}Good news: $TEST_PASSED/$TESTS_RUN tests passed!${NC}"
        echo "The endpoint is partially working. Fix the failing tests to complete implementation."
    else
        echo -e "${RED}The DCR endpoint has significant issues that need to be fixed.${NC}"
    fi
    exit 1
fi
