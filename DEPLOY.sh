#!/usr/bin/env bash

set -euo pipefail

echo "🚀 Deploying NeonPanel MCP Server to https://mcp.neonpanel.com"
echo ""

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$ROOT_DIR/infrastructure"

echo "Step 0: Preflight"
if ! command -v docker >/dev/null 2>&1; then
	echo "❌ Docker is not installed or not on PATH. Install Docker Desktop first." >&2
	exit 1
fi
if ! docker version >/dev/null 2>&1; then
	echo "❌ Docker daemon is not running. Start Docker Desktop and retry." >&2
	exit 1
fi
if ! command -v node >/dev/null 2>&1; then
	echo "❌ Node.js is required to run CDK (node not found)." >&2
	exit 1
fi

echo "✅ Preflight OK"
echo ""

echo "Step 1: Build application"
cd "$ROOT_DIR"
npm run build
echo "✅ App build complete"
echo ""

echo "Step 2: Deploy via AWS CDK (ECS/Fargate)"
cd "$INFRA_DIR"
npm run cdk -- deploy NeonpanelMcpStackV3 --require-approval never
echo "✅ CDK deploy complete"
echo ""

echo "Step 3: Verify"
echo "- Health:  curl -fsSIL https://mcp.neonpanel.com/healthz | head -n 5"
echo "- OpenAPI: curl -fsSL  https://mcp.neonpanel.com/openapi.json | head -c 500"
echo ""
