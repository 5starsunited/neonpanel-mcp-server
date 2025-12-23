#!/usr/bin/env bash

# End-to-end OAuth test using a ChatGPT-connector-style redirect URI.
#
# Goal: Validate that https://my.neonpanel.com/oauth2/token returns a JSON body
# containing `access_token` for an authorization_code + PKCE exchange.
#
# This reproduces what ChatGPT's backend does, but with a verifier we control.
#
# Usage (two-step, avoids interactive stdin so it works well in automation):
#   1) ./scripts/test-oauth-chatgpt-connector-redirect.sh start
#        -> prints an authorization URL and writes state to .tmp/oauth-connector-test.json
#   2) ./scripts/test-oauth-chatgpt-connector-redirect.sh exchange '<PASTE_REDIRECT_URL>'
#        -> exchanges the code for an access token using the saved PKCE verifier
#
# Notes:
# - You must be able to log into my.neonpanel.com in a browser.
# - The browser will redirect to chatgpt.com; the page may error/404, that's OK.
#   Just copy the final URL from the address bar (it contains `code=`).

set -euo pipefail

AUTH_BASE="${AUTH_BASE:-https://my.neonpanel.com}"
REDIRECT_URI="${REDIRECT_URI:-https://chatgpt.com/connector_platform_oauth_redirect}"
SCOPE="${SCOPE:-neonpanel.mcp}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$ROOT_DIR/.tmp"
STATE_FILE="$STATE_DIR/oauth-connector-test.json"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

need curl
need jq
need openssl

MODE="${1:-start}"
REDIRECT_INPUT="${2:-}"

if [[ "$MODE" != "start" && "$MODE" != "exchange" ]]; then
  echo "Usage:" >&2
  echo "  $0 start" >&2
  echo "  $0 exchange '<PASTE_REDIRECT_URL>'" >&2
  exit 2
fi

b64url() {
  # base64url without padding
  openssl base64 -A | tr '+/' '-_' | tr -d '='
}

CODE_VERIFIER="$(openssl rand -base64 48 | tr -d '=\n' | tr '+/' '-_' | head -c 64)"
CODE_CHALLENGE="$(printf '%s' "$CODE_VERIFIER" | openssl dgst -sha256 -binary | b64url)"
STATE="oauth_test_$(openssl rand -hex 16)"
echo "== 2) Open authorization URL in browser =="
echo "== 3) Exchange code for token (PKCE public client) =="
echo "OK: access_token received (prefix): ${ACCESS_TOKEN:0:20}..."

urlencode() {
  local value="$1"
  if command -v python3 >/dev/null 2>&1; then
    python3 - <<PY
import urllib.parse
print(urllib.parse.quote('''$value''', safe=''))
PY
    return
  fi
  # Best-effort fallback (not fully correct for all characters)
  echo "$value" | sed 's/%/%25/g; s/ /%20/g; s/:/%3A/g; s\//%2F/g'
}

if [[ "$MODE" == "start" ]]; then
  echo "== 1) Register a public OAuth client (DCR) =="
  REG_PAYLOAD=$(jq -n --arg name "ChatGPT Connector Redirect Test" --arg ru "$REDIRECT_URI" --arg scope "$SCOPE" '{
    client_name: $name,
    redirect_uris: [$ru],
    grant_types: ["authorization_code","refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: $scope,
    application_type: "web"
  }')

  REG_RESP=$(curl -sS -X POST "$AUTH_BASE/oauth2/register" \
    -H "Content-Type: application/json" \
    -d "$REG_PAYLOAD")

  CLIENT_ID=$(echo "$REG_RESP" | jq -r '.client_id')
  if [[ -z "$CLIENT_ID" || "$CLIENT_ID" == "null" ]]; then
    echo "DCR failed; response:" >&2
    echo "$REG_RESP" | jq . >&2 || echo "$REG_RESP" >&2
    exit 1
  fi

  mkdir -p "$STATE_DIR"
  jq -n \
    --arg auth_base "$AUTH_BASE" \
    --arg redirect_uri "$REDIRECT_URI" \
    --arg scope "$SCOPE" \
    --arg client_id "$CLIENT_ID" \
    --arg code_verifier "$CODE_VERIFIER" \
    --arg code_challenge "$CODE_CHALLENGE" \
    --arg state "$STATE" \
    '{auth_base:$auth_base, redirect_uri:$redirect_uri, scope:$scope, client_id:$client_id, code_verifier:$code_verifier, code_challenge:$code_challenge, state:$state}' \
    > "$STATE_FILE"

  echo "Registered client_id: $CLIENT_ID"
  echo "Saved state: $STATE_FILE"

  echo
  echo "== 2) Open authorization URL in browser =="
  AUTH_URL="$AUTH_BASE/oauth2/authorize?response_type=code"
  AUTH_URL+="&client_id=$(urlencode "$CLIENT_ID")"
  AUTH_URL+="&redirect_uri=$(urlencode "$REDIRECT_URI")"
  AUTH_URL+="&scope=$(urlencode "$SCOPE")"
  AUTH_URL+="&state=$STATE&code_challenge=$CODE_CHALLENGE&code_challenge_method=S256"

  echo "$AUTH_URL"
  echo
  echo "Next: after login/consent, run:"
  echo "  $0 exchange '<PASTE_REDIRECT_URL>'"
  exit 0
fi

if [[ ! -f "$STATE_FILE" ]]; then
  echo "Missing state file: $STATE_FILE" >&2
  echo "Run: $0 start" >&2
  exit 2
fi

if [[ -z "$REDIRECT_INPUT" ]]; then
  echo "Usage: $0 exchange '<PASTE_REDIRECT_URL>'" >&2
  exit 2
fi

AUTH_BASE=$(jq -r '.auth_base' "$STATE_FILE")
REDIRECT_URI=$(jq -r '.redirect_uri' "$STATE_FILE")
SCOPE=$(jq -r '.scope' "$STATE_FILE")
CLIENT_ID=$(jq -r '.client_id' "$STATE_FILE")
CODE_VERIFIER=$(jq -r '.code_verifier' "$STATE_FILE")

CODE=$(printf '%s' "$REDIRECT_INPUT" | sed -n 's/.*[?&]code=\([^&]*\).*/\1/p')
if [[ -z "$CODE" ]]; then
  echo "Could not extract ?code= from the URL you provided." >&2
  exit 1
fi

echo "== Exchange code for token (PKCE public client) =="
TOKEN_RESP=$(curl -sS -X POST "$AUTH_BASE/oauth2/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "grant_type=authorization_code" \
  --data "client_id=$CLIENT_ID" \
  --data "code=$CODE" \
  --data "redirect_uri=$REDIRECT_URI" \
  --data "code_verifier=$CODE_VERIFIER")

echo "$TOKEN_RESP" | jq . || {
  echo "Token response was not JSON:" >&2
  echo "$TOKEN_RESP" >&2
  exit 1
}

ACCESS_TOKEN=$(echo "$TOKEN_RESP" | jq -r '.access_token // empty')
TOKEN_TYPE=$(echo "$TOKEN_RESP" | jq -r '.token_type // empty')

if [[ -z "$ACCESS_TOKEN" ]]; then
  echo
  echo "FAIL: token response did not include access_token." >&2
  echo "This is the same condition that triggers ChatGPT's: 'Access token is missing'." >&2
  exit 2
fi

if [[ "${TOKEN_TYPE,,}" != "bearer" ]]; then
  echo
  echo "WARN: token_type is not Bearer: '$TOKEN_TYPE'" >&2
fi

echo
echo "OK: access_token received (prefix): ${ACCESS_TOKEN:0:20}..."
