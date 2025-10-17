import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { Construct } from 'constructs';

export interface KeepaServerStackProps extends cdk.StackProps {
  domainName?: string;
  hostedZoneId?: string;
  createHostedZone?: boolean;
}

export class KeepaServerStackWithDomain extends cdk.Stack {
  constructor(scope: Construct, id: string, props: KeepaServerStackProps = {}) {
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

    // Domain and SSL setup (optional)
    let certificate: acm.Certificate | undefined;
    let hostedZone: route53.IHostedZone | undefined;
    let domainName = props.domainName;

    if (domainName) {
      // Create or import hosted zone
      if (props.createHostedZone) {
        hostedZone = new route53.HostedZone(this, 'KeepaHostedZone', {
          zoneName: domainName,
        });
      } else if (props.hostedZoneId) {
        hostedZone = route53.HostedZone.fromHostedZoneId(this, 'ExistingHostedZone', props.hostedZoneId);
      }

      // Create SSL certificate
      if (hostedZone) {
        certificate = new acm.Certificate(this, 'KeepaCertificate', {
          domainName: domainName,
          subjectAlternativeNames: [`www.${domainName}`, `api.${domainName}`],
          validation: acm.CertificateValidation.fromDns(hostedZone),
        });
      }
    }

    // Create Fargate service with load balancer
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
          KEEPA_API_KEY: '1kvpaieuiepemvme78fggh39r27drmg4m5k086tu91cbc7lfdjthn57o1o3jc6bn',
        },
        logDriver: ecs.LogDrivers.awsLogs({
          streamPrefix: 'keepa-server',
          logGroup,
        }),
      },
      publicLoadBalancer: true,
      // Use HTTPS if certificate is available, otherwise HTTP
      protocol: certificate ? elbv2.ApplicationProtocol.HTTPS : elbv2.ApplicationProtocol.HTTP,
      certificate: certificate,
      domainName: domainName,
      domainZone: hostedZone,
      listenerPort: certificate ? 443 : 80,
    });

    // Add HTTP to HTTPS redirect if using custom domain
    if (certificate && hostedZone) {
      fargateService.loadBalancer.addListener('HttpRedirectListener', {
        port: 80,
        protocol: elbv2.ApplicationProtocol.HTTP,
        defaultAction: elbv2.ListenerAction.redirect({
          protocol: 'HTTPS',
          port: '443',
          permanent: true,
        }),
      });
    }

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

    // Outputs
    const protocol = certificate ? 'https' : 'http';
    const port = certificate ? '' : ':80';
    const baseUrl = domainName ? `${protocol}://${domainName}${port}` : `http://${fargateService.loadBalancer.loadBalancerDnsName}`;

    new cdk.CfnOutput(this, 'LoadBalancerURL', {
      value: baseUrl,
      description: 'Load Balancer URL for Keepa Server',
    });

    new cdk.CfnOutput(this, 'ApiBaseURL', {
      value: `${baseUrl}/api/keepa/`,
      description: 'Base URL for all Keepa API endpoints',
    });

    new cdk.CfnOutput(this, 'WebhookURL', {
      value: `${baseUrl}/api/keepa/webhook`,
      description: 'Webhook URL to configure in Keepa dashboard',
    });

    new cdk.CfnOutput(this, 'HealthCheckURL', {
      value: `${baseUrl}/health`,
      description: 'Health check endpoint',
    });

    // Domain-specific outputs
    if (domainName) {
      new cdk.CfnOutput(this, 'CustomDomain', {
        value: domainName,
        description: 'Custom domain name',
      });

      if (certificate) {
        new cdk.CfnOutput(this, 'SSLCertificate', {
          value: certificate.certificateArn,
          description: 'SSL Certificate ARN',
        });
      }

      if (hostedZone && props.createHostedZone) {
        new cdk.CfnOutput(this, 'NameServers', {
          value: hostedZone.hostedZoneNameServers?.join(', ') || 'Not available',
          description: 'Name servers for domain configuration',
        });
      }
    }

    // Security and performance info
    new cdk.CfnOutput(this, 'SecurityInfo', {
      value: certificate 
        ? 'HTTPS enabled with SSL certificate. HTTP automatically redirects to HTTPS.'
        : 'HTTP only. Add domain name to enable HTTPS.',
      description: 'Security Configuration',
    });
  }
}
