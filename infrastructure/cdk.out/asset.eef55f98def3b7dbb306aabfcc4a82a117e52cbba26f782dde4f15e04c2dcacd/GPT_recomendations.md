Here’s a copy-paste “spec-as-prompt” you can give to Codex (or any codegen assistant) to build the **NeonPanel MCP server using Provider OAuth (NeonPanel OAuth)**. It’s concrete, opinionated (Node.js + TypeScript + Express), and includes transport, auth, JSON-RPC, testing, and ops details.

---

# BUILD ME: NeonPanel MCP Server (Provider OAuth / SSE Transport)

## Objective

Implement a production-ready **Model Context Protocol (MCP)** server that ChatGPT connects to via **HTTP + SSE transport**. The server must use **Provider OAuth with NeonPanel OAuth** as the authorization server.

* **Inbound auth (GPT → MCP):** `Authorization: Bearer <NeonPanel OAuth access token>`
* **Outbound auth (MCP → NeonPanel Core APIs):** Prefer **client-credentials / IAT** (Integration Access Token). If scopes allow, re-use the inbound token, but default to IAT.
* Transport: **GET `/sse`** (EventSource stream) and **POST `/messages`** (JSON-RPC request sink).
* Language: **TypeScript**, Node **>=18**, Framework: **Express**.
* Robustness: JWKS verification, audience/scope checks, structured logs, health checks, graceful shutdown.

## Deliverables

1. A working server with:

   * `GET /healthz` (public) — returns 200 with `{status:"ok"}`
   * `GET /sse` (protected) — SSE stream; requires valid NeonPanel OAuth access token
   * `POST /messages` (protected) — accepts JSON-RPC 2.0; requires valid NeonPanel OAuth access token
2. **MCP JSON-RPC methods** implemented:

   * `initialize`
   * `tools/list`
   * `tools/call` (add 1–2 example tools that call NeonPanel API, e.g., `neonpanel.getAccount`, `neonpanel.searchOrders`)
3. **Token validation** against **NeonPanel OAuth** (issuer/audience/scope/exp) using **JWKS** with caching & rotation.
4. **Outbound NeonPanel API client** using IAT (client-credentials) with automatic refresh.
5. **Config & security** via environment variables (.env.example).
6. **Nginx reverse-proxy snippet** and **cURL test scripts**.
7. **README** with run, test, and deploy steps.
8. Minimal test coverage (unit for auth & JSON-RPC, integration happy-path).

## Project Structure (suggested)

```
/src
  /config
    env.ts
  /auth
    validateNeonpanelToken.ts     // inbound token validator (JWKS)
    iatClient.ts                   // client-credentials/IAT retriever & cache
  /transport
    sse.ts                         // SSE controller
    messages.ts                    // POST /messages controller
    jsonrpc.ts                     // JSON-RPC router, types, errors
  /mcp
    methods.ts                     // initialize, tools/list, tools/call
    schema.ts                      // TypeScript types for MCP payloads
  /clients
    neonpanelApi.ts                // Axios/Fetch wrapper w/ auth injection
  /middleware
    authMiddleware.ts              // Express middleware enforcing Bearer + scopes
    errorMiddleware.ts
    requestId.ts
    rateLimit.ts
  /utils
    logger.ts
    http.ts
  server.ts
/tests
  unit/*
  integration/*
.env.example
README.md
```

## Environment Variables (.env.example)

```
NODE_ENV=development
PORT=3000

# Inbound Provider OAuth validation (NeonPanel OAuth)
NEONPANEL_OAUTH_ISSUER=https://my.neonpanel.com/oauth
NEONPANEL_OAUTH_JWKS_URI=https://my.neonpanel.com/oauth/.well-known/jwks.json
NEONPANEL_OAUTH_EXPECTED_AUDIENCE=mcp://neonpanel
NEONPANEL_OAUTH_REQUIRED_SCOPES=mcp.read mcp.tools

# Outbound NeonPanel API (client-credentials/IAT)
NEONPANEL_API_BASE=https://api.neonpanel.com
NEONPANEL_OAUTH_TOKEN_URL=https://my.neonpanel.com/oauth/token
NEONPANEL_CLIENT_ID=xxxxxxxx
NEONPANEL_CLIENT_SECRET=xxxxxxxx
NEONPANEL_IAT_SCOPE=neonpanel.api
NEONPANEL_IAT_AUDIENCE=https://api.neonpanel.com

# SSE
SSE_HEARTBEAT_MS=15000

# Logging
LOG_LEVEL=info
```

