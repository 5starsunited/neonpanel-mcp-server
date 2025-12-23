#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${BASE_URL:-${1:-"https://mcp.neonpanel.com"}}
ACCESS_TOKEN=${ACCESS_TOKEN:-}

TMP_DIR=$(mktemp -d)
SSE_LOG="$TMP_DIR/sse.log"
SSE_PAYLOADS="$TMP_DIR/sse_payloads.jsonl"
SSE_PID=""
SESSION_ID=""
PASS=0
FAIL=0

cleanup() {
  stop_sse_listener
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require curl
require jq

print_result() {
  local ok=$1
  local message=$2
  if [[ "$ok" == "true" ]]; then
    printf '\e[32m[PASS]\e[0m %s\n' "$message"
    PASS=$((PASS + 1))
  else
    printf '\e[31m[FAIL]\e[0m %s\n' "$message"
    FAIL=$((FAIL + 1))
  fi
}

auth_header() {
  printf 'Authorization: Bearer %s' "$ACCESS_TOKEN"
}

start_sse_listener() {
  : >"$SSE_LOG"
  if [[ -n "$ACCESS_TOKEN" ]]; then
    curl -sS -N \
      -H 'Accept: text/event-stream' \
      -H "$(auth_header)" \
      "${BASE_URL%/}/sse" >"$SSE_LOG" &
  else
    curl -sS -N \
      -H 'Accept: text/event-stream' \
      "${BASE_URL%/}/sse" >"$SSE_LOG" &
  fi
  SSE_PID=$!
}

ensure_sse_stream_ready() {
  if [[ -z ${SSE_PID:-} ]]; then
    return 1
  fi

  local attempts=40
  while ((attempts-- > 0)); do
    if grep -q 'event: ready' "$SSE_LOG" 2>/dev/null; then
      return 0
    fi
    if grep -q '"event"[[:space:]]*:[[:space:]]*"ready"' "$SSE_LOG" 2>/dev/null; then
      return 0
    fi
    if ! kill -0 "$SSE_PID" 2>/dev/null; then
      return 1
    fi
    sleep 0.25
  done
  return 1
}

capture_session_id() {
  # Prefer the `event: endpoint` URL, which includes the sessionId.
  local sid
  sid=$(awk '
    { gsub(/\r$/, "") }
    /^data: \/messages\?sessionId=/ {
      line=$0
      sub(/^data: \/messages\?sessionId=/, "", line)
      print line
      exit
    }
  ' "$SSE_LOG")

  if [[ -n "$sid" ]]; then
    SESSION_ID="$sid"
    return 0
  fi

  # Fallback: parse JSON ready payload for sessionId.
  local payload
  payload=$(awk '
    { gsub(/\r$/, "") }
    /^data: \{/ {
      line=$0
      sub(/^data: /, "", line)
      print line
    }
  ' "$SSE_LOG" | jq -r 'select(.event=="ready") | .sessionId' 2>/dev/null | head -n1)

  if [[ -n "$payload" && "$payload" != "null" ]]; then
    SESSION_ID="$payload"
  fi
}

stop_sse_listener() {
  if [[ -n ${SSE_PID:-} ]]; then
    if kill -0 "$SSE_PID" 2>/dev/null; then
      kill "$SSE_PID" >/dev/null 2>&1 || true
    fi
    wait "$SSE_PID" 2>/dev/null || true
    SSE_PID=""
  fi
}

collect_sse_payloads() {
  : >"$SSE_PAYLOADS"
  # The server may send JSON-RPC responses as plain `data: {...}` lines.
  awk '
    { gsub(/\r$/, "") }
    /^data: \{/ {
      line=$0
      sub(/^data: /, "", line)
      print line
    }
  ' "$SSE_LOG" | jq -c 'select(.jsonrpc=="2.0" and (.result!=null or .error!=null))' 2>/dev/null \
    >"$SSE_PAYLOADS" || true
}

http_request() {
  local method=$1
  local path=$2
  local data=${3-}
  shift 3 || set --
  local -a extra_headers=()
  if (($# > 0)); then
    extra_headers=("$@")
  fi
  local url="${BASE_URL%/}${path}"

  local headers_file="$TMP_DIR/headers"
  local body_file="$TMP_DIR/body"
  : >"$headers_file"
  : >"$body_file"

  local -a curl_args=(-sS -D "$headers_file" -o "$body_file" -w "%{http_code}" -X "$method" "$url")
  if [[ -n ${data:-} ]]; then
    curl_args+=(-H 'Content-Type: application/json' -d "$data")
  fi
  if ((${#extra_headers[@]} > 0)); then
    curl_args+=("${extra_headers[@]}")
  fi

  local status
  status=$(curl "${curl_args[@]}" || true)
  printf '%s\n' "$status" >"$TMP_DIR/status"
}

check_json_field() {
  local jq_expr=$1
  if jq -e "$jq_expr" "$TMP_DIR/body" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

section() {
  echo
  printf '== %s ==\n' "$1"
}

section "Discovery"
http_request GET '/healthz'
if [[ $(cat "$TMP_DIR/status") == "200" ]]; then
  print_result true "/healthz responds"
else
  print_result false "/healthz failed"
fi

http_request GET '/.well-known/ai-plugin.json'
if [[ $(cat "$TMP_DIR/status") == "200" ]] && check_json_field '.auth.authorization_url and .api.url'; then
  print_result true "AI plugin manifest advertises OAuth endpoints"
else
  print_result false "AI plugin manifest invalid"
fi

http_request GET '/.well-known/oauth-authorization-server'
if [[ $(cat "$TMP_DIR/status") == "200" ]] && check_json_field '.authorization_endpoint and .registration_endpoint'; then
  print_result true "OAuth discovery links to issuer"
else
  print_result false "OAuth discovery incomplete"
fi

http_request GET '/.well-known/oauth-protected-resource'
if [[ $(cat "$TMP_DIR/status") == "200" ]] && check_json_field '.resource and (.authorization_servers | length > 0)'; then
  print_result true "OAuth protected resource metadata published"
else
  print_result false "Missing OAuth protected resource metadata"
fi

http_request GET '/openapi.yaml'
if [[ $(cat "$TMP_DIR/status") == "200" ]] && grep -q '^openapi:' "$TMP_DIR/body"; then
  print_result true "OpenAPI YAML available"
else
  print_result false "OpenAPI YAML missing"
fi

section "Streamable HTTP JSON-RPC (/mcp)"
http_request POST '/mcp' '{"jsonrpc":"2.0","id":"init","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"mcp_diagnostics","version":"0.1"}}}'
if [[ $(cat "$TMP_DIR/status") == "200" ]] && check_json_field '.result.serverInfo.name'; then
  print_result true "initialize (public) works"
else
  print_result false "initialize (public) failed"
fi

http_request POST '/mcp' '{"jsonrpc":"2.0","id":"initialized","method":"initialized","params":{}}'
if [[ $(cat "$TMP_DIR/status") == "200" ]] && check_json_field '.result.ok == true'; then
  print_result true "initialized (public) works"
else
  print_result false "initialized (public) failed"
fi

http_request POST '/mcp' '{"jsonrpc":"2.0","id":"tools","method":"tools/list","params":{}}'
if [[ $(cat "$TMP_DIR/status") == "200" ]] && check_json_field '.result.tools | type=="array"'; then
  print_result true "tools/list (public) works"
else
  print_result false "tools/list (public) failed"
fi

section "Protected Endpoints"
http_request POST '/mcp' '{"jsonrpc":"2.0","id":"call-noauth","method":"tools/call","params":{"name":"neonpanel.listCompanies","arguments":{}}}'
if [[ $(cat "$TMP_DIR/status") == "401" ]] \
  && grep -qi '^www-authenticate:' "$TMP_DIR/headers" \
  && check_json_field '.error.data._meta["mcp/www_authenticate"] | type=="array" and length>0'; then
  print_result true "tools/call is OAuth-gated (401 + WWW-Authenticate + mcp/www_authenticate)"
else
  print_result false "tools/call auth-gate missing/incorrect"
fi

if [[ -n "$ACCESS_TOKEN" ]]; then
  section "Authenticated (optional)"
  http_request POST '/mcp' '{"jsonrpc":"2.0","id":"call-auth","method":"tools/call","params":{"name":"neonpanel.listCompanies","arguments":{}}}' "-H" "$(auth_header)"
  if [[ $(cat "$TMP_DIR/status") == "200" ]] && check_json_field '.result.content | type=="array" and length>0'; then
    print_result true "tools/call works with bearer and returns content[]"
  else
    print_result false "tools/call with bearer failed or missing content[]"
  fi
fi
section "SSE Stream Replay"
start_sse_listener
if ensure_sse_stream_ready; then
  capture_session_id
  print_result true "SSE stream established"
else
  print_result false "SSE stream failed"
fi

if [[ -z "$SESSION_ID" ]]; then
  print_result false "Failed to capture sessionId from SSE stream"
fi

SESSION_QUERY=""
if [[ -n "$SESSION_ID" ]]; then
  SESSION_QUERY="?sessionId=${SESSION_ID}"
fi

if [[ -n "$ACCESS_TOKEN" ]]; then
  http_request POST "/messages${SESSION_QUERY}" '{"jsonrpc":"2.0","id":"sse-init","method":"initialize"}' "-H" "$(auth_header)"
else
  http_request POST "/messages${SESSION_QUERY}" '{"jsonrpc":"2.0","id":"sse-init","method":"initialize"}'
fi
if [[ $(cat "$TMP_DIR/status") == "200" ]]; then
  print_result true "initialize request accepted"
else
  print_result false "initialize request failed"
fi

if [[ -n "$ACCESS_TOKEN" ]]; then
  http_request POST "/messages${SESSION_QUERY}" '{"jsonrpc":"2.0","id":"sse-tools","method":"tools/list"}' "-H" "$(auth_header)"
else
  http_request POST "/messages${SESSION_QUERY}" '{"jsonrpc":"2.0","id":"sse-tools","method":"tools/list"}'
fi
if [[ $(cat "$TMP_DIR/status") == "200" ]]; then
  print_result true "tools/list request accepted"
else
  print_result false "tools/list request failed"
fi

sleep 1
stop_sse_listener
collect_sse_payloads

if [[ -s "$SSE_PAYLOADS" ]] && jq -e -s 'map(select(.id == "sse-init" and .result.serverInfo.name != null)) | length > 0' "$SSE_PAYLOADS" >/dev/null 2>&1; then
  print_result true "SSE emitted initialize result"
else
  print_result false "SSE missing initialize result"
fi

if [[ -s "$SSE_PAYLOADS" ]] && jq -e -s 'map(select(.id == "sse-tools" and (.result.tools // null) != null)) | length > 0' "$SSE_PAYLOADS" >/dev/null 2>&1; then
  print_result true "SSE emitted tools/list result"
else
  print_result false "SSE missing tools/list result"
fi

echo
printf 'Summary: %d passed, %d failed\n' "$PASS" "$FAIL"
if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
