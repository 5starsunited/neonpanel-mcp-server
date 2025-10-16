#!/bin/bash

# Test NeonPanel API DCR Endpoint Readiness
# This tests if NeonPanel has implemented DCR at https://my.neonpanel.com/oauth2/register
#
# Usage: ./test-neonpanel-dcr-ready.sh [INITIAL_ACCESS_TOKEN]
#
# If Initial Access Token is required by NeonPanel, provide it as first argument

set -e

BASE_URL="https://my.neonpanel.com"
DCR_URL="${BASE_URL}/oauth2/register"
IAT_TOKEN="$1"

echo "🔍 Testing NeonPanel API DCR Implementation"
echo "=========================================="
echo ""

if [ -n "$IAT_TOKEN" ]; then
  echo "🔑 Using Initial Access Token (IAT)"
  echo "   Token length: ${#IAT_TOKEN} characters"
  echo ""
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

TEST_PASSED=0
TEST_FAILED=0

# Test 1: Check if DCR endpoint exists
echo "1️⃣  Testing DCR Endpoint Availability"
echo "   URL: ${DCR_URL}"

# Build curl command with optional IAT
if [ -n "$IAT_TOKEN" ]; then
  DCR_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${DCR_URL}" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${IAT_TOKEN}" \
    -d '{
      "redirect_uris": ["https://chat.openai.com/aip/oauth/callback"],
      "client_name": "ChatGPT Test Client",
      "grant_types": ["authorization_code", "refresh_token"],
      "response_types": ["code"],
      "token_endpoint_auth_method": "none",
      "scope": "openid profile email"
    }' 2>&1 || echo "000")
else
  DCR_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${DCR_URL}" \
    -H "Content-Type: application/json" \
    -d '{
      "redirect_uris": ["https://chat.openai.com/aip/oauth/callback"],
      "client_name": "ChatGPT Test Client",
      "grant_types": ["authorization_code", "refresh_token"],
      "response_types": ["code"],
      "token_endpoint_auth_method": "none",
      "scope": "openid profile email"
    }' 2>&1 || echo "000")
fi

HTTP_CODE=$(echo "$DCR_RESPONSE" | tail -n1)
RESPONSE_BODY=$(echo "$DCR_RESPONSE" | sed '$d')

echo "   HTTP Status: ${HTTP_CODE}"

