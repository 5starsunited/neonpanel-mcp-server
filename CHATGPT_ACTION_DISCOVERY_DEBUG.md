# ChatGPT Action Discovery Debug Checklist

Use this checklist to reproduce ChatGPT’s “failed to get action list” flow and identify where the MCP server diverges from what ChatGPT expects.

## 1) Pre-requisites
- Server is deployed: https://mcp.neonpanel.com
- Optional: a valid NeonPanel OAuth access token in `ACCESS_TOKEN` (only required to test `tools/call`).

## 2) Quick Automation
Run the diagnostics script:

```bash
cd /Users/mikesorochev/GitHub\ Projects/neonpanel-mcp-server

# Public discovery checks
./scripts/mcp_diagnostics.sh

# Also test authenticated tool execution (optional)
ACCESS_TOKEN="<token>" ./scripts/mcp_diagnostics.sh
```

This validates:
- OAuth discovery + protected resource metadata endpoints
- `POST /mcp` streamable HTTP JSON-RPC discovery methods: `initialize`, `initialized`, `tools/list`
- `tools/call` is OAuth-gated: `HTTP 401` plus both `WWW-Authenticate` header and JSON-RPC `error.data._meta['mcp/www_authenticate']`
- Optional SSE replay via `GET /sse` + `POST /messages?sessionId=...` for discovery methods

## 3) Manual Repro (Streamable HTTP)
### Step 1: Verify discovery is public
```bash
BASE_URL="https://mcp.neonpanel.com"

curl -sS -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  "$BASE_URL/mcp" | jq .
```

### Step 2: Verify `tools/call` triggers OAuth
```bash
curl -sS -D /tmp/h.txt -o /tmp/b.json -w "%{http_code}\n" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"neonpanel.listCompanies","arguments":{}}}' \
  "$BASE_URL/mcp"

grep -i '^www-authenticate:' /tmp/h.txt
jq '.error.data._meta["mcp/www_authenticate"]' /tmp/b.json
```

## 4) Manual Repro (Optional SSE)
SSE is optional. It should allow anonymous connections and emit an `endpoint` event that points to `POST /messages?sessionId=...`.

1) Open SSE:
```bash
curl -N -H 'Accept: text/event-stream' "$BASE_URL/sse"
```

2) Copy the `sessionId` from the `event: ready` payload, then send discovery JSON-RPC to `/messages?sessionId=...`.

## 5) Common Pitfalls
- **Wrong endpoint/method**: ChatGPT expects `POST /mcp` JSON-RPC for discovery.
- **Wrong tool result shape**: `tools/call` success must include `result.content` (otherwise clients can error with schema validation failures).
- **Missing OAuth challenge metadata**: return `HTTP 401`, include `WWW-Authenticate`, and mirror it in JSON-RPC error `_meta['mcp/www_authenticate']`.

## 6) Next Steps Checklist
- [ ] `./scripts/mcp_diagnostics.sh` passes for public discovery
- [ ] With `ACCESS_TOKEN`, `tools/call` succeeds and returns `result.content[]`
- [ ] If using SSE, `GET /sse` emits `ready` and `/messages?sessionId=...` produces `rpc.result` events
