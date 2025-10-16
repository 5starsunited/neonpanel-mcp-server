#!/bin/bash

# NeonPanel MCP Server Complete Integration Test
# Tests OAuth discovery, DCR integration, and full flow

set -e

MCP_SERVER_URL="${MCP_SERVER_URL:-https://mcp.neonpanel.com}"
NEONPANEL_DCR_URL="https://my.neonpanel.com/oauth2/register"

echo "🧪 NeonPanel MCP Server Complete Integration Test"
echo "=================================================="
echo ""
echo "MCP Server: $MCP_SERVER_URL"
echo "NeonPanel DCR: $NEONPANEL_DCR_URL"
echo ""

TESTS_PASSED=0
TESTS_FAILED=0

# Helper function to check HTTP status
check_status() {
    local expected=$1
    local actual=$2
    local test_name=$3
    
    if [ "$actual" -eq "$expected" ]; then
        echo "   ✅ HTTP Status: $actual (expected $expected)"
        return 0
    else
        echo "   ❌ HTTP Status: $actual (expected $expected)"
        return 1
    fi
}

# Test 1: Health Check
echo "Test 1: Health Check (/health)"
echo "---"
RESPONSE=$(curl -s -w "\n%{http_code}" "$MCP_SERVER_URL/health")
HTTP_STATUS=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if check_status 200 "$HTTP_STATUS" "Health Check"; then
    # Check for required fields
    if echo "$BODY" | jq -e '.status' > /dev/null 2>&1; then
        STATUS=$(echo "$BODY" | jq -r '.status')
        echo "   ✅ Status: $STATUS"
    else
        echo "   ❌ status field missing"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
    
    if echo "$BODY" | jq -e '.service' > /dev/null 2>&1; then
        SERVICE=$(echo "$BODY" | jq -r '.service')
        echo "   ✅ Service: $SERVICE"
    else
        echo "   ❌ service field missing"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
    
    if echo "$BODY" | jq -e '.api.capabilities' > /dev/null 2>&1; then
        CAPABILITIES=$(echo "$BODY" | jq -r '.api.capabilities')
        echo "   ✅ Capabilities: $CAPABILITIES"
    else
        echo "   ⚠️  capabilities not reported"
    fi
    
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi

echo ""
echo "Health Response:"
echo "$BODY" | jq '.'
echo ""

# Test 2: OAuth Discovery Endpoint
echo "Test 2: OAuth Discovery (.well-known/oauth-authorization-server)"
echo "---"
RESPONSE=$(curl -s -w "\n%{http_code}" "$MCP_SERVER_URL/.well-known/oauth-authorization-server")
HTTP_STATUS=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if check_status 200 "$HTTP_STATUS" "OAuth Discovery"; then
    # Check registration_endpoint points to NeonPanel
    REGISTRATION_ENDPOINT=$(echo "$BODY" | jq -r '.registration_endpoint')
    if [ "$REGISTRATION_ENDPOINT" = "$NEONPANEL_DCR_URL" ]; then
        echo "   ✅ registration_endpoint points to NeonPanel: $REGISTRATION_ENDPOINT"
    else
        echo "   ❌ registration_endpoint incorrect: $REGISTRATION_ENDPOINT (expected $NEONPANEL_DCR_URL)"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
    
    # Check for required OAuth endpoints
    if echo "$BODY" | jq -e '.authorization_endpoint' > /dev/null 2>&1; then
        AUTH_ENDPOINT=$(echo "$BODY" | jq -r '.authorization_endpoint')
        echo "   ✅ authorization_endpoint present: $AUTH_ENDPOINT"
    else
        echo "   ❌ authorization_endpoint missing"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
    
    if echo "$BODY" | jq -e '.token_endpoint' > /dev/null 2>&1; then
        TOKEN_ENDPOINT=$(echo "$BODY" | jq -r '.token_endpoint')
        echo "   ✅ token_endpoint present: $TOKEN_ENDPOINT"
    else
        echo "   ❌ token_endpoint missing"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
    
    # Check supported grant types
    if echo "$BODY" | jq -e '.grant_types_supported | index("authorization_code")' > /dev/null 2>&1; then
        echo "   ✅ authorization_code grant supported"
    else
        echo "   ❌ authorization_code grant not supported"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
    
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi

echo ""
echo "OAuth Discovery Response:"
echo "$BODY" | jq '.'
echo ""

# Test 3: OpenAPI Specification
echo "Test 3: OpenAPI Specification (openapi.yaml)"
echo "---"
RESPONSE=$(curl -s -w "\n%{http_code}" "$MCP_SERVER_URL/openapi.yaml")
HTTP_STATUS=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if check_status 200 "$HTTP_STATUS" "OpenAPI Spec"; then
    # Check for OpenAPI version
    if echo "$BODY" | grep -q "openapi:"; then
        OPENAPI_VERSION=$(echo "$BODY" | grep "openapi:" | head -1 | awk '{print $2}')
        echo "   ✅ OpenAPI version: $OPENAPI_VERSION"
    else
        echo "   ❌ OpenAPI version declaration missing"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
    
    # Check for paths
    if echo "$BODY" | grep -q "paths:"; then
        echo "   ✅ API paths defined"
    else
        echo "   ❌ API paths missing"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
    
    # Check for security schemes
    if echo "$BODY" | grep -q "securitySchemes:"; then
        echo "   ✅ Security schemes defined"
    else
        echo "   ❌ Security schemes missing"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
    
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi

echo ""

# Test 4: Health/Info Endpoint
echo "Test 4: Server Health/Info Endpoint"
echo "---"
RESPONSE=$(curl -s -w "\n%{http_code}" "$MCP_SERVER_URL/")
HTTP_STATUS=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if check_status 200 "$HTTP_STATUS" "Health Check"; then
    echo "   ✅ Server is responding"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    echo "   ⚠️  No health endpoint (this is optional)"
fi

echo ""

# Test 5: Verify No DCR Proxy
echo "Test 5: Verify DCR Proxy Removed (should 404)"
echo "---"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$MCP_SERVER_URL/oauth2/register" \
    -H "Content-Type: application/json" \
    -d '{"redirect_uris":["https://test.example.com/callback"]}')
HTTP_STATUS=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_STATUS" -eq 404 ] || [ "$HTTP_STATUS" -eq 405 ]; then
    echo "   ✅ DCR proxy correctly removed (HTTP $HTTP_STATUS)"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    echo "   ❌ DCR proxy still responding (HTTP $HTTP_STATUS) - should be removed"
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi

echo ""

# Test 6: CORS Headers
echo "Test 6: CORS Configuration"
echo "---"
CORS_HEADERS=$(curl -s -I -X OPTIONS "$MCP_SERVER_URL/.well-known/ai-plugin.json" \
    -H "Origin: https://chat.openai.com" \
    -H "Access-Control-Request-Method: GET")

if echo "$CORS_HEADERS" | grep -qi "access-control-allow-origin"; then
    CORS_ORIGIN=$(echo "$CORS_HEADERS" | grep -i "access-control-allow-origin" | cut -d: -f2- | tr -d '[:space:]')
    echo "   ✅ CORS headers present: $CORS_ORIGIN"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    echo "   ⚠️  CORS headers not detected (may still work)"
fi

echo ""

# Test 7: Check MCP <-> NeonPanel Integration
echo "Test 7: MCP Server Points to NeonPanel DCR"
echo "---"

# Get OAuth discovery from MCP
MCP_OAUTH_DISCOVERY=$(curl -s "$MCP_SERVER_URL/.well-known/oauth-authorization-server")
MCP_REG_ENDPOINT=$(echo "$MCP_OAUTH_DISCOVERY" | jq -r '.registration_endpoint')

# Get MCP plugin manifest
MCP_PLUGIN_MANIFEST=$(curl -s "$MCP_SERVER_URL/.well-known/ai-plugin.json")
MCP_AUTH_URL=$(echo "$MCP_PLUGIN_MANIFEST" | jq -r '.auth.authorization_url')

echo "   MCP registration_endpoint: $MCP_REG_ENDPOINT"
echo "   Expected: $NEONPANEL_DCR_URL"

if [ "$MCP_REG_ENDPOINT" = "$NEONPANEL_DCR_URL" ]; then
    echo "   ✅ MCP correctly points to NeonPanel DCR"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    echo "   ❌ MCP registration endpoint mismatch"
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi

if echo "$MCP_AUTH_URL" | grep -q "my.neonpanel.com"; then
    echo "   ✅ Authorization URL points to NeonPanel"
else
    echo "   ❌ Authorization URL doesn't point to NeonPanel: $MCP_AUTH_URL"
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi

echo ""

# Test 8: SSL/TLS Configuration
echo "Test 8: SSL/TLS Security"
echo "---"
if [[ "$MCP_SERVER_URL" == https://* ]]; then
    SSL_INFO=$(curl -s -I "$MCP_SERVER_URL/.well-known/ai-plugin.json" 2>&1)
    if [ $? -eq 0 ]; then
        echo "   ✅ HTTPS connection successful"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo "   ❌ HTTPS connection failed"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
else
    echo "   ⚠️  Not using HTTPS (required for production)"
fi

echo ""

# Summary
echo "=========================================="
echo "📊 MCP Server Integration Test Results"
echo "=========================================="
echo "Total Tests Run: $((TESTS_PASSED + TESTS_FAILED))"
echo "Tests Passed: $TESTS_PASSED"
echo "Tests Failed: $TESTS_FAILED"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo "✅ ALL TESTS PASSED! MCP Server is ready for ChatGPT integration!"
    echo ""
    echo "Next steps:"
    echo "1. Test in ChatGPT: Import $MCP_SERVER_URL/mcp"
    echo "2. Complete OAuth flow"
    echo "3. Verify tool discovery and execution"
    exit 0
else
    echo "⚠️ Some tests failed. Review errors above."
    exit 1
fi