## Dependencies

* Server: `express`, `cors`, `helmet`, `compression`
* Auth/JWT: `jose` (JWKS/JWT verify), `lru-cache`
* HTTP: `undici` or `axios`
* Misc: `pino` (logging), `pino-http`, `uuid`, `zod` (schema validation), `express-rate-limit`
* Dev: `typescript`, `ts-node`, `tsx`, `jest`/`vitest`, `supertest`, `eslint`, `@types/*`

## Inbound Auth: Validate NeonPanel OAuth Access Tokens

* Expect HTTP header: `Authorization: Bearer <token>`
* Steps:

  1. Extract Bearer token; reject if missing or malformed (`401`, include `WWW-Authenticate: Bearer realm="mcp", error="invalid_token"`).
  2. Verify JWT using JWKS from `NEONPANEL_OAUTH_JWKS_URI` (cache keys; support rotation).
  3. Validate claims:

     * `iss` === `NEONPANEL_OAUTH_ISSUER`
     * `aud` includes `NEONPANEL_OAUTH_EXPECTED_AUDIENCE`
     * `exp` in future; `nbf`/`iat` sanity checks
     * `scope` includes **all** in `NEONPANEL_OAUTH_REQUIRED_SCOPES` (space-delimited)
     * (Optional) `client_id` / `azp` if enforced
  4. Attach `req.auth = { sub, scopes, token, claims }` for downstream.
* On failure: return JSON:

  ```json
  {
    "error": "invalid_token",
    "error_description": "Token verification failed: <reason>"
  }
  ```
* Make middleware reusable for both `/sse` and `/messages`.

## Outbound Auth: IAT / Client-Credentials

* Implement `iatClient.ts`:

  * Fetch with POST `grant_type=client_credentials`, `client_id`, `client_secret`, `scope=NEONPANEL_IAT_SCOPE`, `audience=NEONPANEL_IAT_AUDIENCE`.
  * Cache token in memory with `expires_in` minus a safety delta (e.g., refresh when <60s left).
  * Expose `getAccessToken(): Promise<string>`.
* `neonpanelApi.ts` should:

  * Default to IAT; optionally allow passing the user token when a tool explicitly needs user-scoped data.
  * Inject `Authorization: Bearer <token>` on each request.
  * Provide helpers: `getAccount(accountId)`, `searchOrders(query)`, etc., with robust error wrapping.

## Transport Endpoints

### `GET /sse`

* Require auth middleware.
* Set headers:

  ```
  Content-Type: text/event-stream
  Cache-Control: no-cache
  Connection: keep-alive
  ```
* Send an initial comment or “hello” event and periodic **heartbeat** every `SSE_HEARTBEAT_MS` (e.g., `:\n\n` or `event: ping`).
* Keep a per-connection context (requestId, auth subject).
* Gracefully close on client disconnect, server shutdown, or idle timeout.

### `POST /messages`

* Require auth middleware.
* Accept `Content-Type: application/json`.
* Parse **JSON-RPC 2.0** (`id`, `jsonrpc: "2.0"`, `method`, `params`).
* Dispatch to MCP methods (see below). Return **single** JSON-RPC response per request.
* Errors follow JSON-RPC error shape:

  ```json
  { "jsonrpc": "2.0", "id": "<id>", "error": { "code": <int>, "message": "<msg>", "data": { ... } } }
  ```

  Use meaningful codes: `-32600` invalid request, `-32601` method not found, `-32602` invalid params, `-32603` internal error, app-specific for auth (`-32001`).

