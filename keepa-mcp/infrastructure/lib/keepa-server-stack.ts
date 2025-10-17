import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { Construct } from 'constructs';

export class KeepaServerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create VPC
    const vpc = new ec2.Vpc(this, 'KeepaVpc', {
      maxAzs: 2,
      natGateways: 1,
    });

    // Create ECS Cluster
    const cluster = new ecs.Cluster(this, 'KeepaCluster', {
      vpc,
      containerInsights: true,
    });

    // Create log group
    const logGroup = new logs.LogGroup(this, 'KeepaLogGroup', {
      logGroupName: '/ecs/keepa-server',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create Fargate service with HTTP load balancer
    // PLATFORM FIXED: Using Platform.LINUX_AMD64
    const fargateService = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'KeepaService', {
      cluster,
      cpu: 512,
      memoryLimitMiB: 1024,
      desiredCount: 1,
      taskImageOptions: {
        image: ecs.ContainerImage.fromAsset('..', {
          file: 'Dockerfile',
          platform: Platform.LINUX_AMD64,
          buildArgs: {
            BUILD_DATE: new Date().toISOString(),
          },
        }),
        containerPort: 3000,
        environment: {
          NODE_ENV: 'production',
          PORT: '3000',
          // Use environment variable instead of SSM secret for simplicity
          KEEPA_API_KEY: '1kvpaieuiepemvme78fggh39r27drmg4m5k086tu91cbc7lfdjthn57o1o3jc6bn',
        },
        logDriver: ecs.LogDrivers.awsLogs({
          streamPrefix: 'keepa-server',
          logGroup,
        }),
      },
      publicLoadBalancer: true,
      protocol: elbv2.ApplicationProtocol.HTTP,
      listenerPort: 80,
    });

    // Configure health check
    fargateService.targetGroup.configureHealthCheck({
      path: '/health',
      healthyHttpCodes: '200',
      interval: cdk.Duration.seconds(30),
      timeout: cdk.Duration.seconds(5),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
    });

    // Auto Scaling
    const scaling = fargateService.service.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 10,
    });

    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
    });

    scaling.scaleOnMemoryUtilization('MemoryScaling', {
      targetUtilizationPercent: 80,
    });

    // Output the URLs
    new cdk.CfnOutput(this, 'LoadBalancerURL', {
      value: `http://${fargateService.loadBalancer.loadBalancerDnsName}`,
      description: 'Load Balancer URL for Keepa Server',
    });

    new cdk.CfnOutput(this, 'WebhookURL', {
      value: `http://${fargateService.loadBalancer.loadBalancerDnsName}/api/keepa/webhook`,
      description: 'Webhook URL to configure in Keepa dashboard',
    });

    new cdk.CfnOutput(this, 'ApiEndpoints', {
      value: `http://${fargateService.loadBalancer.loadBalancerDnsName}/api/keepa/`,
      description: 'Base URL for all Keepa API endpoints',
    });

    // Security information
    new cdk.CfnOutput(this, 'SecurityInfo', {
      value: 'API runs on HTTP port 3000 inside container (secure private network). Load balancer exposes port 80.',
      description: 'Security Configuration - Docker Platform Fixed!',
    });
  }
}
