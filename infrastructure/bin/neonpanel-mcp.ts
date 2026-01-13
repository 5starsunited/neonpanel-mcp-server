#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { NeonpanelMcpStack } from '../lib/neonpanel-mcp-stack';
import { NeonpanelMcpProdAthenaAccessStack } from '../lib/neonpanel-mcp-prod-athena-access-stack';

const app = new cdk.App();
new NeonpanelMcpStack(app, 'NeonpanelMcpStackV3', {
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT || '303498144074', 
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1' 
  },
});

// Deploy this stack to the PROD account to create/update the cross-account role that
// the MCP service assumes for Athena/Iceberg operations.
new NeonpanelMcpProdAthenaAccessStack(app, 'NeonpanelMcpProdAthenaAccessStack', {
  env: {
    account: '451729026804',
    region: 'us-east-1',
  },
});

