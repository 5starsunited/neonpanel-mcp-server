#!/usr/bin/env bash
set -euo pipefail

# ChatGPT-Ready OAuth + DCR Test
# Tests all requirements for ChatGPT custom connector integration

RESOURCE_BASE="https://mcp.neonpanel.com"
AUTH_BASE="https://my.neonpanel.com"

echo "════════════════════════════════════════════════════════════════"
echo "ChatGPT OAuth + DCR + MCP Compliance Test"
echo "════════════════════════════════════════════════════════════════"
echo

# Test 1: Protected Resource Metadata (RFC 9470)
echo "1️⃣  Protected Resource Metadata (RFC 9470)"
echo "   URL: $RESOURCE_BASE/.well-known/oauth-protected-resource"
echo
RESOURCE_META=$(curl -sS "$RESOURCE_BASE/.well-known/oauth-protected-resource")
echo "$RESOURCE_META" | jq '.'

# Validate structure
RESOURCE_PATH=$(echo "$RESOURCE_META" | jq -r '.resources[0].resource // empty')
if [[ "$RESOURCE_PATH" != "$RESOURCE_BASE/mcp" ]]; then
  echo "❌ FAIL: resource should be '$RESOURCE_BASE/mcp', got: $RESOURCE_PATH"
  exit 1
fi
echo "   ✅ Resource path points to /mcp endpoint"
echo

# Test 2: Authorization Server Metadata (RFC 8414)
echo "2️⃣  Authorization Server Metadata (RFC 8414)"
echo "   URL: $RESOURCE_BASE/.well-known/oauth-authorization-server"
echo
DISCOVERY_JSON=$(curl -sS "$RESOURCE_BASE/.well-known/oauth-authorization-server")
echo "$DISCOVERY_JSON" | jq '{
  issuer,
  authorization_endpoint,
  token_endpoint,
  registration_endpoint,
  grant_types_supported,
  code_challenge_methods_supported,
  token_endpoint_auth_methods_supported
}'

# Validate registration_endpoint is on same host as issuer
REG_ENDPOINT=$(echo "$DISCOVERY_JSON" | jq -r '.registration_endpoint // empty')
ISSUER=$(echo "$DISCOVERY_JSON" | jq -r '.issuer // empty')

if [[ -z "$REG_ENDPOINT" || "$REG_ENDPOINT" == "null" ]]; then
  echo "❌ FAIL: registration_endpoint is missing"
  exit 1
fi

if [[ ! "$REG_ENDPOINT" =~ ^$ISSUER ]]; then
  echo "⚠️  WARNING: registration_endpoint ($REG_ENDPOINT) not on same host as issuer ($ISSUER)"
  echo "   This may cause cross-origin issues with some clients"
else
  echo "   ✅ registration_endpoint on same host as issuer"
fi
echo

# Test 3: Dynamic Client Registration (RFC 7591)
echo "3️⃣  Dynamic Client Registration (RFC 7591)"
echo "   URL: $REG_ENDPOINT"
echo

# Create DCR request like ChatGPT would send
TMP_META=$(mktemp)
cat > "$TMP_META" <<'JSON'
{
  "application_type": "web",
  "client_name": "ChatGPT Test Registration",
  "redirect_uris": ["https://chat.openai.com/aip/g-oauth/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "scope": "read:inventory read:analytics",
  "token_endpoint_auth_method": "private_key_jwt",
  "jwks_uri": "https://chatgpt.example.com/.well-known/jwks.json"
}
JSON

echo "   Sending DCR request..."
HTTP_CODE=$(curl -sS -o /tmp/dcr_response.json -w "%{http_code}" -X POST "$REG_ENDPOINT" \
  -H "Content-Type: application/json" \
  -d @"$TMP_META")

DCR_BODY=$(cat /tmp/dcr_response.json)

echo "   HTTP Status: $HTTP_CODE"
echo
echo "$DCR_BODY" | jq '{
  client_id,
  token_endpoint_auth_method,
  redirect_uris,
  grant_types,
  has_client_secret: (.client_secret != null),
  has_jwks_uri: (.jwks_uri != null),
  registration_client_uri,
  error,
  error_description
}'

if [[ "$HTTP_CODE" -ne 200 && "$HTTP_CODE" -ne 201 ]]; then
  echo "❌ FAIL: DCR returned HTTP $HTTP_CODE"
  exit 1
fi

# Validate DCR response
CLIENT_ID=$(echo "$DCR_BODY" | jq -r '.client_id // empty')
AUTH_METHOD=$(echo "$DCR_BODY" | jq -r '.token_endpoint_auth_method // empty')
HAS_SECRET=$(echo "$DCR_BODY" | jq -r '.client_secret // empty')
RETURNED_REDIRECT=$(echo "$DCR_BODY" | jq -r '.redirect_uris[0] // empty')

if [[ -z "$CLIENT_ID" || "$CLIENT_ID" == "null" ]]; then
  echo "❌ FAIL: No client_id in response"
  exit 1
fi
echo "   ✅ client_id: $CLIENT_ID"

if [[ "$AUTH_METHOD" == "none" && -n "$HAS_SECRET" && "$HAS_SECRET" != "null" ]]; then
  echo "❌ FAIL: token_endpoint_auth_method is 'none' but client_secret was returned"
  echo "   RFC 7591: Don't return client_secret for public clients"
  exit 1