## MCP JSON-RPC Methods

Implement these with strict input/output validation (Zod).

1. **`initialize`**

   * **Params**:

     ```ts
     {
       clientInfo: { name: string; version: string };
       protocolVersion: string; // e.g., "2025-01-01"
       capabilities?: Record<string, unknown>;
     }
     ```
   * **Result**:

     ```ts
     {
       serverInfo: { name: "neonpanel-mcp"; version: string };
       protocolVersion: "2025-01-01";
       capabilities: { tools: true };
     }
     ```
   * Log `sub`, `scopes`, client info.

2. **`tools/list`**

   * Return available tools with schema.
   * Example tools:

     * `neonpanel.getAccount` — params `{ accountId: string }` → NeonPanel API call (IAT).
     * `neonpanel.searchOrders` — params `{ q?: string; from?: string; to?: string; limit?: number }`.
   * Include parameter JSON Schema and example.

3. **`tools/call`**

   * Params:

     ```ts
     {
       name: string;        // tool name
       arguments?: object;  // validated per tool schema
       useUserToken?: boolean; // optional: if true, call NeonPanel API with inbound user token instead of IAT
     }
     ```
   * Execute tool logic, call NeonPanel API via `neonpanelApi`.
   * Return `{ contentType: "application/json", content: any }` (or a plain object).

> Implementation note: keep tool registry in `mcp/methods.ts`, mapping names → zod schemas + handlers.

## Error Handling

* Unified error middleware converting thrown errors to JSON with correlation id.
* JSON-RPC errors: include minimal diagnostic `data` (no secrets).
* Return `WWW-Authenticate` on 401.
* Rate limit `/messages` (e.g., 60 req/min per IP) and back-pressure SSE if needed.

## Observability

* `pino` structured logs: requestId, method, path, status, latency, sub (from token), tool name.
* `/healthz` performs:

  * a no-network quick check by default
  * optional JWKS reachability & IAT token test when `?deep=1`
* Metrics hooks (optional): counters for tool calls, auth failures.

## Graceful Shutdown

* Handle SIGTERM/SIGINT: stop accepting new connections, close SSE streams, wait for in-flight requests, exit.

## Nginx Reverse Proxy (example)

```nginx
server {
  listen 443 ssl http2;
  server_name mcp.neonpanel.com;

  # ssl_certificate ...; ssl_certificate_key ...;

  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header Authorization $http_authorization;

  location /sse {
    proxy_pass http://127.0.0.1:3000/sse;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    chunked_transfer_encoding off;
    proxy_read_timeout 3600s;
  }

  location /messages {
    proxy_pass http://127.0.0.1:3000/messages;
    proxy_http_version 1.1;
  }

  location /healthz {
    proxy_pass http://127.0.0.1:3000/healthz;
  }
}
```

## Example Code Sketches

### `auth/validateNeonpanelToken.ts`

* Use `jose` to fetch JWKS and verify.
* Cache JWKS and accepted kid for performance.
* Enforce `iss`, `aud`, `scope`.

### `middleware/authMiddleware.ts`

* Extract Bearer.
* Call `validateNeonpanelToken`.
* On success, `req.auth = { sub, scopeSet, claims, bearer }`.
* On failure, `401` JSON and `WWW-Authenticate`.

### `transport/sse.ts`

* After auth, set SSE headers.
* Send initial event: `event: ready\ndata: {"ok":true}\n\n`.
* Heartbeat every `SSE_HEARTBEAT_MS` with `:\n\n` or `event: ping`.
* Close on `req.on("close")`.

### `transport/messages.ts` + `jsonrpc.ts`

* Parse and validate JSON.
* Dispatch to `initialize`, `tools/list`, `tools/call`.
* Use zod for params.

### `clients/neonpanelApi.ts`

* `getToken()` from `iatClient` unless `useUserToken` true.
* Wrap requests & normalize errors.

## Example Tools

