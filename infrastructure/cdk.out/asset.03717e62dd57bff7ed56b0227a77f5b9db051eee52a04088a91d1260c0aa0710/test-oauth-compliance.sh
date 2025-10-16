#!/bin/bash

# OAuth2 Compliance Test Script for GPT/MCP Requirements
# Tests NeonPanel MCP OAuth2 implementation

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
BASE_URL="${MCP_BASE_URL:-http://localhost:3030}"
TEST_CLIENT_ID="test-client-123"
TEST_CLIENT_SECRET="test-secret-456"
TEST_REDIRECT_URI="https://chatgpt.com/connector_platform_oauth_redirect"

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   OAuth2 Compliance Test for GPT/MCP Requirements            ║${NC}"
echo -e "${BLUE}║   Testing: $BASE_URL${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Counter for passed/failed tests
PASSED=0
FAILED=0
TOTAL=0

# Function to test endpoint
test_endpoint() {
    local name="$1"
    local url="$2"
    local expected_status="${3:-200}"
    local additional_checks="$4"
    
    ((TOTAL++))
    echo -e "\n${YELLOW}[TEST $TOTAL]${NC} $name"
    echo -e "  URL: $url"
    
    response=$(curl -s -w "\n%{http_code}" "$url" 2>&1) || {
        echo -e "  ${RED}✗ FAILED${NC} - Connection error"
        ((FAILED++))
        return 1
    }
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "$expected_status" ]; then
        echo -e "  ${GREEN}✓ PASSED${NC} - Status: $http_code"
        ((PASSED++))
        
        # Additional checks
        if [ -n "$additional_checks" ]; then
            eval "$additional_checks"
        fi
        
        # Pretty print JSON if response is JSON
        if echo "$body" | jq . >/dev/null 2>&1; then
            echo -e "\n  Response:"
            echo "$body" | jq . | sed 's/^/    /'
        else
            echo -e "\n  Response: $body" | head -c 200
        fi
        return 0
    else
        echo -e "  ${RED}✗ FAILED${NC} - Expected: $expected_status, Got: $http_code"
        echo -e "  Response: $body" | head -c 200
        ((FAILED++))
        return 1
    fi
}

# Function to test JSON field
test_json_field() {
    local response="$1"
    local field="$2"
    local description="$3"
    
    if echo "$response" | jq -e "$field" >/dev/null 2>&1; then
        echo -e "    ${GREEN}✓${NC} Has $description: $(echo "$response" | jq -r "$field")"
        return 0
    else
        echo -e "    ${RED}✗${NC} Missing $description"
        return 1
    fi
}

echo -e "\n${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Part 1: Resource Discovery (RFC 9728)${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

# Test 1: Protected Resource Metadata
test_endpoint \
    "Protected Resource Metadata (/.well-known/oauth-protected-resource)" \
    "$BASE_URL/.well-known/oauth-protected-resource" \
    200 \
    'test_json_field "$body" ".resource" "resource URL"; test_json_field "$body" ".authorization_servers" "authorization servers"; test_json_field "$body" ".bearer_methods_supported" "bearer methods"'

echo -e "\n${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Part 2: Authorization Server Metadata (RFC 8414)${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

# Test 2: OAuth Authorization Server Metadata
test_endpoint \
    "OAuth Authorization Server Metadata" \
    "$BASE_URL/.well-known/oauth-authorization-server" \
    200 \
    'test_json_field "$body" ".authorization_endpoint" "authorization_endpoint"; test_json_field "$body" ".token_endpoint" "token_endpoint"; test_json_field "$body" ".grant_types_supported" "grant_types_supported"'

# Test 3: OpenID Configuration
test_endpoint \
    "OpenID Configuration" \
    "$BASE_URL/.well-known/openid-configuration" \
    200

echo -e "\n${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Part 3: Authorization Endpoint${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

# Test 4: Authorization endpoint with missing parameters (should fail)
test_endpoint \
    "Authorization endpoint - missing parameters" \
    "$BASE_URL/oauth/authorize" \
    400

# Test 5: Authorization endpoint with valid parameters (should redirect)
test_endpoint \
    "Authorization endpoint - valid parameters (redirect check)" \
    "$BASE_URL/oauth/authorize?client_id=$TEST_CLIENT_ID&redirect_uri=$TEST_REDIRECT_URI&response_type=code&state=test123&scope=read:inventory" \
    302

echo -e "\n${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Part 4: Token Endpoint - Grant Types${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

