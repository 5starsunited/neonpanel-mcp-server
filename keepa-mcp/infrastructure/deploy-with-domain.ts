#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { KeepaServerStackWithDomain } from './lib/keepa-server-stack-with-domain';

const app = new cdk.App();

// Get domain configuration from context or environment
const domainName = app.node.tryGetContext('domainName') || process.env.DOMAIN_NAME;
const hostedZoneId = app.node.tryGetContext('hostedZoneId') || process.env.HOSTED_ZONE_ID;
const createHostedZone = app.node.tryGetContext('createHostedZone') === 'true' || process.env.CREATE_HOSTED_ZONE === 'true';

console.log('🚀 Keepa Server Deployment Configuration:');
console.log(`   Domain Name: ${domainName || 'Not specified (will use Load Balancer DNS)'}`);
console.log(`   Hosted Zone ID: ${hostedZoneId || 'Not specified'}`);
console.log(`   Create Hosted Zone: ${createHostedZone ? 'Yes' : 'No'}`);
console.log(`   SSL Certificate: ${domainName ? 'Will be created' : 'Not applicable'}`);

new KeepaServerStackWithDomain(app, 'KeepaServerStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  domainName,
  hostedZoneId,
  createHostedZone,
});

app.synth();
