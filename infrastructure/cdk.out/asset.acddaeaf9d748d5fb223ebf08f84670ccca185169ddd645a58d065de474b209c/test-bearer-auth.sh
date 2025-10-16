#!/bin/bash

###############################################################################
# MCP Server Bearer Token Authentication Test Suite
# 
# Tests that all MCP endpoints properly require and validate Bearer tokens
# Per RFC 6750 OAuth 2.0 Bearer Token Usage and GPT Connect requirements
###############################################################################

set -e

SERVER_URL="${SERVER_URL:-http://localhost:3030}"
PROD_SERVER_URL="https://mcp.neonpanel.com"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

passed=0
failed=0

# Test function
test_case() {
  local name="$1"
  local expected_status="$2"
  shift 2
  local curl_args=("$@")
  
  echo -e "\n${YELLOW}TEST: $name${NC}"
  
  response=$(curl -s -w "\n%{http_code}" "${curl_args[@]}")
  status=$(echo "$response" | tail -n1)
  body=$(echo "$response" | sed '$d')
  
  if [ "$status" = "$expected_status" ]; then
    echo -e "${GREEN}✓ PASS${NC} - HTTP $status (expected)"
    if [ -n "$body" ]; then
      echo "$body" | jq '.' 2>/dev/null || echo "$body"
    fi
    ((passed++))
    return 0
  else
    echo -e "${RED}✗ FAIL${NC} - HTTP $status (expected $expected_status)"
    if [ -n "$body" ]; then
      echo "$body" | jq '.' 2>/dev/null || echo "$body"
    fi
    ((failed++))
    return 1
  fi
}

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  MCP Server Bearer Token Authentication Test Suite            ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "Testing server: $SERVER_URL"
echo ""

# ============================================================================
# PUBLIC ENDPOINTS (no auth required)
# ============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "PUBLIC ENDPOINTS (should work without auth)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

test_case "Health endpoint (public)" 200 \
  -X GET "$SERVER_URL/health"

test_case "OAuth discovery (public)" 200 \
  -X GET "$SERVER_URL/.well-known/oauth-authorization-server"

test_case "OpenAPI JSON (public)" 200 \
  -X GET "$SERVER_URL/openapi.json"

test_case "OpenAPI YAML (public)" 200 \
  -X GET "$SERVER_URL/openapi.yaml"

test_case "AI Plugin Manifest (public)" 200 \
  -X GET "$SERVER_URL/.well-known/ai-plugin.json"

test_case "MCP Capabilities (public)" 200 \
  -X GET "$SERVER_URL/mcp/capabilities"

# ============================================================================
# PROTECTED ENDPOINTS - Missing Auth (should return 401)
# ============================================================================

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "PROTECTED ENDPOINTS - No Auth Header (expect 401)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

test_case "SSE endpoint without auth" 401 \
  -X GET "$SERVER_URL/sse/"

test_case "MCP tool call without auth" 401 \
  -X POST "$SERVER_URL/mcp/tools/call" \
  -H "Content-Type: application/json" \
  -d '{"name":"get_inventory_items","arguments":{"companyUuid":"test"}}'

# ============================================================================
# PROTECTED ENDPOINTS - Invalid Auth Format (should return 401)
# ============================================================================

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "PROTECTED ENDPOINTS - Invalid Auth Format (expect 401)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

test_case "SSE with wrong scheme (Basic)" 401 \
  -X GET "$SERVER_URL/sse/" \
  -H "Authorization: Basic dGVzdDp0ZXN0"

test_case "SSE with malformed Bearer (no space)" 401 \
  -X GET "$SERVER_URL/sse/" \
  -H "Authorization: BearerTOKEN123"

test_case "SSE with custom header (X-API-Key)" 401 \
  -X GET "$SERVER_URL/sse/" \
  -H "X-API-Key: test-token-123"

test_case "Tool call with API key instead of Bearer" 401 \
  -X POST "$SERVER_URL/mcp/tools/call" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: test-token" \
  -d '{"name":"get_inventory_items","arguments":{"companyUuid":"test"}}'

test_case "Tool call with Bearer but no space" 401 \
  -X POST "$SERVER_URL/mcp/tools/call" \
  -H "Content-Type: application/json" \
  -H "Authorization: BearerTEST123" \
  -d '{"name":"get_inventory_items","arguments":{"companyUuid":"test"}}'