if [ "$HTTP_CODE" == "201" ]; then
  echo -e "   ${GREEN}✅ DCR endpoint is responding${NC}"
  TEST_PASSED=$((TEST_PASSED + 1))
  
  # Test 2: Validate response structure
  echo ""
  echo "2️⃣  Validating DCR Response Structure"
  
  # Check for required fields
  CLIENT_ID=$(echo "$RESPONSE_BODY" | jq -r '.client_id // empty')
  REDIRECT_URIS=$(echo "$RESPONSE_BODY" | jq -r '.redirect_uris[0] // empty')
  GRANT_TYPES=$(echo "$RESPONSE_BODY" | jq -r '.grant_types[0] // empty')
  
  if [ -n "$CLIENT_ID" ]; then
    echo -e "   ${GREEN}✅ client_id present: ${CLIENT_ID}${NC}"
    TEST_PASSED=$((TEST_PASSED + 1))
  else
    echo -e "   ${RED}❌ client_id missing${NC}"
    TEST_FAILED=$((TEST_FAILED + 1))
  fi
  
  if [ "$REDIRECT_URIS" == "https://chat.openai.com/aip/oauth/callback" ]; then
    echo -e "   ${GREEN}✅ redirect_uris echoed correctly${NC}"
    TEST_PASSED=$((TEST_PASSED + 1))
  else
    echo -e "   ${RED}❌ redirect_uris not echoed correctly${NC}"
    echo "      Expected: https://chat.openai.com/aip/oauth/callback"
    echo "      Got: ${REDIRECT_URIS}"
    TEST_FAILED=$((TEST_FAILED + 1))
  fi
  
  if [ "$GRANT_TYPES" == "authorization_code" ]; then
    echo -e "   ${GREEN}✅ grant_types present${NC}"
    TEST_PASSED=$((TEST_PASSED + 1))
  else
    echo -e "   ${RED}❌ grant_types missing or incorrect${NC}"
    TEST_FAILED=$((TEST_FAILED + 1))
  fi
  
  # Check expected client_id (should be the pre-registered one)
  EXPECTED_CLIENT_ID="1145f268-a864-11f0-8a3d-122c1fe52bef"
  if [ "$CLIENT_ID" == "$EXPECTED_CLIENT_ID" ]; then
    echo -e "   ${GREEN}✅ Returns expected client_id (pre-registered)${NC}"
    TEST_PASSED=$((TEST_PASSED + 1))
  else
    echo -e "   ${YELLOW}⚠️  client_id different from expected${NC}"
    echo "      Expected: ${EXPECTED_CLIENT_ID}"
    echo "      Got: ${CLIENT_ID}"
    echo "      (This may be OK if NeonPanel generates dynamic IDs)"
  fi
  
  # Test 3: Check OAuth discovery points to this DCR
  echo ""
  echo "3️⃣  Verifying OAuth Discovery Metadata"
  DISCOVERY_URL="${BASE_URL}/.well-known/oauth-authorization-server"
  DISCOVERY=$(curl -s "${DISCOVERY_URL}")
  
  REGISTRATION_ENDPOINT=$(echo "$DISCOVERY" | jq -r '.registration_endpoint // empty')
  
  if [ "$REGISTRATION_ENDPOINT" == "$DCR_URL" ]; then
    echo -e "   ${GREEN}✅ OAuth discovery points to DCR endpoint${NC}"
    echo "      registration_endpoint: ${REGISTRATION_ENDPOINT}"
    TEST_PASSED=$((TEST_PASSED + 1))
  else
    echo -e "   ${RED}❌ OAuth discovery doesn't point to DCR${NC}"
    echo "      Expected: ${DCR_URL}"
    echo "      Got: ${REGISTRATION_ENDPOINT}"
    TEST_FAILED=$((TEST_FAILED + 1))
  fi
  
elif [ "$HTTP_CODE" == "000" ] || [ "$HTTP_CODE" == "404" ]; then
  echo -e "   ${RED}❌ DCR endpoint not available${NC}"
  echo ""
  echo "   NeonPanel API has NOT implemented DCR yet."
  echo "   Expected endpoint: ${DCR_URL}"
  echo ""
  TEST_FAILED=$((TEST_FAILED + 1))
  
elif [ "$HTTP_CODE" == "400" ]; then
  echo -e "   ${YELLOW}⚠️  Endpoint exists but returned 400 Bad Request${NC}"
  echo "   Response: ${RESPONSE_BODY}"
  echo ""
  echo "   This might mean DCR is implemented but has validation issues."
  TEST_FAILED=$((TEST_FAILED + 1))
  
else
  echo -e "   ${RED}❌ Unexpected response: ${HTTP_CODE}${NC}"
  echo "   Response: ${RESPONSE_BODY}"
  TEST_FAILED=$((TEST_FAILED + 1))
fi

# Summary
echo ""
echo "=========================================="
echo "📊 Test Summary"
echo "=========================================="
echo -e "Tests Passed: ${GREEN}${TEST_PASSED}${NC}"
echo -e "Tests Failed: ${RED}${TEST_FAILED}${NC}"
echo ""

if [ $TEST_FAILED -eq 0 ]; then
  echo -e "${GREEN}✅ NeonPanel API DCR is READY!${NC}"
  echo ""
  echo "Next steps:"
  echo "1. Update MCP server tests to use NeonPanel DCR"
  echo "2. Deploy MCP server"
  echo "3. Test with ChatGPT"
  exit 0
else
  echo -e "${RED}❌ NeonPanel API DCR is NOT ready yet${NC}"
  echo ""
  echo "Action needed:"
  echo "- Wait for NeonPanel API team to implement DCR"
  echo "- Share NEONPANEL_API_REQUIREMENTS.md with them"
  exit 1
fi
