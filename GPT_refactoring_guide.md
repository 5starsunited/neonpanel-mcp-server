Absolutely—here’s a copy-paste “spec-as-prompt” for Codex to implement a **single MCP server** that works for **GPT Connect (Provider OAuth)** and **Bedrock MCP Action Groups**, using your **Open DCR** and your **NeonPanel user JWT** (permission-encoded) for downstream access control.

---

# BUILD ME: NeonPanel MCP Server (Provider OAuth; GPT Connect + Bedrock MCP Action Groups)

## Objective

Implement a production-grade **MCP server** in **TypeScript/Node 18+ (Express)** that both:

1. Serves **ChatGPT (GPT Connect)** via **Provider OAuth (NeonPanel OAuth)**, and
2. Serves **AWS Bedrock Agents (MCP Action Groups)** using **the same MCP surface**.

**Key auth principle:**

* Inbound: accept **`Authorization: Bearer <NeonPanel OAuth access token>`** (from GPT Connect or Bedrock).
* Exchange/derive a **NeonPanel “user JWT”** from the access token (or accept it if already provided), and use that **user JWT** for **data-permission enforcement** on NeonPanel API calls.
* For service-level calls that should bypass user scope, use **client-credentials (IAT)** from Open DCR.

Transport: **SSE** for GPT Connect today; **Streamable HTTP** optional. Bedrock MCP can call the same endpoints.

## Deliverables

1. **Endpoints**

   * `GET /healthz` (public)
   * `GET /sse` (protected; SSE event stream)  ← GPT Connect & Bedrock MCP both supported
   * `POST /messages` (protected; JSON-RPC sink)
   * (Optional) `POST /mcp` (protected; Streamable HTTP variant, behind a flag)

2. **Auth & tokens**

   * Validate inbound **NeonPanel OAuth access token** (`iss`, `aud`, `exp`, `scope`) via **JWKS**.
   * **Token exchange**: turn the OAuth access token into a **NeonPanel user JWT** (permission-encoded) using your API’s session/introspect endpoint (see “Token Flows” below).
   * **IAT client**: obtain and cache a **client-credentials token** via Open DCR for backend/service-scope calls.
   * Pluggable policy: tools may require **user JWT** (fine-grained) or **IAT** (service) or **hybrid**.

3. **MCP JSON-RPC methods**

   * `initialize`
   * `tools/list` (include JSON Schemas + examples)
   * `tools/call` (execute tools; normalize outputs)

4. **NeonPanel tools (initial set; permission-aware)**

   * `neonpanel.getAccount({ accountId })` — requires **user JWT**
   * `neonpanel.searchOrders({ q?, from?, to?, limit? = 25, cursor? })` — **user JWT**, cursor pagination normalized
   * `neonpanel.getLandedCost({ inventoryId, batchId? })` — **user JWT**
   * `neonpanel.planPurchase({ sku, coverageDays, safetyStock })` — **IAT** or **user JWT + elevated scope** (configurable)

5. **Bedrock compatibility**

   * Same MCP contract; enforce **Bearer NeonPanel OAuth** inbound.
   * No AWS SigV4 required (unless you later choose to add a secondary auth mode). Keep code structured so SigV4 can be added as an alternate authenticator.

6. **Operational features**

   * SSE heartbeat (15s) + graceful shutdown
   * Structured logs (pino), correlation id, redacted headers
   * Rate limit `/messages`; sensible timeouts/retries to NeonPanel API
   * `/healthz?deep=1` optional deep checks (JWKS reachability + DCR token fetch)
   * Dockerfile + ECS/Fargate-ready config

---

## Environment (.env.example)

```
NODE_ENV=development
PORT=3000

# NeonPanel OAuth (Provider OAuth)
NEONPANEL_OAUTH_ISSUER=https://my.neonpanel.com/oauth
NEONPANEL_OAUTH_JWKS_URI=https://my.neonpanel.com/oauth/.well-known/jwks.json
NEONPANEL_OAUTH_EXPECTED_AUDIENCE=mcp://neonpanel
NEONPANEL_OAUTH_REQUIRED_SCOPES=mcp.read mcp.tools

# Token exchange (access token -> user JWT)
NEONPANEL_TOKEN_INTROSPECT_URL=https://api.neonpanel.com/auth/introspect
# or, if you issue user JWT via a session endpoint:
NEONPANEL_USER_JWT_URL=https://api.neonpanel.com/auth/user-jwt

# NeonPanel API base
NEONPANEL_API_BASE=https://api.neonpanel.com

# Open DCR / Client-credentials (IAT)
NEONPANEL_OAUTH_TOKEN_URL=https://my.neonpanel.com/oauth/token
NEONPANEL_CLIENT_ID=xxxx
NEONPANEL_CLIENT_SECRET=xxxx
NEONPANEL_IAT_SCOPE=neonpanel.api
NEONPANEL_IAT_AUDIENCE=https://api.neonpanel.com

# SSE
SSE_HEARTBEAT_MS=15000

# Logging
LOG_LEVEL=info
```

