#!/usr/bin/env bash
set -euo pipefail

# Creates a PROD-account role that Neonpanel MCP can assume to access Athena/Glue + S3.
#
# This script supports both:
# - read role (default): suitable for SELECT-only
# - write role: suitable for Iceberg INSERT/UPDATE/DELETE/MERGE (requires extra S3 perms)
#
# Usage:
#   aws sso login --profile aap-prod-administrator
#   export ATHENA_RESULTS_BUCKET="your-athena-results-bucket"
#   export ATHENA_RESULTS_PREFIX="athena-results/neonpanel-mcp/"
#   ./scripts/create-prod-athena-role.sh
#
# Optional overrides:
#   export AWS_PROFILE=aap-prod-administrator
#   export AWS_REGION=us-east-1
#   export ROLE_NAME=NeonpanelMcpAthenaReadRole
#   export ROLE_MODE=read   # or: write
#   export DEV_ACCOUNT_ID=303498144074
#   export TRUST_PRINCIPAL_ARN="arn:aws:iam::<dev-account-id>:role/<ecs-task-role>"   # tighter than account root
#   export DATA_BUCKET_ARN="arn:aws:s3:::etl-glue-amazon-ads-prod-preprocessbucketreports6-1w0usrm0kq0j7"
#   export DATA_PREFIX=""   # optional; e.g. "inventory_planning/" to scope reads to a prefix

: "${AWS_PROFILE:=app-prod-administrator}"
: "${AWS_REGION:=us-east-1}"

: "${ROLE_MODE:=read}"

if [[ "$ROLE_MODE" != "read" && "$ROLE_MODE" != "write" ]]; then
  echo "❌ ROLE_MODE must be 'read' or 'write' (got: $ROLE_MODE)" >&2
  exit 1
fi

if [[ "$ROLE_MODE" == "write" ]]; then
  : "${ROLE_NAME:=NeonpanelMcpAthenaWriteRole}"
else
  : "${ROLE_NAME:=NeonpanelMcpAthenaReadRole}"
fi

# Default dev account from this repo’s deploy stack; override if your MCP runs elsewhere.
: "${DEV_ACCOUNT_ID:=303498144074}"

# If TRUST_PRINCIPAL_ARN is empty, we trust the entire dev account root.
: "${TRUST_PRINCIPAL_ARN:=}"

# Data bucket (provided by you)
: "${DATA_BUCKET_ARN:=arn:aws:s3:::etl-glue-amazon-ads-prod-preprocessbucketreports6-1w0usrm0kq0j7}"
: "${DATA_PREFIX:=}"

# Athena results bucket/prefix are required unless your workgroup has a default output location and
# you never override it (still recommended to set explicitly).
: "${ATHENA_RESULTS_BUCKET:=}"
: "${ATHENA_RESULTS_PREFIX:=athena-results/neonpanel-mcp/}"

export AWS_PROFILE AWS_REGION

if [[ -z "$ATHENA_RESULTS_BUCKET" ]]; then
  echo "❌ ATHENA_RESULTS_BUCKET is required (Athena writes query results to S3)." >&2
  echo "   Example: export ATHENA_RESULTS_BUCKET=your-athena-results-bucket" >&2
  exit 1
fi

# Normalize prefixes
if [[ -n "$DATA_PREFIX" && "$DATA_PREFIX" != */ ]]; then
  DATA_PREFIX="$DATA_PREFIX/"
fi
if [[ "$ATHENA_RESULTS_PREFIX" != */ ]]; then
  ATHENA_RESULTS_PREFIX="$ATHENA_RESULTS_PREFIX/"
fi

DATA_BUCKET_NAME="${DATA_BUCKET_ARN#arn:aws:s3:::}"
RESULTS_BUCKET_ARN="arn:aws:s3:::${ATHENA_RESULTS_BUCKET}"

DATA_OBJECTS_ARN="${DATA_BUCKET_ARN}/${DATA_PREFIX}*"
RESULTS_OBJECTS_ARN="${RESULTS_BUCKET_ARN}/${ATHENA_RESULTS_PREFIX}*"

TMPDIR="$(mktemp -d)"
TRUST_JSON="$TMPDIR/trust.json"
POLICY_JSON="$TMPDIR/policy.json"