* `neonpanel.getAccount({ accountId })` → `GET /accounts/{id}`
* `neonpanel.searchOrders({ q, from, to, limit })` → `GET /orders?query=...`

Include schemas and examples in `tools/list` response.

## Tests

### Unit

* Token validator: valid token, exp token, wrong audience, missing scope.
* IAT client: token fetch + cache refresh.
* JSON-RPC router: invalid method, invalid params.

### Integration (Supertest)

* `/healthz` returns 200.
* `/messages` with missing auth → 401.
* `/messages` with mocked valid JWT → `initialize` returns server info.
* Tool call hits mocked NeonPanel API and returns data.

## cURL Smoke Tests

Create `scripts/mcp_check.sh` (like this):

```bash
#!/usr/bin/env bash
set -euo pipefail
BASE="${1:-https://mcp.neonpanel.com}"
TOKEN="${MCP_TOKEN:?set MCP_TOKEN}"

echo "== SSE =="
curl -i --no-buffer \
  -H "Accept: text/event-stream" \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE/sse" --max-time 6 || true

echo
echo "== initialize =="
curl -i -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  --data '{"jsonrpc":"2.0","id":"1","method":"initialize","params":{"clientInfo":{"name":"curl","version":"0.0.1"},"protocolVersion":"2025-01-01"}}' \
  "$BASE/messages"
```

## README (include)

* How to run locally:

  * `pnpm i && pnpm dev`
* How to configure env
* How to run tests: `pnpm test`
* How to run cURL smoke tests
* How to deploy (Dockerfile + container ports)
* Security notes (rotate secrets, enforce scopes, log redaction)

## Acceptance Criteria

* `GET /healthz` returns 200 JSON.
* `GET /sse` requires valid NeonPanel OAuth token and streams with `text/event-stream`.
* `POST /messages` accepts valid JSON-RPC, returns result for `initialize`, `tools/list`, `tools/call`.
* Inbound token is **validated** (issuer, audience, exp, scopes). Rejected tokens produce 401 with JSON error and `WWW-Authenticate`.
* Outbound NeonPanel API calls succeed using IAT (and refresh automatically).
* Codebase is typed, lint-clean, and has unit + minimal integration tests.

---

If you want this generated in another stack (FastAPI/Python, Go, Java/Ktor), say the word and I’ll adapt this prompt 1:1 to that ecosystem.
Totally. The design works great on AWS—here’s the AWS-friendly way to run it and the few gotchas for **SSE** + **OAuth**.

# Recommended AWS architecture (SSE-friendly)

* **Route 53** → **ACM** cert → **ALB (Application Load Balancer, HTTPS)** → **ECS/Fargate** service (your Node/TS MCP app in Docker).
* **Secrets Manager** for `NEONPANEL_CLIENT_SECRET` (and any other secrets).
* **CloudWatch Logs** (app + ALB access logs), optional **X-Ray**.
* (Optional) **AWS WAF** on the ALB.

Why ALB? Because **API Gateway** has short integration idle timeouts and will break long-lived **SSE** streams. ALB passes SSE through cleanly.

# Key AWS settings (the parts people miss)

1. **ALB idle timeout**: raise from default (60s) to **> 1,200s** (e.g., 3,600s) for long-lived SSE connections.
2. **Target group health check**: path `/healthz`, interval 30s, healthy threshold 2–3.
3. **Security Groups**:

   * ALB SG: inbound 443 from the internet.
   * Service SG: inbound from ALB SG only.
4. **ECS/Fargate task sizing**: pick CPU/mem so one task can hold many open connections (SSEs). Start with 0.5 vCPU/1GB; scale with load.
5. **Scaling**:

   * Target tracking on **ALB Target Group > ActiveConnectionCount** (or request count per target) + CPU as a secondary signal.
   * Min 2 tasks (zonal redundancy).
6. **Stickiness (optional)**:

   * If your server is **stateless** for SSE (recommended), you **don’t need** stickiness.
   * If you keep per-connection state in memory **and** need POSTs to hit the same task, enable **ALB cookie stickiness** or externalize state in **ElastiCache Redis** keyed by a connection/session id.
