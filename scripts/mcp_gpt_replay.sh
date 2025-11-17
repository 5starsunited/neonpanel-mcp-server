#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${BASE_URL:-${1:-"https://mcp.neonpanel.com"}}
ACCESS_TOKEN=${ACCESS_TOKEN:-}
CLIENT_ID=${CLIENT_ID:-}
CLIENT_CREDS_FILE=${CLIENT_CREDS_FILE:-"chatgpt-client-credentials.json"}
REDIRECT_URI=${REDIRECT_URI:-"http://localhost:8888/callback"}
CALLBACK_PORT=${CALLBACK_PORT:-8888}
TMP_DIR=$(mktemp -d)
SSE_LOG="$TMP_DIR/sse.log"
SSE_PID=""
TAIL_PID=""
SESSION_ID=""
CALLBACK_PID=""

abort() {
  echo "[error] $1" >&2
  exit 1
}

cleanup() {
  if [[ -n ${CALLBACK_PID:-} ]]; then
    kill "$CALLBACK_PID" >/dev/null 2>&1 || true
    wait "$CALLBACK_PID" 2>/dev/null || true
  fi
  if [[ -n ${TAIL_PID:-} ]]; then
    kill "$TAIL_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n ${SSE_PID:-} ]]; then
    kill "$SSE_PID" >/dev/null 2>&1 || true
    wait "$SSE_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    abort "Missing required command: $1"
  fi
}

require curl
require jq
require python3
require openssl

urlencode() {
  python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"
}

launch_browser() {
  local url=$1
  if command -v open >/dev/null 2>&1; then
    open "$url" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 || true
  else
    printf '[warn] Unable to auto-open browser. Please open this URL manually:\n%s\n' "$url"
  fi
}

start_callback_server() {
  local output_file=$1
  python3 - "$output_file" "$CALLBACK_PORT" <<'PY' &
import http.server
import json
import socketserver
import sys
import urllib.parse

output_path = sys.argv[1]
port = int(sys.argv[2])

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        code = params.get('code', [''])[0]
        state = params.get('state', [''])[0]
        body = {
            'code': code,
            'state': state,
            'raw_query': parsed.query,
        }
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(body, f)
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(b"<html><body><h2>Authorization complete</h2><p>You can close this window and return to the terminal.</p></body></html>")

with socketserver.TCPServer(("127.0.0.1", port), Handler) as httpd:
    httpd.handle_request()
PY
  CALLBACK_PID=$!
}

wait_for_callback() {
  local output_file=$1
  for _ in {1..240}; do
    if [[ -s "$output_file" ]]; then
      return 0
    fi
    if [[ -n ${CALLBACK_PID:-} ]] && ! kill -0 "$CALLBACK_PID" 2>/dev/null; then
      break
    fi
    sleep 0.5
  done
  return 1
}

generate_pkce_pair() {
  CODE_VERIFIER=$(openssl rand -base64 48 | tr -d '\n' | tr -d '=' | tr '+/' '-_' | cut -c1-128)
  CODE_CHALLENGE=$(printf '%s' "$CODE_VERIFIER" | openssl dgst -sha256 -binary | openssl base64 -A | tr -d '\n' | tr '+/' '-_' | tr -d '=')
}

discover_oauth_metadata() {
  local metadata
  metadata=$(curl -sS "${BASE_URL%/}/.well-known/oauth-authorization-server" || true)
  if [[ -n "$metadata" ]] && echo "$metadata" | jq -e '.authorization_endpoint and .token_endpoint' >/dev/null 2>&1; then
    AUTHORIZATION_ENDPOINT=$(echo "$metadata" | jq -r '.authorization_endpoint')
    TOKEN_ENDPOINT=$(echo "$metadata" | jq -r '.token_endpoint')
  else
    AUTHORIZATION_ENDPOINT="https://my.neonpanel.com/oauth2/authorize"
    TOKEN_ENDPOINT="https://my.neonpanel.com/oauth2/token"
  fi
}