> If you provide **both** introspect and user-JWT endpoints, prefer the **user-JWT endpoint** (permission-encoded) and fall back to introspection.

---

## Token Flows (make these exact)

### Inbound (GPT/Bedrock → MCP)

* Expect `Authorization: Bearer <NeonPanel OAuth access token>`
* Validate JWT via JWKS:

  * `iss` = `NEONPANEL_OAUTH_ISSUER`
  * `aud` includes `NEONPANEL_OAUTH_EXPECTED_AUDIENCE`
  * `exp`/`nbf`/`iat` valid
  * `scope` ⊇ `NEONPANEL_OAUTH_REQUIRED_SCOPES`
* Store as `req.auth.inboundAccessToken`.

### Access-token → User-JWT (permission-encoded)

* If your API exposes **`/auth/user-jwt`**: POST the inbound access token (e.g., in body or Authorization) to mint a **user JWT** that encodes data-access permissions.

  * Cache short-lived user JWTs keyed by access-token `sub` + `scope` + `tenant`.
* Else, call **`/auth/introspect`** to retrieve claims + a `user_jwt` or permission set; if only permissions returned, construct a **signed “internal user JWT”** if that’s your convention, or pass the permission object downstream.

### Outbound (MCP → NeonPanel API)

* For **permissioned user data**: send `Authorization: Bearer <user_jwt>` (preferred).
* For **service-level** or background operations: use **IAT** (client-credentials) from DCR; send `Authorization: Bearer <iat_token>`.
* Allow per-tool override via policy: `authMode: 'user' | 'iat' | 'hybrid'`.

---

## Project structure

```
/src
  /config/env.ts
  /auth
    validateAccessToken.ts       // JWKS validate NeonPanel OAuth access token
    exchangeUserJwt.ts           // access token -> user JWT (or permissions)
    iatClient.ts                 // client-credentials (IAT) retriever + cache
  /middleware
    requestId.ts
    authBearer.ts                // uses validateAccessToken + exchangeUserJwt
    rateLimit.ts
    error.ts
  /transport
    sse.ts                       // GET /sse (heartbeats)
    messages.ts                  // POST /messages
    jsonrpc.ts                   // router + error helpers
  /mcp
    schema.ts                    // zod types for initialize/tools/call
    methods.ts                   // initialize, tools/list, tools/call
    tools/
      getAccount.ts
      searchOrders.ts
      getLandedCost.ts
      planPurchase.ts
      index.ts                   // registry: name -> {schema, handler, authMode}
  /clients
    neonpanelApi.ts              // injects user JWT or IAT; normalizes errors
  /utils/logger.ts
  server.ts
/tests
  unit/*
  integration/*
```

---

## Dependencies

* `express`, `helmet`, `compression`, `cors` (CORS off by default)
* `jose` (JWKS/JWT), `lru-cache`
* `undici` or `axios`
* `zod` (schema), `pino`, `pino-http`, `uuid`
* `express-rate-limit`
* Dev: `typescript`, `tsx`, `jest`/`vitest`, `supertest`, `eslint`

---

## Implementations (sketches Codex should generate)

### `/middleware/authBearer.ts`

* Extract Bearer; if missing → 401 + `WWW-Authenticate`.
* `validateAccessToken(token)` → verifies via JWKS + claims.
* `exchangeUserJwt(token)`:

  * Try `POST NEONPANEL_USER_JWT_URL` (preferred).

    * On 200, set `req.auth.userJwt = <jwt>`
  * Else try `POST NEONPANEL_TOKEN_INTROSPECT_URL`:

    * If response has `user_jwt`, set it.
    * Else set `req.auth.permissions = { ... }`
* Attach `req.auth = { sub, scopes, inboundAccessToken, userJwt?, permissions? }`
* Proceed.

### `/auth/validateAccessToken.ts`

* Use `jose.createRemoteJWKSet(NEONPANEL_OAUTH_JWKS_URI)`
* Verify JWT; enforce `iss`, `aud`, `exp`, `scope`.

### `/auth/exchangeUserJwt.ts`

* POST inbound token to user-jwt/introspect endpoint with secure transport.
* Cache the result with TTL from `exp` (minus 60s).

