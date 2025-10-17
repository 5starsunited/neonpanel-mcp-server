#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${BASE_URL:-http://localhost:3000}
TOKEN=${ACCESS_TOKEN:-}

if [[ -z "$TOKEN" ]]; then
  echo "ACCESS_TOKEN environment variable is required" >&2
  exit 1
fi

echo "[+] Checking /healthz"
curl -sSf "${BASE_URL}/healthz" | jq '.'

echo "[+] Sending initialize over /messages"
curl -sSf \
  -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"init","method":"initialize"}' \
  "${BASE_URL}/messages" | jq '.'

echo "[+] Tool list"
curl -sSf \
  -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"tools","method":"tools/list"}' \
  "${BASE_URL}/messages" | jq '.'

cat <<'EOF'

To open an SSE stream run:
  curl -N -H "Authorization: Bearer ${ACCESS_TOKEN}" "${BASE_URL}/sse"
EOF
