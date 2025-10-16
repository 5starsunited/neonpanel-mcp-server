#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${BASE_URL:-${1:-"http://localhost:3030"}}

printerr() {
  printf "[discovery] %s\n" "$1" >&2
}

printerr "Checking discovery endpoints for ${BASE_URL}"

pretty_print_json() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -m json.tool || cat
  elif command -v python >/dev/null 2>&1; then
    python -m json.tool || cat
  elif command -v jq >/dev/null 2>&1; then
    jq '.' || cat
  else
    cat
  fi
}

printerr "GET /.well-known/oauth-protected-resource"
curl -sfSL "${BASE_URL}/.well-known/oauth-protected-resource" | pretty_print_json

printerr "GET /.well-known/oauth-authorization-server"
curl -sfSL "${BASE_URL}/.well-known/oauth-authorization-server" | pretty_print_json

printerr "GET /.well-known/openid-configuration"
curl -sfSL "${BASE_URL}/.well-known/openid-configuration" | pretty_print_json

printerr "POST /exec without token (expect 401 with WWW-Authenticate)"
HTTP_RESPONSE=$(curl -s -o /tmp/mcp_exec_response.txt -w "%{http_code}" -X POST "${BASE_URL}/exec" -H 'Content-Type: application/json' -d '{"action":"noop"}')
cat /tmp/mcp_exec_response.txt
rm /tmp/mcp_exec_response.txt

if [[ "${HTTP_RESPONSE}" != "401" ]]; then
  printerr "Unexpected status from /exec: ${HTTP_RESPONSE}" && exit 1
fi

printerr "WWW-Authenticate header:"
curl -s -o /dev/null -D - "${BASE_URL}/exec" -X POST -H 'Content-Type: application/json' -d '{"action":"noop"}' | grep -i 'WWW-Authenticate' || true

echo "Discovery smoke test complete."