cleanup() {
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

if [[ -n "$TRUST_PRINCIPAL_ARN" ]]; then
  TRUST_PRINCIPAL="$TRUST_PRINCIPAL_ARN"
else
  TRUST_PRINCIPAL="arn:aws:iam::${DEV_ACCOUNT_ID}:root"
fi

cat > "$TRUST_JSON" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowAssumeFromDev",
      "Effect": "Allow",
      "Principal": { "AWS": "${TRUST_PRINCIPAL}" },
      "Action": "sts:AssumeRole"
    }
  ]
}
JSON

# Create role if it doesn't exist
if aws iam get-role --role-name "$ROLE_NAME" --profile "$AWS_PROFILE" >/dev/null 2>&1; then
  echo "ℹ️  Role already exists: $ROLE_NAME"
else
  echo "Creating role: $ROLE_NAME"
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document "file://$TRUST_JSON" \
    --description "Athena/Glue ${ROLE_MODE} access for Neonpanel MCP" \
    --profile "$AWS_PROFILE" \
    >/dev/null
fi

POLICY_NAME="NeonpanelMcpAthenaReadPolicy"
INLINE_POLICY_NAME="NeonpanelMcpAthenaReadPolicy"
if [[ "$ROLE_MODE" == "write" ]]; then
  POLICY_NAME="NeonpanelMcpAthenaWritePolicy"
  INLINE_POLICY_NAME="NeonpanelMcpAthenaWritePolicy"
fi

GLUE_WRITE_STATEMENT=""
DATA_WRITE_STATEMENT=""
if [[ "$ROLE_MODE" == "write" ]]; then
  GLUE_WRITE_STATEMENT=$(cat <<'JSON'
    ,
    {
      "Sid": "GlueCatalogWriteForIceberg",
      "Effect": "Allow",
      "Action": [
        "glue:UpdateTable"
      ],
      "Resource": "*"
    }
JSON
)

  DATA_WRITE_STATEMENT=$(cat <<JSON
    ,
    {
      "Sid": "WriteUnderlyingDataObjectsForIceberg",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts"
      ],
      "Resource": "${DATA_OBJECTS_ARN}"
    }
JSON
)
fi

cat > "$POLICY_JSON" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AthenaQuery",
      "Effect": "Allow",
      "Action": [
        "athena:StartQueryExecution",
        "athena:GetQueryExecution",
        "athena:GetQueryResults",
        "athena:GetWorkGroup"
      ],
      "Resource": "*"
    },
    {
      "Sid": "GlueCatalogRead",
      "Effect": "Allow",
      "Action": [
        "glue:GetDatabase",
        "glue:GetDatabases",
        "glue:GetTable",
        "glue:GetTables",
        "glue:GetPartition",
        "glue:GetPartitions"
      ],
      "Resource": "*"
    }${GLUE_WRITE_STATEMENT},
    {
      "Sid": "ReadUnderlyingDataObjects",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:GetObjectVersion"],
      "Resource": "${DATA_OBJECTS_ARN}"
    }${DATA_WRITE_STATEMENT},
    {
      "Sid": "ListUnderlyingDataBucket",
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": "${DATA_BUCKET_ARN}"
    },
    {
      "Sid": "WriteAthenaResults",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:AbortMultipartUpload",
        "s3:ListBucketMultipartUploads"
      ],
      "Resource": "${RESULTS_OBJECTS_ARN}"
    },
    {
      "Sid": "ListResultsBucket",
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": "${RESULTS_BUCKET_ARN}"
    }
  ]
}
JSON

echo "Attaching inline policy to role: $ROLE_NAME"
aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "$INLINE_POLICY_NAME" \
  --policy-document "file://$POLICY_JSON" \
  --profile "$AWS_PROFILE" \
  >/dev/null

ROLE_ARN="$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text --profile "$AWS_PROFILE")"

echo "✅ Created/updated role: $ROLE_ARN"
echo "Next: set ATHENA_ASSUME_ROLE_ARN on the MCP service to this ARN."

if [[ "$ROLE_MODE" == "write" ]]; then
  echo "ℹ️  NOTE: This role is intended for Iceberg writes. Ensure the table location matches DATA_BUCKET_ARN/DATA_PREFIX."
fi
