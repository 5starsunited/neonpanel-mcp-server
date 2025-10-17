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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.NeonpanelMcpStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const ec2 = __importStar(require("aws-cdk-lib/aws-ec2"));
const ecs = __importStar(require("aws-cdk-lib/aws-ecs"));
const ecsPatterns = __importStar(require("aws-cdk-lib/aws-ecs-patterns"));
const elbv2 = __importStar(require("aws-cdk-lib/aws-elasticloadbalancingv2"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
const acm = __importStar(require("aws-cdk-lib/aws-certificatemanager"));
const aws_ecr_assets_1 = require("aws-cdk-lib/aws-ecr-assets");
class NeonpanelMcpStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // Prefer default VPC to avoid IGW/VPC quotas in dev
        const vpc = ec2.Vpc.fromLookup(this, 'NeonpanelMcpVpc', { isDefault: true });
        const cluster = new ecs.Cluster(this, 'NeonpanelMcpCluster', { vpc });
        const logGroup = new logs.LogGroup(this, 'NeonpanelMcpLogs', {
            logGroupName: '/ecs/neonpanel-mcp-v2',
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        // Get the SSL certificates for both domains
        const mcpCertificate = acm.Certificate.fromCertificateArn(this, 'McpCertificate', 'arn:aws:acm:us-east-1:303498144074:certificate/2fee2d20-5b9c-42df-9538-a98df4867097');
        const apiCertificate = acm.Certificate.fromCertificateArn(this, 'ApiCertificate', 'arn:aws:acm:us-east-1:303498144074:certificate/a38e88c3-526f-44c2-a76c-a5cef1222a64');
        const service = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'NeonpanelMcpService', {
            cluster,
            cpu: 512,
            memoryLimitMiB: 1024,
            desiredCount: 1,
            taskImageOptions: {
                image: ecs.ContainerImage.fromAsset('..', {
                    file: 'Dockerfile',
                    platform: aws_ecr_assets_1.Platform.LINUX_AMD64,
                    // Force rebuild - Dynamic MCP capabilities v3.1.1
                }),
                containerPort: 3030,
                environment: {
                    NODE_ENV: 'production',
                    PORT: '3030',
                    NEONPANEL_BASE_URL: 'https://my.neonpanel.com',
                    BUILD_VERSION: 'v3.1.1' // Dynamic MCP with fresh API capabilities
                },
                logDriver: ecs.LogDrivers.awsLogs({ streamPrefix: 'neonpanel-mcp', logGroup }),
            },
            publicLoadBalancer: true,
            protocol: elbv2.ApplicationProtocol.HTTPS,
            listenerPort: 443,
            certificate: mcpCertificate,
            // Enable public IP assignment for ECR access
            assignPublicIp: true,
        });
        // Using existing issued certificate for mcp.neonasphera.com
        service.targetGroup.configureHealthCheck({
            path: '/healthz',
            healthyHttpCodes: '200',
            interval: cdk.Duration.seconds(30),
            timeout: cdk.Duration.seconds(5),
            healthyThresholdCount: 2,
            unhealthyThresholdCount: 3
        });
        new cdk.CfnOutput(this, 'NeonpanelMcpUrl', { value: `https://${service.loadBalancer.loadBalancerDnsName}`, description: 'Base URL for NeonPanel MCP' });
        new cdk.CfnOutput(this, 'NeonpanelMcpCustomUrl', { value: 'https://mcp.neonpanel.com', description: 'Custom domain URL for NeonPanel MCP' });
    }
}
exports.NeonpanelMcpStack = NeonpanelMcpStack;
