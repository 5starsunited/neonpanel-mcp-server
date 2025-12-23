#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://mcp.neonpanel.com}"

json() {
  # Usage: json '{...}'
  curl -sS -D /tmp/mcp_headers.txt \
    -H "Content-Type: application/json" \
    -d "$1" \
    "$BASE_URL/mcp"
}

echo "== initialize (public) =="
resp=$(json '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl-test","version":"0.1"}}}')
echo "$resp" | jq -e '.result.protocolVersion and .result.serverInfo.name' >/dev/null

echo "== initialized (public) =="
resp=$(json '{"jsonrpc":"2.0","id":2,"method":"initialized","params":{}}')
echo "$resp" | jq -e '.result.ok == true' >/dev/null

echo "== tools/list (public) =="
resp=$(json '{"jsonrpc":"2.0","id":3,"method":"tools/list","params":{}}')
echo "$resp" | jq -e '.result.tools | type=="array" and length>0' >/dev/null
# Must include at least one public tool
public_count=$(echo "$resp" | jq -r '[.result.tools[] | select(._meta["openai/visibility"]=="public")] | length')
if [[ "$public_count" -lt 1 ]]; then
  echo "ERROR: tools/list returned no public tools" >&2
  exit 1
fi

echo "== tools/call without token (must be 401 + authenticate metadata) =="
# Capture status + body
status=$(curl -sS -o /tmp/mcp_body.json -w "%{http_code}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"neonpanel.listCompanies","arguments":{}}}' \
  "$BASE_URL/mcp")

if [[ "$status" != "401" ]]; then
  echo "ERROR: expected HTTP 401, got $status" >&2
  echo "Body:" >&2
  cat /tmp/mcp_body.json >&2
  exit 1
fi

jq -e '.error.data._meta["mcp/www_authenticate"] | type=="array" and length>0' /tmp/mcp_body.json >/dev/null

# Also ensure a WWW-Authenticate header is present
if ! grep -qi '^www-authenticate:' /tmp/mcp_headers.txt; then
  echo "ERROR: expected WWW-Authenticate header" >&2
  cat /tmp/mcp_headers.txt >&2
  exit 1
fi

echo "OK: MCP streamable HTTP smoke tests passed at $BASE_URL"
