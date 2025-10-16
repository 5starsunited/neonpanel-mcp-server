#!/usr/bin/env bash
set -euo pipefail

RESOURCE_BASE="https://mcp.neonpanel.com"              # your MCP host (protected resource)
AUTH_BASE="${AUTH_BASE:-https://my.neonpanel.com}"     # your Authorization Server host
IAT="${IAT:-}"                                         # Initial Access Token for DCR (if required)

curl_json () {
  local url="$1"; shift
  echo "→ GET $url"
  HTTP_CODE=$(curl -sS -o /tmp/resp.json -w "%{http_code}" "$url" "$@")
  echo "  HTTP $HTTP_CODE"
  if [[ "$HTTP_CODE" -lt 200 || "$HTTP_CODE" -ge 300 ]]; then
    echo "  Body:"; cat /tmp/resp.json; echo
    exit 1
  fi
  jq . /tmp/resp.json
}

echo "=== Testing Required Endpoints ==="
echo

echo "1) Protected Resource Metadata (served by the RESOURCE):"
curl_json "$RESOURCE_BASE/.well-known/oauth-protected-resource"

echo
echo "2) OAuth Authorization Server Metadata:"
DISCOVERY_URL="$RESOURCE_BASE/.well-known/oauth-authorization-server"
DISCOVERY_JSON=$(curl -sS "$DISCOVERY_URL")
HTTP_CODE=$?
if [[ $HTTP_CODE -ne 0 ]]; then
  echo "Failed to fetch discovery from $DISCOVERY_URL"; exit 1
fi
echo "$DISCOVERY_JSON" | jq '{issuer, authorization_endpoint, token_endpoint, registration_endpoint}'

REG_ENDPOINT=$(echo "$DISCOVERY_JSON" | jq -r '.registration_endpoint // empty')
if [[ -z "$REG_ENDPOINT" || "$REG_ENDPOINT" == "null" ]]; then
  echo "ERROR: discovery has no registration_endpoint — DCR is not enabled/exposed."
  exit 1
fi
echo
echo "registration_endpoint: $REG_ENDPOINT"

echo
echo "3) Dynamic Client Registration (RFC 7591):"
TMP_META=$(mktemp)
cat > "$TMP_META" <<'JSON'
{
  "application_type": "web",
  "client_name": "DCR Smoke Test",
  "redirect_uris": ["https://chat.openai.com/aip/oauth/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "scope": "read:inventory read:analytics",
  "token_endpoint_auth_method": "none"
}
JSON

AUTHZ_HEADER=()
if [[ -n "$IAT" ]]; then
  AUTHZ_HEADER=(-H "Authorization: Bearer $IAT")
else
  echo "NOTE: No Initial Access Token set; our DCR proxy accepts unauthenticated requests."
fi

echo "→ POST $REG_ENDPOINT"
HTTP_STATUS=$(curl -sS -o /tmp/dcr.json -w "%{http_code}" -X POST "$REG_ENDPOINT" \
  "${AUTHZ_HEADER[@]}" \
  -H "Content-Type: application/json" \
  -d @"$TMP_META")

echo "  HTTP $HTTP_STATUS"
cat /tmp/dcr.json | jq '{client_id, client_secret, client_id_issued_at, client_secret_expires_at, error, error_description}'

if [[ "$HTTP_STATUS" -eq 401 || "$HTTP_STATUS" -eq 403 ]]; then
  echo "DCR rejected (likely missing/invalid IAT) — unexpected for our implementation."
  exit 1
fi

if [[ "$HTTP_STATUS" -ne 200 && "$HTTP_STATUS" -ne 201 ]]; then
  echo "DCR failed with HTTP $HTTP_STATUS"
  exit 1
fi

echo
echo "4) MCP Endpoint handshake sanity:"
curl_json "$RESOURCE_BASE/mcp"

echo
echo "✅ All endpoints verified!"
echo
echo "Next steps:"
echo "  1. Test in ChatGPT: Create custom GPT → Actions → Import from URL"
echo "     URL: $RESOURCE_BASE/mcp"
echo "  2. Or use MCP Inspector:"
echo "     npx @modelcontextprotocol/inspector@latest"
echo "     → connect to $RESOURCE_BASE/mcp"
