# MCP Servers Collection

Production-ready Model Context Protocol (MCP) servers for NeonPanel and Keepa APIs.

## 🚀 Projects

### NeonPanel MCP Server
Thin MCP bridge over the NeonPanel REST API with Provider OAuth bearer validation, JSON-RPC tooling, and SSE transport.

**Key capabilities**
- ✅ OAuth 2.0 bearer token validation via JWKS (Provider OAuth / GPT Connect compatible)
- ✅ `/sse` Server-Sent Events stream + `/messages` JSON-RPC sink
- ✅ Automatic OpenAPI schema refresh with disk caching
- ✅ Structured logging, rate limiting, correlation ids, and health diagnostics
- ✅ Tool registry generated from the NeonPanel 3.0.3 OpenAPI spec, covering:
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
- `GET /sse` – authenticated event stream
- `POST /messages` – JSON-RPC entry point for MCP methods / tools

**Developer workflow**
- `npm run dev` – start the server in watch mode
- `npm run test` – execute unit tests (Node test runner via `tsx`)
- `npm run openapi:refresh` – force-refresh the NeonPanel OpenAPI document and persist it locally
- `scripts/mcp_check.sh` – quick smoke to hit `/healthz`, `initialize`, and `tools/list` (requires `ACCESS_TOKEN`)

**Production:** https://mcp.neonpanel.com

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