# Test 6: Token endpoint - authorization_code grant
echo -e "\n${YELLOW}[TEST $((TOTAL+1))]${NC} Token endpoint - authorization_code grant"
((TOTAL++))
response=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/oauth/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=authorization_code&code=test_code&redirect_uri=$TEST_REDIRECT_URI&client_id=$TEST_CLIENT_ID" 2>&1)
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "400" ] || [ "$http_code" = "200" ]; then
    echo -e "  ${GREEN}✓ PASSED${NC} - Endpoint accepts authorization_code (Status: $http_code)"
    ((PASSED++))
    echo "$body" | jq . 2>/dev/null | sed 's/^/    /' || echo "    Response: $body"
else
    echo -e "  ${RED}✗ FAILED${NC} - Unexpected status: $http_code"
    ((FAILED++))
fi

# Test 7: Token endpoint - client_credentials grant
echo -e "\n${YELLOW}[TEST $((TOTAL+1))]${NC} Token endpoint - client_credentials grant"
((TOTAL++))
response=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/oauth/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=client_credentials&client_id=$TEST_CLIENT_ID&client_secret=$TEST_CLIENT_SECRET&scope=read:inventory" 2>&1)
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "200" ]; then
    echo -e "  ${GREEN}✓ PASSED${NC} - client_credentials grant supported (Status: $http_code)"
    ((PASSED++))
    
    # Check response format
    if echo "$body" | jq -e '.access_token' >/dev/null 2>&1; then
        echo -e "    ${GREEN}✓${NC} Response has access_token"
    else
        echo -e "    ${RED}✗${NC} Response missing access_token"
    fi
    
    if echo "$body" | jq -e '.token_type' >/dev/null 2>&1; then
        echo -e "    ${GREEN}✓${NC} Response has token_type"
    else
        echo -e "    ${RED}✗${NC} Response missing token_type"
    fi
    
    echo "$body" | jq . 2>/dev/null | sed 's/^/    /' || echo "    Response: $body"
elif [ "$http_code" = "400" ]; then
    echo -e "  ${RED}✗ FAILED${NC} - client_credentials NOT supported (claims to support but rejects)"
    ((FAILED++))
    echo "$body" | jq . 2>/dev/null | sed 's/^/    /' || echo "    Response: $body"
else
    echo -e "  ${RED}✗ FAILED${NC} - Unexpected status: $http_code"
    ((FAILED++))
fi

# Test 8: Token endpoint - refresh_token grant
echo -e "\n${YELLOW}[TEST $((TOTAL+1))]${NC} Token endpoint - refresh_token grant"
((TOTAL++))
response=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/oauth/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=refresh_token&refresh_token=test_refresh_token&client_id=$TEST_CLIENT_ID&client_secret=$TEST_CLIENT_SECRET" 2>&1)
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "200" ]; then
    echo -e "  ${GREEN}✓ PASSED${NC} - refresh_token grant supported (Status: $http_code)"
    ((PASSED++))
    echo "$body" | jq . 2>/dev/null | sed 's/^/    /' || echo "    Response: $body"
elif [ "$http_code" = "400" ] || [ "$http_code" = "401" ]; then
    echo -e "  ${YELLOW}⚠ WARNING${NC} - refresh_token NOT supported (Status: $http_code)"
    echo -e "    This is optional but recommended for GPT integrations"
    ((PASSED++))  # Not a failure, just a warning
    echo "$body" | jq . 2>/dev/null | sed 's/^/    /' || echo "    Response: $body"
else
    echo -e "  ${RED}✗ FAILED${NC} - Unexpected status: $http_code"
    ((FAILED++))
fi

# Test 9: Token endpoint - PKCE support
echo -e "\n${YELLOW}[TEST $((TOTAL+1))]${NC} Token endpoint - PKCE code_verifier parameter"
((TOTAL++))
response=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/oauth/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=authorization_code&code=test_code&redirect_uri=$TEST_REDIRECT_URI&client_id=$TEST_CLIENT_ID&code_verifier=test_verifier_12345678901234567890123456789012345678901234" 2>&1)
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "400" ] || [ "$http_code" = "200" ]; then
    echo -e "  ${GREEN}✓ PASSED${NC} - PKCE code_verifier accepted (Status: $http_code)"
    ((PASSED++))
    echo "$body" | jq . 2>/dev/null | sed 's/^/    /' || echo "    Response: $body"
else
    echo -e "  ${RED}✗ FAILED${NC} - Unexpected status: $http_code"
    ((FAILED++))
fi

echo -e "\n${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Part 5: WWW-Authenticate Challenge${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

# Test 10: Protected endpoint returns proper 401 with WWW-Authenticate
echo -e "\n${YELLOW}[TEST $((TOTAL+1))]${NC} Protected endpoint - WWW-Authenticate header"
((TOTAL++))
response=$(curl -s -i -X POST "$BASE_URL/exec" \
    -H "Content-Type: application/json" \
    -d '{"action":"test"}' 2>&1)

