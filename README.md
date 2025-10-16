# NeonPanel MCP HTTP Server

MCP-compatible HTTP server that exposes a single `/exec` endpoint and proxies to NeonPanel's OpenAPI (https://my.neonpanel.com/api/v1/scheme) using the incoming `Authorization: Bearer` token.

- Health: `GET /health`
- Exec: `POST /exec` with body: `{ "action": "neonpanel.inventoryManager.getItems", "args": { ... } }`

Supported actions (initial)
- `neonpanel.inventoryManager.getItems`
- `neonpanel.inventoryManager.getItemCogs`
- `neonpanel.inventoryManager.getItemLandedCost`
- `neonpanel.finance.revenueAndCogs`

These match the policy definitions in `docs/capabilities/neonpanel.yaml` (in the main repo).

## Run locally

```
cd providers/neonpanel-mcp
npm install
npm run dev  # or: npm run build && npm start
```

Example:

```
curl -s http://localhost:3030/health

# Requires a valid NeonPanel access token
curl -s -X POST http://localhost:3030/exec \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "neonpanel.inventoryManager.getItems",
    "args": { "companyUuid": "<uuid>", "per_page": 10 }
  }'
```

## OAuth & Discovery

The server now exposes the discovery surface expected by the Model Context Protocol and ChatGPT’s custom connector flow:

- `GET /.well-known/oauth-protected-resource` – Protected Resource Metadata (RFC 9728)
- `GET /.well-known/oauth-authorization-server` – OAuth 2.0 Authorization Server Metadata (RFC 8414)
- `GET /.well-known/openid-configuration` – OpenID Provider Configuration document

All protected endpoints respond with `WWW-Authenticate: Bearer realm="mcp", resource_metadata="<base>/.well-known/oauth-protected-resource"` when a request arrives without a bearer token.

Environment variables:

- `NEONPANEL_BASE_URL` – Override the upstream NeonPanel API host (defaults to `https://my.neonpanel.com`).
- `MCP_OAUTH_ISSUER` – Explicit issuer/authorization-server base URL to advertise in discovery (defaults to `https://my.neonpanel.com`).
- `MCP_OAUTH_JWKS_URI` – Optional JWKS URI override (defaults to `<issuer>/.well-known/jwks.json`).

Run `npm run smoke:discovery` (optionally pass `BASE_URL=https://mcp.neonpanel.com`) to verify discovery documents and the `/exec` challenge headers after deployment.

## Configure for the bridge

In NeonaSphera, create an MCP connection pointing to this server's base URL. The bridge (`mcpExec` Lambda) will call `POST <url>/exec` with a short-lived provider token in the Authorization header.

- Set `NEONPANEL_BASE_URL` if you need a different NeonPanel API host (defaults to `https://my.neonpanel.com`).

## Notes

- This server performs minimal validation with zod and forwards errors from NeonPanel when possible.
- Add more actions by extending the switch statement in `src/server.ts` and aligning with the capabilities YAML.
- Optional Keepa support can be added later by routing `keepa.*` actions separately or via a dedicated Keepa MCP server.

## Dynamic Client Registration broker

Use the new CLI helper to register and maintain OAuth clients against NeonPanel's DCR endpoint without hand-editing curl scripts:

```
npm run dcr:broker -- register chatgpt --iat=<INITIAL_ACCESS_TOKEN> --out .dcr/chatgpt.json
npm run dcr:broker -- fetch --registration=<REG_URI> --rat=<REG_ACCESS_TOKEN>
npm run dcr:broker -- update --registration=<REG_URI> --rat=<REG_ACCESS_TOKEN> --metadata path/to/metadata.json
npm run dcr:broker -- delete --registration=<REG_URI> --rat=<REG_ACCESS_TOKEN>
```

If you omit `--metadata` for the register command, the tool uses the built-in ChatGPT profile. Tokens can also be provided via `NEONPANEL_IAT` and `NEONPANEL_RAT` environment variables. Responses can be persisted with `--out=<file>`; files are written with `0600` permissions so they can be moved into a secrets store.