obtain_access_token() {
  if [[ -n "$ACCESS_TOKEN" ]]; then
    return 0
  fi

  if [[ -z "$CLIENT_ID" ]]; then
    if [[ -f "$CLIENT_CREDS_FILE" ]]; then
      CLIENT_ID=$(jq -r '.client_id // empty' "$CLIENT_CREDS_FILE")
    fi
  fi

  [[ -n "$CLIENT_ID" ]] || abort "CLIENT_ID missing; set CLIENT_ID or provide chatgpt-client-credentials.json"

  discover_oauth_metadata
  generate_pkce_pair
  local state
  state=$(openssl rand -hex 16)
  local callback_file="$TMP_DIR/oauth_callback.json"

  start_callback_server "$callback_file"
  local encoded_redirect
  encoded_redirect=$(urlencode "$REDIRECT_URI")
  local auth_url
  auth_url="${AUTHORIZATION_ENDPOINT}?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encoded_redirect}&scope=dcr.create&state=${state}&code_challenge=${CODE_CHALLENGE}&code_challenge_method=S256"

  printf '[info] ACCESS_TOKEN not set. Launching browser for OAuth login...\n'
  printf '[info] OAuth redirect: %s\n' "$REDIRECT_URI"
  printf '[info] OAuth state: %s\n' "$state"
  printf '[info] If the browser does not open automatically, use this URL:\n%s\n' "$auth_url"
  launch_browser "$auth_url"
  printf '[info] Waiting for redirect at %s ...\n' "$REDIRECT_URI"

  if ! wait_for_callback "$callback_file"; then
    abort "OAuth callback not received before timeout"
  fi

  local returned_state
  local auth_code
  returned_state=$(jq -r '.state // empty' "$callback_file")
  auth_code=$(jq -r '.code // empty' "$callback_file")

  [[ -n "$auth_code" ]] || abort "OAuth server did not return an authorization code"
  if [[ "$returned_state" != "$state" ]]; then
    abort "State mismatch during OAuth flow"
  fi

  printf '[info] Exchanging authorization code for tokens...\n'
  local token_response
  token_response=$(curl -sS -X POST "$TOKEN_ENDPOINT" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    -d "grant_type=authorization_code" \
    -d "client_id=${CLIENT_ID}" \
    -d "code=${auth_code}" \
    -d "redirect_uri=${REDIRECT_URI}" \
    -d "code_verifier=${CODE_VERIFIER}")

  ACCESS_TOKEN=$(echo "$token_response" | jq -r '.access_token // empty')
  REFRESH_TOKEN=$(echo "$token_response" | jq -r '.refresh_token // empty')

  [[ -n "$ACCESS_TOKEN" ]] || {
    echo "$token_response" | jq . >&2
    abort "Failed to obtain access token"
  }

  printf '[info] Obtained access token (%s...)\n' "${ACCESS_TOKEN:0:16}"
  if [[ -n "$REFRESH_TOKEN" ]]; then
    printf '[info] Refresh token also returned; store securely if needed.\n'
  fi
}

obtain_access_token

printf '[info] Opening SSE stream to %s\n' "$BASE_URL"

curl -sS -N \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H 'Accept: text/event-stream' \
  "${BASE_URL%/}/sse" | tee "$SSE_LOG" &
SSE_PID=$!

tail -f "$SSE_LOG" &
TAIL_PID=$!

printf '[info] Waiting for sessionId from ready event...\n'
for _ in {1..40}; do
  if SESSION_ID=$(awk '/^data: / { sub(/^data: /, ""); print }' "$SSE_LOG" \
    | jq -r 'select(.event == "ready") | .sessionId // empty' 2>/dev/null \
    | tail -n 1); then
    if [[ -n "$SESSION_ID" ]]; then
      break
    fi
  fi
  sleep 0.25

done

if [[ -z "$SESSION_ID" ]]; then
  abort "Timed out waiting for sessionId from SSE stream"
fi

printf '[info] Captured sessionId: %s\n' "$SESSION_ID"

send_rpc() {
  local id=$1
  local method=$2
  local payload=$3
  printf '\n[info] Sending %s (%s)\n' "$method" "$id"
  curl -sS -w '\nHTTP %\{http_code\}\n' \
    -X POST \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -d "$payload" \
    "${BASE_URL%/}/messages?sessionId=${SESSION_ID}"
}

send_rpc 'init' 'initialize' '{"jsonrpc":"2.0","id":"init","method":"initialize","params":{}}'
send_rpc 'tools' 'tools/list' '{"jsonrpc":"2.0","id":"tools","method":"tools/list","params":{}}'

printf '\n[info] Watch the SSE output above for JSON-RPC results. Press Ctrl+C to exit.\n'
wait "$SSE_PID"
