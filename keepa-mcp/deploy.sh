#!/bin/bash

# Keepa Server Deployment Script
set -e

AWS_PROFILE="app-dev-administrator"
REGION="us-east-1"

echo "🚀 Starting Keepa Server deployment to AWS..."
echo "📋 Using AWS Profile: $AWS_PROFILE"
echo "🌍 Using Region: $REGION"

# Check if KEEPA_API_KEY is set
if [ -z "$KEEPA_API_KEY" ]; then
    echo "❌ Error: KEEPA_API_KEY environment variable is required"
    echo "Please set your Keepa API key:"
    echo "export KEEPA_API_KEY=your_keepa_api_key_here"
    exit 1
fi

# Check if AWS CLI is configured
if ! aws sts get-caller-identity --profile $AWS_PROFILE > /dev/null 2>&1; then
    echo "❌ Error: AWS CLI is not configured for profile $AWS_PROFILE"
    echo "Please configure AWS CLI with: aws configure --profile $AWS_PROFILE"
    exit 1
fi

# Store API key in AWS Systems Manager Parameter Store
echo "🔐 Storing Keepa API key in AWS Parameter Store..."
aws ssm put-parameter \
    --profile $AWS_PROFILE \
    --region $REGION \
    --name "KEEPA_API_KEY" \
    --value "$KEEPA_API_KEY" \
    --type "SecureString" \
    --overwrite \
    --description "Keepa API key for the server"

echo "✅ API key stored securely in Parameter Store"

# Build the application
echo "🔨 Building the application..."
npm run build

# Navigate to infrastructure directory
cd infrastructure

# Install CDK dependencies
echo "📦 Installing CDK dependencies..."
npm install

# Bootstrap CDK (if not already done)
echo "🏗️ Bootstrapping CDK..."
npx cdk bootstrap --profile $AWS_PROFILE --region $REGION

# Deploy the stack
echo "🚀 Deploying infrastructure..."
npx cdk deploy --profile $AWS_PROFILE --region $REGION --require-approval never

echo "✅ Deployment completed successfully!"
echo ""
echo "🎉 Your Keepa server is now running on AWS!"
echo "📋 Check the output above for your Load Balancer URL"
echo "🔗 Configure the webhook URL in your Keepa dashboard"