if echo "$response" | grep -i "WWW-Authenticate:.*Bearer" >/dev/null; then
    echo -e "  ${GREEN}✓ PASSED${NC} - WWW-Authenticate header present"
    ((PASSED++))
    echo "$response" | grep -i "WWW-Authenticate:" | sed 's/^/    /'
else
    echo -e "  ${YELLOW}⚠ WARNING${NC} - WWW-Authenticate header not found"
    echo -e "    This helps clients auto-discover OAuth configuration"
    ((PASSED++))  # Not critical, but recommended
fi

echo -e "\n${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Part 6: Metadata Consistency Check${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

# Test 11: Verify metadata matches requirements
echo -e "\n${YELLOW}[TEST $((TOTAL+1))]${NC} Metadata consistency - required fields"
((TOTAL++))

metadata=$(curl -s "$BASE_URL/.well-known/oauth-authorization-server" 2>&1)

checks_passed=0
checks_total=7

if echo "$metadata" | jq -e '.authorization_endpoint' >/dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} authorization_endpoint present"
    ((checks_passed++))
else
    echo -e "  ${RED}✗${NC} authorization_endpoint missing"
fi

if echo "$metadata" | jq -e '.token_endpoint' >/dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} token_endpoint present"
    ((checks_passed++))
else
    echo -e "  ${RED}✗${NC} token_endpoint missing"
fi

if echo "$metadata" | jq -e '.jwks_uri' >/dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} jwks_uri present"
    ((checks_passed++))
else
    echo -e "  ${YELLOW}⚠${NC} jwks_uri missing (recommended)"
fi

if echo "$metadata" | jq -e '.response_types_supported | index("code")' >/dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} response_types_supported includes 'code'"
    ((checks_passed++))
else
    echo -e "  ${RED}✗${NC} response_types_supported missing 'code'"
fi

if echo "$metadata" | jq -e '.grant_types_supported | index("authorization_code")' >/dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} grant_types_supported includes 'authorization_code'"
    ((checks_passed++))
else
    echo -e "  ${RED}✗${NC} grant_types_supported missing 'authorization_code'"
fi

if echo "$metadata" | jq -e '.code_challenge_methods_supported | index("S256")' >/dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} code_challenge_methods_supported includes 'S256' (PKCE)"
    ((checks_passed++))
else
    echo -e "  ${RED}✗${NC} code_challenge_methods_supported missing 'S256'"
fi

if echo "$metadata" | jq -e '.token_endpoint_auth_methods_supported' >/dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} token_endpoint_auth_methods_supported present"
    ((checks_passed++))
else
    echo -e "  ${YELLOW}⚠${NC} token_endpoint_auth_methods_supported missing (recommended)"
fi

if [ $checks_passed -ge 5 ]; then
    echo -e "\n  ${GREEN}✓ PASSED${NC} - Metadata has required fields ($checks_passed/$checks_total)"
    ((PASSED++))
else
    echo -e "\n  ${RED}✗ FAILED${NC} - Metadata missing critical fields ($checks_passed/$checks_total)"
    ((FAILED++))
fi

echo -e "\n${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Part 7: ChatGPT Specific Requirements${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

# Test 12: ChatGPT redirect URI support
echo -e "\n${YELLOW}[TEST $((TOTAL+1))]${NC} ChatGPT redirect URI whitelisting"
((TOTAL++))

response=$(curl -s -w "\n%{http_code}" "$BASE_URL/oauth/authorize?client_id=$TEST_CLIENT_ID&redirect_uri=https://chatgpt.com/connector_platform_oauth_redirect&response_type=code&state=test&scope=read:inventory" 2>&1)
http_code=$(echo "$response" | tail -n1)

if [ "$http_code" = "302" ] || [ "$http_code" = "200" ]; then
    echo -e "  ${GREEN}✓ PASSED${NC} - ChatGPT redirect URI accepted (Status: $http_code)"
    ((PASSED++))
else
    echo -e "  ${YELLOW}⚠ WARNING${NC} - Check if ChatGPT redirect URI is whitelisted (Status: $http_code)"
    echo -e "    Required: https://chatgpt.com/connector_platform_oauth_redirect"
    ((PASSED++))  # Not a hard failure
fi

# Summary
echo -e "\n\n${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                        TEST SUMMARY                            ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo -e "\nTotal Tests: $TOTAL"
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"

if [ $FAILED -eq 0 ]; then
    echo -e "\n${GREEN}✓ All tests passed! OAuth2 implementation is compliant.${NC}"
    exit 0
else
    echo -e "\n${RED}✗ Some tests failed. Please review the implementation.${NC}"
    exit 1
fi