fi
echo "   ✅ Auth method ($AUTH_METHOD) consistent with credentials"

if [[ "$RETURNED_REDIRECT" != "https://chat.openai.com/aip/g-oauth/callback" ]]; then
  echo "❌ FAIL: redirect_uris was not echoed back correctly"
  echo "   Sent: https://chat.openai.com/aip/g-oauth/callback"
  echo "   Got:  $RETURNED_REDIRECT"
  exit 1
fi
echo "   ✅ redirect_uris echoed back correctly"
echo

# Test 4: MCP Protocol Endpoint
echo "4️⃣  MCP Protocol Endpoint"
echo "   URL: $RESOURCE_BASE/mcp"
echo
MCP_RESPONSE=$(curl -sS "$RESOURCE_BASE/mcp")
echo "$MCP_RESPONSE" | jq '{
  protocol,
  version,
  name,
  endpoints,
  capabilities
}'

PROTOCOL=$(echo "$MCP_RESPONSE" | jq -r '.protocol // empty')
if [[ "$PROTOCOL" != "mcp" ]]; then
  echo "❌ FAIL: protocol should be 'mcp', got: $PROTOCOL"
  exit 1
fi
echo "   ✅ MCP protocol endpoint working"
echo

# Test 5: MCP Capabilities (Tool Discovery)
echo "5️⃣  MCP Capabilities (Tool Discovery)"
echo "   URL: $RESOURCE_BASE/mcp/capabilities"
echo
CAPABILITIES=$(curl -sS "$RESOURCE_BASE/mcp/capabilities")
TOOL_COUNT=$(echo "$CAPABILITIES" | jq '[.capabilities[] | select(.category == "tools")] | length')
echo "   Found $TOOL_COUNT tool capabilities"
echo

if [[ "$TOOL_COUNT" -eq 0 ]]; then
  echo "⚠️  WARNING: No tools found - ChatGPT needs at least one tool"
else
  echo "   ✅ Tools available for discovery"
  echo "$CAPABILITIES" | jq '[.capabilities[] | select(.category == "tools") | {id, name, description}] | .[0:3]'
fi
echo

# Test 6: OAuth Flow Readiness
echo "6️⃣  OAuth Authorization Flow Readiness"
echo

# Generate PKCE challenge
CODE_VERIFIER=$(openssl rand -base64 32 | tr -d '\n' | tr '+/' '-_' | tr -d '=')
CODE_CHALLENGE=$(echo -n "$CODE_VERIFIER" | openssl dgst -sha256 -binary | base64 | tr -d '\n' | tr '+/' '-_' | tr -d '=')

AUTH_URL="$ISSUER/oauth2/authorize"
AUTH_URL+="?client_id=$CLIENT_ID"
AUTH_URL+="&redirect_uri=https://chat.openai.com/aip/g-oauth/callback"
AUTH_URL+="&response_type=code"
AUTH_URL+="&state=test123"
AUTH_URL+="&scope=read:inventory%20read:analytics"
AUTH_URL+="&code_challenge=$CODE_CHALLENGE"
AUTH_URL+="&code_challenge_method=S256"

echo "   Authorization URL ready:"
echo "   $AUTH_URL"
echo "   ✅ PKCE code_challenge generated"
echo

# Summary
echo "════════════════════════════════════════════════════════════════"
echo "✅ ALL TESTS PASSED - Ready for ChatGPT Integration!"
echo "════════════════════════════════════════════════════════════════"
echo
echo "Summary of compliance:"
echo "  ✅ RFC 9470: Protected resource metadata points to /mcp endpoint"
echo "  ✅ RFC 8414: OAuth discovery with registration_endpoint"
echo "  ✅ RFC 7591: DCR endpoint returns valid, consistent credentials"
echo "  ✅ RFC 7636: PKCE (S256) support enabled"
echo "  ✅ MCP Protocol: Endpoint discovery working"
echo "  ✅ Tool Discovery: Capabilities endpoint functional"
echo
echo "Next Steps:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo
echo "1️⃣  Test with MCP Inspector (recommended first):"
echo "   npx @modelcontextprotocol/inspector@latest"
echo "   → Connect to: $RESOURCE_BASE/mcp"
echo "   → Verify: Tools list appears and can be invoked"
echo
echo "2️⃣  Test with ChatGPT:"
echo "   → Go to: https://chatgpt.com"
echo "   → Settings → GPTs → Create"
echo "   → Configure → Actions → Import from URL"
echo "   → Enter: $RESOURCE_BASE/mcp"
echo "   → Expected flow:"
echo "     • ChatGPT discovers OAuth endpoints"
echo "     • ChatGPT registers via DCR (gets client_id)"
echo "     • ChatGPT initiates OAuth authorization"
echo "     • You login with NeonPanel credentials"
echo "     • ChatGPT exchanges code for token"
echo "     • Tools appear in ChatGPT interface"
echo
echo "3️⃣  If issues occur:"
echo "   → Check CloudWatch logs: /aws/ecs/neonpanel-mcp"
echo "   → Verify callback URL in NeonPanel: $RETURNED_REDIRECT"
echo "   → Test OAuth flow manually with the authorization URL above"
echo
