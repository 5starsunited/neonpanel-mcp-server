import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { Construct } from 'constructs';

export class NeonpanelMcpStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
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
    const mcpCertificate = acm.Certificate.fromCertificateArn(
      this, 
      'McpCertificate', 
      'arn:aws:acm:us-east-1:303498144074:certificate/2fee2d20-5b9c-42df-9538-a98df4867097'
    );
    
    const apiCertificate = acm.Certificate.fromCertificateArn(
      this, 
      'ApiCertificate', 
      'arn:aws:acm:us-east-1:303498144074:certificate/a38e88c3-526f-44c2-a76c-a5cef1222a64'
    );

    const service = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'NeonpanelMcpService', {
      cluster,
      cpu: 512,
      memoryLimitMiB: 1024,
      desiredCount: 1,
      taskImageOptions: {
        image: ecs.ContainerImage.fromAsset('..', {
          file: 'Dockerfile',
          platform: Platform.LINUX_AMD64,
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
      path: '/health', 
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
