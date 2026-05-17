# MCP Servers Collection

Production-ready Model Context Protocol (MCP) servers for NeonPanel and Keepa APIs.

## 🚀 Projects

### NeonPanel MCP Server
Thin MCP bridge over the NeonPanel REST API with Provider OAuth bearer validation, JSON-RPC tooling, and SSE transport.

**Key capabilities**
  - `neonpanel.listCompanies`
  - `neonpanel.listReports`
  - `neonpanel.listInventoryItems`
  - `neonpanel.listWarehouses`
  - `neonpanel.getWarehouseBalances`
  - `neonpanel.getInventoryDetails`
  - `neonpanel.getInventoryLandedCost`
  - `neonpanel.getInventoryCogs`
  - `neonpanel.getRevenueAndCogs`
  - `neonpanel.getImportInstructions`
  - `neonpanel.createDocuments`
  - `neonpanel.createDocumentsByPdf`
  - `neonpanel.checkImportStatus`

**Operational endpoints**

- `GET /healthz` – readiness / diagnostics (`?deep=1` performs JWKS + schema reachability checks)
- `POST /mcp` – streamable HTTP JSON-RPC (public discovery; OAuth for `tools/call`)
- `GET /sse` – event stream (no auth required just to connect)
- `POST /messages` – JSON-RPC sink (used with SSE sessions)

## Endpoints

### MCP

- `POST /mcp` (Streamable HTTP / JSON-RPC)
  - Public (no OAuth): `initialize`, `initialized`, `tools/list`
  - OAuth required: `tools/call`
    - If the bearer token is missing/invalid the server returns `HTTP 401` and includes both:
      - `WWW-Authenticate: Bearer ... resource_metadata="https://mcp.neonpanel.com/.well-known/oauth-protected-resource"`
      - a JSON-RPC error whose `error.data._meta['mcp/www_authenticate']` contains the same challenge

- `GET /sse` (optional SSE transport)
  - Does **not** require auth just to open the stream.
  - The server emits an `endpoint` SSE event pointing to `POST /messages?sessionId=...`.

### OAuth Metadata

- `GET /.well-known/oauth-protected-resource`
- `GET /.well-known/oauth-authorization-server`

**Developer workflow**
- `npm run dev` – start the server in watch mode
- `npm run test` – execute unit tests (Node test runner via `tsx`)
- `npm run openapi:refresh` – force-refresh the NeonPanel OpenAPI document and persist it locally
- `scripts/mcp_check.sh` – quick smoke to hit `/healthz`, `initialize`, and `tools/list` (requires `ACCESS_TOKEN`)

**Production:** https://mcp.neonpanel.com

### NeonPanel API Schemas

NeonPanel exposes multiple OpenAPI documents. The general GPT API schema is available from `https://my.neonpanel.com/api/v1/scheme/3.1.0`, while project/document routes such as Inventory Orders, Bills, Shipments, Invoices, Adjustments, Payment Requests, Vendors, Services, and Payment Terms are documented separately at:

```bash
curl -fsS 'https://my.neonpanel.com/api/v1/scheme/documents' -o /tmp/neonpanel-documents.yaml
```

Use the dedicated documents schema when checking project-management tools or refreshing [documents.yaml](documents.yaml):

```bash
grep -n 'shipments\|Shipment\|/companies/{companyUuid}/shipments' /tmp/neonpanel-documents.yaml | head -80
```

## 📊 Athena (FBA Planning)

The tool `amazon_supply_chain.fba_list_replenish_asap` runs an Athena query against the Glue Data Catalog.

**Config (environment variables)**
- `ATHENA_CATALOG` (default `awsdatacatalog`)
- `ATHENA_DATABASE` (default `inventory_planning`)
- `ATHENA_TABLE_INVENTORY_PLANNING_SNAPSHOT` (default `inventory_planning_snapshot`)
- `ATHENA_WORKGROUP` (default `primary`)
- `ATHENA_OUTPUT_LOCATION` (optional; required if your workgroup doesn’t have a results location)
- `ATHENA_ASSUME_ROLE_ARN` (optional; if set, the server will `sts:AssumeRole` before querying)
- `AWS_REGION` (required for AWS SDK)

**Local dev against prod data (uses your AWS profile)**
```bash
aws sso login --profile aap-prod-administrator

AWS_PROFILE=aap-prod-administrator \
AWS_REGION=us-east-1 \
npm run dev
```

In production (ECS/Fargate), credentials come from the task role by default. If the dataset lives in a different AWS account, set `ATHENA_ASSUME_ROLE_ARN` to a role in that account that trusts the task role.

### Keepa MCP Server
Amazon product tracking and price analysis via Keepa API.

**Tools:** `getProduct`, `searchProducts`, `getBestSellers`

## 📦 Quick Start

```bash
# Clone
git clone https://github.com/5starsunited/neonpanel-mcp-server.git
cd neonpanel-mcp-server

# Install & Build
npm install
npm run build

# Run
npm run dev
```

## 🔧 Development

### NeonPanel MCP
```bash
npm run dev  # Starts on port 3030

# Testing
./test-oauth-compliance.sh
./test-bearer-auth.sh
./test-mcp-server-complete.sh

# DCR Broker CLI
npm run dcr:broker -- register chatgpt --iat=TOKEN --out .dcr/chatgpt.json
```

### Keepa MCP
```bash
cd keepa-mcp
npm install
cp .env.example .env  # Add KEEPA_API_KEY
npm start
```

## 🚀 Deployment

### AWS Fargate (NeonPanel)
```bash
aws sso login --profile app-dev-administrator

# Option A: use the repo deploy script (recommended)
./DEPLOY.sh

# Override profile explicitly (script does not honor AWS_PROFILE)
DEPLOY_AWS_PROFILE=app-dev-administrator ./DEPLOY.sh

# Option B: deploy CDK directly
cd infrastructure
npm install
cdk deploy --profile app-dev-administrator
```

## 🔐 Authentication

**NeonPanel OAuth Flow:**
1. **IAT** (3h) → Register clients
2. **RAT** (30d) → Manage clients  
3. **Access Tokens** → User sessions

**Discovery:**
- `/.well-known/oauth-authorization-server`
- `/.well-known/ai-plugin.json`
- `/openapi.json`

## 📖 Documentation

- [ChatGPT Integration](CHATGPT_INTEGRATION_GUIDE.md)
- [OAuth Architecture](CORRECT_OAUTH_ARCHITECTURE.md)
- [Deployment Guide](BEARER_AUTH_DEPLOYMENT.md)
- [Keepa API Docs](keepa-mcp/API_DOCUMENTATION.md)

## 🏗️ Architecture

```
ChatGPT → ALB (HTTPS) → Fargate → MCP Server → NeonPanel API
```

**Stack:**
- Express + MCP SDK
- JWT validation (JWKS)
- AWS ECS/Fargate
- CDK Infrastructure

## 🧪 Testing

```bash
# NeonPanel
./test-oauth-compliance.sh
./test-dcr-complete.sh
./test-bearer-auth.sh

# Keepa
cd keepa-mcp && npm test
```

## 🤝 Contributing

1. Fork repository
2. Create feature branch
3. Commit changes
4. Push and open PR

## 📄 License

See project subdirectories for license info.

## 🔗 Links

- [NeonPanel](https://neonpanel.com)
- [MCP Protocol](https://modelcontextprotocol.io)
- [Keepa API](https://keepa.com/#!api)

**Repository:** https://github.com/5starsunited/neonpanel-mcp-server
**Last Updated:** October 16, 2025