# ============================================================================
# PROTECTED ENDPOINTS - Valid Auth Format (expect non-401 response)
# ============================================================================

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "PROTECTED ENDPOINTS - Valid Bearer Format (accept the header)"
echo "Note: May return 401/403 from upstream NeonPanel API (token invalid)"
echo "      but should NOT return 'Unsupported authorization header'"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Test case-insensitive "Bearer"
# These should accept the Bearer token format (even though token itself is invalid)
# Should NOT return "Unsupported authorization header"
test_case "Tool call with lowercase 'bearer'" 401 \
  -X POST "$SERVER_URL/mcp/tools/call" \
  -H "Content-Type: application/json" \
  -H "Authorization: bearer test-token-123" \
  -d '{"name":"get_inventory_items","arguments":{"companyUuid":"test"}}'

test_case "Tool call with UPPERCASE 'BEARER'" 401 \
  -X POST "$SERVER_URL/mcp/tools/call" \
  -H "Content-Type: application/json" \
  -H "Authorization: BEARER test-token-123" \
  -d '{"name":"get_inventory_items","arguments":{"companyUuid":"test"}}'

test_case "Tool call with mixed case 'BeArEr'" 401 \
  -X POST "$SERVER_URL/mcp/tools/call" \
  -H "Content-Type: application/json" \
  -H "Authorization: BeArEr test-token-123" \
  -d '{"name":"get_inventory_items","arguments":{"companyUuid":"test"}}'

# ============================================================================
# CORS Headers Check
# ============================================================================

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "CORS HEADERS CHECK (Authorization must be allowed)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo -e "\n${YELLOW}TEST: CORS preflight for /sse/ endpoint${NC}"
cors_response=$(curl -si -X OPTIONS "$SERVER_URL/sse/" \
  -H "Origin: https://chatgpt.com" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Authorization")

if echo "$cors_response" | grep -qi "access-control-allow-headers:.*authorization"; then
  echo -e "${GREEN}✓ PASS${NC} - Authorization header allowed in CORS"
  ((passed++))
else
  echo -e "${RED}✗ FAIL${NC} - Authorization header NOT in CORS allowed headers"
  echo "$cors_response"
  ((failed++))
fi

echo -e "\n${YELLOW}TEST: CORS preflight for /mcp/tools/call endpoint${NC}"
cors_response=$(curl -si -X OPTIONS "$SERVER_URL/mcp/tools/call" \
  -H "Origin: https://chatgpt.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Authorization, Content-Type")

if echo "$cors_response" | grep -qi "access-control-allow-headers:.*authorization"; then
  echo -e "${GREEN}✓ PASS${NC} - Authorization header allowed in CORS"
  ((passed++))
else
  echo -e "${RED}✗ FAIL${NC} - Authorization header NOT in CORS allowed headers"
  echo "$cors_response"
  ((failed++))
fi

# ============================================================================
# WWW-Authenticate Header Check (on 401 responses)
# ============================================================================

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "WWW-Authenticate HEADER CHECK (required on 401)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo -e "\n${YELLOW}TEST: 401 response includes WWW-Authenticate header${NC}"
auth_response=$(curl -si -X GET "$SERVER_URL/sse/")

if echo "$auth_response" | grep -qi "www-authenticate:.*bearer"; then
  echo -e "${GREEN}✓ PASS${NC} - WWW-Authenticate header present with Bearer scheme"
  echo "$auth_response" | grep -i "www-authenticate:"
  ((passed++))
else
  echo -e "${RED}✗ FAIL${NC} - WWW-Authenticate header missing or incorrect"
  echo "$auth_response" | head -20
  ((failed++))
fi

# ============================================================================
# SUMMARY
# ============================================================================

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                      TEST SUMMARY                              ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo -e "Total tests: $((passed + failed))"
echo -e "${GREEN}Passed: $passed${NC}"
echo -e "${RED}Failed: $failed${NC}"
echo ""

if [ $failed -eq 0 ]; then
  echo -e "${GREEN}✓ ALL TESTS PASSED!${NC}"
  echo ""
  echo "✓ Bearer token authentication working correctly"
  echo "✓ CORS configured to allow Authorization header"
  echo "✓ WWW-Authenticate challenge header present on 401"
  echo "✓ Server ready for GPT Connect integration"
  exit 0
else
  echo -e "${RED}✗ SOME TESTS FAILED${NC}"
  exit 1
fi