7. **TLS**: terminate at ALB with **ACM**; ALB forwards HTTP/1.1 to ECS. SSE requires HTTP/1.1 keep-alive.
8. **Headers**: you don’t need Nginx; ALB forwards `Authorization` automatically. Your app must read `Authorization: Bearer …`.
9. **VPC**: put tasks in **private subnets** with NAT for outbound (to NeonPanel OAuth JWKS/token and NeonPanel API).

# App/container config on AWS

* **Env vars** via ECS task definition; inject secrets from **Secrets Manager**:

  * `NEONPANEL_CLIENT_SECRET` (secret), `NEONPANEL_CLIENT_ID` (env), token URL, JWKS URL, expected issuer/audience, etc.
* **Logging**: use `awslogs` driver; add requestId to every log line.
* **Graceful shutdown**: handle SIGTERM so ECS can drain SSE connections cleanly.
* **JWKS caching**: in-process LRU (and honor `kid` rotation).
* **IAT client-credentials**: cache token and refresh before expiry.

# Don’t use these for SSE (unless you know the tradeoffs)

* **API Gateway REST/HTTP**: integration timeouts (≈30s) or idle timeouts will cut off SSE.
* **CloudFront** in front of SSE**:** can work, but it may buffer and has its own idle timeouts—skip it initially and go direct ALB → ECS.

# Minimal Terraform-ish checklist (high level)

* ACM cert for `mcp.neonpanel.com` in the ALB’s region.
* ALB: HTTPS listener 443, target group (HTTP:3000), idle timeout 3600s.
* ECS cluster + Fargate service (desired=2, min healthy percent 100, circuit breaker on).
* Task definition:

  * container port 3000
  * env & secrets (from Secrets Manager/SSM)
  * CloudWatch Logs config
* Route 53 A/AAAA alias → ALB.
* (Optional) WAF ACL associated with ALB.

# App code notes (unchanged from your earlier plan)

* Endpoints:

  * `GET /healthz` (public)
  * `GET /sse` (requires **NeonPanel OAuth** Bearer) → set `Content-Type: text/event-stream`, send heartbeats
  * `POST /messages` (requires **NeonPanel OAuth** Bearer) → JSON-RPC 2.0
* Inbound auth: verify **NeonPanel OAuth** token (JWKS, `iss`, `aud`, `exp`, **scopes**).
* Outbound auth: use **client-credentials/IAT** for NeonPanel API.
* Logging/metrics: emit connection counts, tool calls, auth failures.

# Quick AWS-style smoke test (from your laptop)

```bash
# SSE should stay open and show text/event-stream
curl -i --no-buffer \
  -H "Accept: text/event-stream" \
  -H "Authorization: Bearer $NEONPANEL_USER_TOKEN" \
  https://mcp.neonpanel.com/sse

# JSON-RPC initialize
curl -i -H "Content-Type: application/json" \
  -H "Authorization: Bearer $NEONPANEL_USER_TOKEN" \
  --data '{"jsonrpc":"2.0","id":"1","method":"initialize","params":{"clientInfo":{"name":"curl","version":"0.0.1"},"protocolVersion":"2025-01-01"}}' \
  https://mcp.neonpanel.com/messages
```

# Extra AWS niceties (optional)

* **WAF** managed rules (rate-limit bursts, block obvious bad bots).
* **ALB access logs** to S3; Athena table for quick queries.
* **Synthetics canary** (CloudWatch Synthetics) to probe `/healthz` and a short `/messages` call.
* **ECS Exec** enabled for live debug (careful with prod).
* **Parameter Store** for non-secret config; IAM task role grants read to just the needed params/secrets.

---

**Bottom line:** Yes—this design is AWS-ready. Use **ALB → ECS/Fargate** for the long-lived SSE connections, bump ALB idle timeout, store secrets in **Secrets Manager**, and scale on **ActiveConnectionCount**. If you want, I can draft a minimal Terraform or CDK stack tailored to your current VPC.
