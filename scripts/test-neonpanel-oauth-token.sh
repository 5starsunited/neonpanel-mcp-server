#!/usr/bin/env bash

# Test NeonPanel OAuth token endpoint behavior for ChatGPT Connector compatibility.
#
# This script focuses on the part that is currently failing in ChatGPT:
# ChatGPT backend exchanges an authorization code for an access token.
#
# Usage:
#   ./scripts/test-neonpanel-oauth-token.sh
#   CLIENT_ID=... REDIRECT_URI=... CODE=... CODE_VERIFIER=... ./scripts/test-neonpanel-oauth-token.sh
#
# Notes:
# - For a full end-to-end test you must:
#   1) Initiate OAuth in ChatGPT and copy the FULL authorize URL (it contains redirect_uri).
#   2) After login/consent, capture the `code` returned to ChatGPT.
#   3) Provide the same redirect_uri and the PKCE code_verifier that generated the challenge.

set -euo pipefail

TOKEN_EP="https://my.neonpanel.com/oauth2/token"

say() { printf "%s\n" "$*"; }

say "== NeonPanel OAuth token endpoint smoke =="

# 1) Baseline: dummy public-client+PKCE request
say "\n-- Dummy request (should be JSON OAuth error, not HTML/500) --"
headers_file="$(mktemp)"; body_file="$(mktemp)"
curl -sS -D "$headers_file" -o "$body_file" -X POST "$TOKEN_EP" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "grant_type=authorization_code&client_id=dummy_client&code=dummy_code&redirect_uri=https%3A%2F%2Fchatgpt.com%2Faip%2Foauth%2Fcallback&code_verifier=dummy_verifier"
status="$(awk 'NR==1{print $2}' "$headers_file")"
ctype="$(grep -i '^content-type:' "$headers_file" | head -n1 | cut -d' ' -f2- | tr -d '\r')"
say "HTTP: $status"
say "Content-Type: $ctype"
say "Body:"; cat "$body_file"; say ""
rm -f "$headers_file" "$body_file"

# 2) Real exchange if env vars are provided
if [[ -n "${CLIENT_ID:-}" && -n "${REDIRECT_URI:-}" && -n "${CODE:-}" && -n "${CODE_VERIFIER:-}" ]]; then
  say "\n-- Real authorization_code exchange (should return access_token) --"
  headers_file="$(mktemp)"; body_file="$(mktemp)"

  # URL-encode redirect_uri safely using python if available, else fall back.
  if command -v python3 >/dev/null 2>&1; then
    encoded_redirect_uri="$(python3 - <<'PY'
import os, urllib.parse
print(urllib.parse.quote(os.environ['REDIRECT_URI'], safe=''))
PY
)"
  else
    encoded_redirect_uri="$REDIRECT_URI"
  fi

  curl -sS -D "$headers_file" -o "$body_file" -X POST "$TOKEN_EP" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data "grant_type=authorization_code&client_id=${CLIENT_ID}&code=${CODE}&redirect_uri=${encoded_redirect_uri}&code_verifier=${CODE_VERIFIER}"

  status="$(awk 'NR==1{print $2}' "$headers_file")"
  ctype="$(grep -i '^content-type:' "$headers_file" | head -n1 | cut -d' ' -f2- | tr -d '\r')"
  say "HTTP: $status"
  say "Content-Type: $ctype"

  say "Body:"; cat "$body_file"; say ""

  if command -v jq >/dev/null 2>&1; then
    if jq -e '.access_token and (.token_type|ascii_downcase=="bearer")' "$body_file" >/dev/null 2>&1; then
      say "OK: access_token present and token_type is Bearer"
    else
      say "ERROR: response did not include access_token/token_type=Bearer"
      say "Hint: ChatGPT shows 'Access token is missing' when this happens."
    fi
  fi

  rm -f "$headers_file" "$body_file"
else
  say "\n(Info) To run a real exchange, set env vars: CLIENT_ID, REDIRECT_URI, CODE, CODE_VERIFIER."
fi
