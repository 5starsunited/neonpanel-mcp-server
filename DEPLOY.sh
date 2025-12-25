#!/usr/bin/env bash

set -euo pipefail

# Default AWS profile for NeonPanel dev deployments.
# This script intentionally does NOT honor an existing AWS_PROFILE to avoid
# accidentally deploying with production credentials.
# Override explicitly via: DEPLOY_AWS_PROFILE=other-profile ./DEPLOY.sh
: "${DEPLOY_AWS_PROFILE:=app-dev-administrator}"
AWS_PROFILE="$DEPLOY_AWS_PROFILE"
export AWS_PROFILE

# Expected AWS account for the hardcoded ACM certificates / stack.
EXPECTED_AWS_ACCOUNT_ID="303498144074"

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
if ! command -v aws >/dev/null 2>&1; then
	echo "❌ AWS CLI is required (aws not found). Install AWS CLI v2 and configure SSO." >&2
	exit 1
fi

echo "Using AWS profile: $AWS_PROFILE"
CALLER_ACCOUNT_ID="$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query Account --output text 2>/dev/null || true)"
if [[ -z "$CALLER_ACCOUNT_ID" || "$CALLER_ACCOUNT_ID" == "None" ]]; then
	echo "❌ Unable to read AWS identity for profile '$AWS_PROFILE'." >&2
	echo "   Run: aws sso login --profile $AWS_PROFILE" >&2
	exit 1
fi
if [[ "$CALLER_ACCOUNT_ID" != "$EXPECTED_AWS_ACCOUNT_ID" ]]; then
	echo "❌ Wrong AWS account for deployment: $CALLER_ACCOUNT_ID" >&2
	echo "   Expected account: $EXPECTED_AWS_ACCOUNT_ID (matches hardcoded ACM certs)" >&2
	echo "   Fix by running: aws sso login --profile app-dev-administrator" >&2
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
npm run cdk -- deploy NeonpanelMcpStackV3 --require-approval never --profile "$AWS_PROFILE"
echo "✅ CDK deploy complete"
echo ""

echo "Step 3: Verify"
echo "- Health:  curl -fsSIL https://mcp.neonpanel.com/healthz | head -n 5"
echo "- OpenAPI: curl -fsSL  https://mcp.neonpanel.com/openapi.json | head -c 500"
echo ""