### `/auth/iatClient.ts`

* Client-credentials POST to `NEONPANEL_OAUTH_TOKEN_URL`

  * `grant_type=client_credentials`
  * `client_id`, `client_secret`
  * `audience=NEONPANEL_IAT_AUDIENCE`
  * `scope=NEONPANEL_IAT_SCOPE`
* Cache with early refresh.

### `/clients/neonpanelApi.ts`

* `call(path, {method, query, body, authMode, userJwt?, useIat?})`
* If `authMode === 'user'`: require `userJwt` (or throw).
* If `authMode === 'iat'`: grab IAT from `iatClient`.
* If `authMode === 'hybrid'`: prefer `userJwt`, fall back to IAT (configurable).
* Normalize errors to `{ status, code, message, details? }`.

### `/mcp/methods.ts`

* `initialize(params)` → returns:

  ```ts
  {
    serverInfo: { name: "neonpanel-mcp", version },
    protocolVersion: "2025-01-01",
    capabilities: { tools: true }
  }
  ```
* `tools/list()` → return array of:

  ```ts
  {
    name: "neonpanel.searchOrders",
    description: "Search orders with filters",
    inputSchema: { type: "object", properties: {...}, required: [...] },
    outputSchema: { ... },
    auth: "user" // or "iat"
  }
  ```
* `tools/call({ name, arguments })`

  * Lookup registry entry.
  * Validate `arguments` with zod.
  * Resolve auth mode → acquire token(s).
  * Call `neonpanelApi`.
  * Return normalized result.

### Example tool: `searchOrders.ts`

* Input:

  ```ts
  {
    q?: string;
    from?: string; // ISO date
    to?: string;   // ISO date
    limit?: number; // default 25
    cursor?: string;
  }
  ```
* Outbound:

  * `GET /orders?query=q&from=...&to=...&limit=...&cursor=...`
  * `Authorization: Bearer <user_jwt>`
* Output (normalized):

  ```ts
  {
    items: Array<{
      orderId: string;
      createdAt: string; // ISO
      currency: string;
      total: number;
      status: string;
      customer?: { id: string; email?: string };
    }>;
    nextCursor?: string;
  }
  ```

---

## Bedrock MCP Action Groups notes

* Bedrock will invoke the **same MCP methods** (`initialize`, `tools/list`, `tools/call`) over your chosen transport.
* Use **the same Provider OAuth**: Bedrock’s side should obtain a NeonPanel OAuth access token (per your configuration) and present it as `Authorization: Bearer ...`.
* No AWS-specific headers required for this mode. Keep the auth middleware modular so, later, you can add an **alternate authenticator** (e.g., SigV4 that exchanges to a NeonPanel user JWT via a trusted backchannel) without changing tools.

---

## Tests

### Unit

* `validateAccessToken` happy + iss/aud/scope failures.
* `exchangeUserJwt` success, cache, and fallbacks.
* Tool schemas: invalid args → JSON-RPC `-32602`.

### Integration (Supertest)

* `/healthz` 200
* `/messages` 401 without auth
* `/messages initialize` with mocked valid token → success
* Tool call hits mocked NeonPanel API and returns normalized result.

---

## Nginx/ALB guidance (SSE)

* Use **ALB** (not API Gateway) for SSE; idle timeout ≥ **1200s**.
* Forward `Authorization` unchanged.
* ECS/Fargate: 2+ tasks, scale on **ActiveConnectionCount** and CPU.
* Heartbeat every 15s; graceful shutdown (SIGTERM).

---

## Acceptance Criteria

* **Both GPT Connect and Bedrock** can connect to `/sse` and call `/messages` with **NeonPanel OAuth access tokens**.
* Server validates inbound tokens (JWKS) and **exchanges to user JWT** (or permissions) before tool execution.
* Tools that need per-user permissions use **user JWT**; service tools use **IAT** from DCR.
* Clear error mapping; JSON-RPC compliance; schemas in `tools/list`.
* Observability: redacted logs, correlation id, health checks.

---

## Developer UX

Provide:

* `scripts/mcp_check.sh` for curl SSE + initialize (requires `$ACCESS_TOKEN`).
* README with:

  * How to configure Provider OAuth in GPT Connect & Bedrock
  * How to mint a test access token (Auth Code + PKCE or Device Code)
  * How token exchange works (sequence diagram)
  * How to choose `authMode` per tool.

---

If you want Codex to generate *starter code*, keep the above and **add**: “Use `jose` for JWKS; `undici` for HTTP; `zod` for schemas; create all files per the structure; include minimal working tools (`getAccount`, `searchOrders`) and full tests.”
