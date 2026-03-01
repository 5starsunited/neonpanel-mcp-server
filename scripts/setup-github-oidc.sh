#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# One-time setup: create an IAM OIDC identity provider for GitHub Actions
# and a deploy role that the CI workflow can assume.
#
# Run this once from your local machine with admin credentials:
#   AWS_PROFILE=app-dev-administrator bash scripts/setup-github-oidc.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

: "${AWS_PROFILE:=app-dev-administrator}"
export AWS_PROFILE

ACCOUNT_ID="303498144074"
GITHUB_ORG="5starsunited"
GITHUB_REPO="neonpanel-mcp-server"
ROLE_NAME="GitHubActionsDeployRole"

echo "Account:  $ACCOUNT_ID"
echo "Repo:     $GITHUB_ORG/$GITHUB_REPO"
echo "Role:     $ROLE_NAME"
echo ""

# ── 1. Create OIDC provider (idempotent — skips if exists) ──────────────────
OIDC_ARN="arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
if aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_ARN" >/dev/null 2>&1; then
  echo "✅ OIDC provider already exists"
else
  echo "Creating OIDC provider for GitHub Actions..."
  # GitHub's OIDC thumbprint (SHA-1 of the root CA cert). GitHub rotates the
  # intermediate certificate so we pin the root. IAM also validates via TLS so
  # this is belt-and-suspenders. The "1b511abead59c6ce207077c0bf0e0043b1382612"
  # thumbprint covers GitHub's Actions OIDC tokens issued from
  # https://token.actions.githubusercontent.com
  aws iam create-open-id-connect-provider \
    --url "https://token.actions.githubusercontent.com" \
    --client-id-list "sts.amazonaws.com" \
    --thumbprint-list "1b511abead59c6ce207077c0bf0e0043b1382612"
  echo "✅ OIDC provider created"
fi
echo ""

# ── 2. Create IAM role with trust policy scoped to this repo's main branch ──
TRUST_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "$OIDC_ARN"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:${GITHUB_ORG}/${GITHUB_REPO}:ref:refs/heads/main"
        }
      }
    }
  ]
}
EOF
)

if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  echo "Role $ROLE_NAME already exists — updating trust policy..."
  aws iam update-assume-role-policy --role-name "$ROLE_NAME" --policy-document "$TRUST_POLICY"
  echo "✅ Trust policy updated"
else
  echo "Creating role $ROLE_NAME..."
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document "$TRUST_POLICY" \
    --description "GitHub Actions OIDC deploy role for neonpanel-mcp-server"
  echo "✅ Role created"
fi
echo ""

# ── 3. Attach required permissions ──────────────────────────────────────────
# CDK needs broad permissions (CloudFormation, ECR, ECS, IAM passrole, etc.)
# AdministratorAccess is simplest; scope down later if desired.
DEPLOY_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CDKDeploy",
      "Effect": "Allow",
      "Action": [
        "cloudformation:*",
        "ecs:*",
        "ecr:*",
        "ec2:Describe*",
        "elasticloadbalancing:*",
        "logs:*",
        "iam:GetRole",
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:PutRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:GetRolePolicy",
        "iam:PassRole",
        "iam:TagRole",
        "iam:UntagRole",
        "iam:ListRolePolicies",
        "iam:ListAttachedRolePolicies",
        "sts:AssumeRole",
        "ssm:GetParameter",
        "s3:*"
      ],
      "Resource": "*"
    }
  ]
}
EOF
)

INLINE_POLICY_NAME="CDKDeployPermissions"
echo "Attaching inline policy $INLINE_POLICY_NAME..."
aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "$INLINE_POLICY_NAME" \
  --policy-document "$DEPLOY_POLICY"
echo "✅ Policy attached"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Setup complete!"
echo ""
echo "Role ARN:  arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"
echo ""
echo "The GitHub Actions workflow (.github/workflows/deploy.yml) is configured"
echo "to assume this role. Push to main to trigger the first automated deploy."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
