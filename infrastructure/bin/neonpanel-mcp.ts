#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { NeonpanelMcpStack } from '../lib/neonpanel-mcp-stack';

const app = new cdk.App();
new NeonpanelMcpStack(app, 'NeonpanelMcpStackV3', {
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT || '303498144074', 
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1' 
  },
});

