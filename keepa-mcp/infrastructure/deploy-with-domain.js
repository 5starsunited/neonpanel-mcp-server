#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
require("source-map-support/register");
const cdk = __importStar(require("aws-cdk-lib"));
const keepa_server_stack_with_domain_1 = require("./lib/keepa-server-stack-with-domain");
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
new keepa_server_stack_with_domain_1.KeepaServerStackWithDomain(app, 'KeepaServerStack', {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
    },
    domainName,
    hostedZoneId,
    createHostedZone,
});
app.synth();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVwbG95LXdpdGgtZG9tYWluLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiZGVwbG95LXdpdGgtZG9tYWluLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQ0EsdUNBQXFDO0FBQ3JDLGlEQUFtQztBQUNuQyx5RkFBa0Y7QUFFbEYsTUFBTSxHQUFHLEdBQUcsSUFBSSxHQUFHLENBQUMsR0FBRyxFQUFFLENBQUM7QUFFMUIsdURBQXVEO0FBQ3ZELE1BQU0sVUFBVSxHQUFHLEdBQUcsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLFlBQVksQ0FBQyxJQUFJLE9BQU8sQ0FBQyxHQUFHLENBQUMsV0FBVyxDQUFDO0FBQ25GLE1BQU0sWUFBWSxHQUFHLEdBQUcsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLGNBQWMsQ0FBQyxJQUFJLE9BQU8sQ0FBQyxHQUFHLENBQUMsY0FBYyxDQUFDO0FBQzFGLE1BQU0sZ0JBQWdCLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsa0JBQWtCLENBQUMsS0FBSyxNQUFNLElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsS0FBSyxNQUFNLENBQUM7QUFFNUgsT0FBTyxDQUFDLEdBQUcsQ0FBQywyQ0FBMkMsQ0FBQyxDQUFDO0FBQ3pELE9BQU8sQ0FBQyxHQUFHLENBQUMsbUJBQW1CLFVBQVUsSUFBSSw0Q0FBNEMsRUFBRSxDQUFDLENBQUM7QUFDN0YsT0FBTyxDQUFDLEdBQUcsQ0FBQyxzQkFBc0IsWUFBWSxJQUFJLGVBQWUsRUFBRSxDQUFDLENBQUM7QUFDckUsT0FBTyxDQUFDLEdBQUcsQ0FBQywwQkFBMEIsZ0JBQWdCLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQztBQUN6RSxPQUFPLENBQUMsR0FBRyxDQUFDLHVCQUF1QixVQUFVLENBQUMsQ0FBQyxDQUFDLGlCQUFpQixDQUFDLENBQUMsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDLENBQUM7QUFFeEYsSUFBSSwyREFBMEIsQ0FBQyxHQUFHLEVBQUUsa0JBQWtCLEVBQUU7SUFDdEQsR0FBRyxFQUFFO1FBQ0gsT0FBTyxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsbUJBQW1CO1FBQ3hDLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLGtCQUFrQixJQUFJLFdBQVc7S0FDdEQ7SUFDRCxVQUFVO0lBQ1YsWUFBWTtJQUNaLGdCQUFnQjtDQUNqQixDQUFDLENBQUM7QUFFSCxHQUFHLENBQUMsS0FBSyxFQUFFLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIjIS91c3IvYmluL2VudiBub2RlXG5pbXBvcnQgJ3NvdXJjZS1tYXAtc3VwcG9ydC9yZWdpc3Rlcic7XG5pbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgS2VlcGFTZXJ2ZXJTdGFja1dpdGhEb21haW4gfSBmcm9tICcuL2xpYi9rZWVwYS1zZXJ2ZXItc3RhY2std2l0aC1kb21haW4nO1xuXG5jb25zdCBhcHAgPSBuZXcgY2RrLkFwcCgpO1xuXG4vLyBHZXQgZG9tYWluIGNvbmZpZ3VyYXRpb24gZnJvbSBjb250ZXh0IG9yIGVudmlyb25tZW50XG5jb25zdCBkb21haW5OYW1lID0gYXBwLm5vZGUudHJ5R2V0Q29udGV4dCgnZG9tYWluTmFtZScpIHx8IHByb2Nlc3MuZW52LkRPTUFJTl9OQU1FO1xuY29uc3QgaG9zdGVkWm9uZUlkID0gYXBwLm5vZGUudHJ5R2V0Q29udGV4dCgnaG9zdGVkWm9uZUlkJykgfHwgcHJvY2Vzcy5lbnYuSE9TVEVEX1pPTkVfSUQ7XG5jb25zdCBjcmVhdGVIb3N0ZWRab25lID0gYXBwLm5vZGUudHJ5R2V0Q29udGV4dCgnY3JlYXRlSG9zdGVkWm9uZScpID09PSAndHJ1ZScgfHwgcHJvY2Vzcy5lbnYuQ1JFQVRFX0hPU1RFRF9aT05FID09PSAndHJ1ZSc7XG5cbmNvbnNvbGUubG9nKCfwn5qAIEtlZXBhIFNlcnZlciBEZXBsb3ltZW50IENvbmZpZ3VyYXRpb246Jyk7XG5jb25zb2xlLmxvZyhgICAgRG9tYWluIE5hbWU6ICR7ZG9tYWluTmFtZSB8fCAnTm90IHNwZWNpZmllZCAod2lsbCB1c2UgTG9hZCBCYWxhbmNlciBETlMpJ31gKTtcbmNvbnNvbGUubG9nKGAgICBIb3N0ZWQgWm9uZSBJRDogJHtob3N0ZWRab25lSWQgfHwgJ05vdCBzcGVjaWZpZWQnfWApO1xuY29uc29sZS5sb2coYCAgIENyZWF0ZSBIb3N0ZWQgWm9uZTogJHtjcmVhdGVIb3N0ZWRab25lID8gJ1llcycgOiAnTm8nfWApO1xuY29uc29sZS5sb2coYCAgIFNTTCBDZXJ0aWZpY2F0ZTogJHtkb21haW5OYW1lID8gJ1dpbGwgYmUgY3JlYXRlZCcgOiAnTm90IGFwcGxpY2FibGUnfWApO1xuXG5uZXcgS2VlcGFTZXJ2ZXJTdGFja1dpdGhEb21haW4oYXBwLCAnS2VlcGFTZXJ2ZXJTdGFjaycsIHtcbiAgZW52OiB7XG4gICAgYWNjb3VudDogcHJvY2Vzcy5lbnYuQ0RLX0RFRkFVTFRfQUNDT1VOVCxcbiAgICByZWdpb246IHByb2Nlc3MuZW52LkNES19ERUZBVUxUX1JFR0lPTiB8fCAndXMtZWFzdC0xJyxcbiAgfSxcbiAgZG9tYWluTmFtZSxcbiAgaG9zdGVkWm9uZUlkLFxuICBjcmVhdGVIb3N0ZWRab25lLFxufSk7XG5cbmFwcC5zeW50aCgpO1xuIl19