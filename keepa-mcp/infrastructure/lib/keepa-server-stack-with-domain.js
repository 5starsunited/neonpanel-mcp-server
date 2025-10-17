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
exports.KeepaServerStackWithDomain = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const ec2 = __importStar(require("aws-cdk-lib/aws-ec2"));
const ecs = __importStar(require("aws-cdk-lib/aws-ecs"));
const ecsPatterns = __importStar(require("aws-cdk-lib/aws-ecs-patterns"));
const elbv2 = __importStar(require("aws-cdk-lib/aws-elasticloadbalancingv2"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
const route53 = __importStar(require("aws-cdk-lib/aws-route53"));
const acm = __importStar(require("aws-cdk-lib/aws-certificatemanager"));
const aws_ecr_assets_1 = require("aws-cdk-lib/aws-ecr-assets");
class KeepaServerStackWithDomain extends cdk.Stack {
    constructor(scope, id, props = {}) {
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
        let certificate;
        let hostedZone;
        let domainName = props.domainName;
        if (domainName) {
            // Create or import hosted zone
            if (props.createHostedZone) {
                hostedZone = new route53.HostedZone(this, 'KeepaHostedZone', {
                    zoneName: domainName,
                });
            }
            else if (props.hostedZoneId) {
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
                    platform: aws_ecr_assets_1.Platform.LINUX_AMD64,
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
exports.KeepaServerStackWithDomain = KeepaServerStackWithDomain;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoia2VlcGEtc2VydmVyLXN0YWNrLXdpdGgtZG9tYWluLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsia2VlcGEtc2VydmVyLXN0YWNrLXdpdGgtZG9tYWluLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLHlEQUEyQztBQUMzQyx5REFBMkM7QUFDM0MsMEVBQTREO0FBQzVELDhFQUFnRTtBQUNoRSwyREFBNkM7QUFDN0MsaUVBQW1EO0FBQ25ELHdFQUEwRDtBQUUxRCwrREFBc0Q7QUFTdEQsTUFBYSwwQkFBMkIsU0FBUSxHQUFHLENBQUMsS0FBSztJQUN2RCxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLFFBQStCLEVBQUU7UUFDekUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsYUFBYTtRQUNiLE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsVUFBVSxFQUFFO1lBQ3hDLE1BQU0sRUFBRSxDQUFDO1lBQ1QsV0FBVyxFQUFFLENBQUM7U0FDZixDQUFDLENBQUM7UUFFSCxxQkFBcUI7UUFDckIsTUFBTSxPQUFPLEdBQUcsSUFBSSxHQUFHLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxjQUFjLEVBQUU7WUFDcEQsR0FBRztZQUNILGlCQUFpQixFQUFFLElBQUk7U0FDeEIsQ0FBQyxDQUFDO1FBRUgsbUJBQW1CO1FBQ25CLE1BQU0sUUFBUSxHQUFHLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsZUFBZSxFQUFFO1lBQ3hELFlBQVksRUFBRSxtQkFBbUI7WUFDakMsU0FBUyxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsUUFBUTtZQUN0QyxhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxPQUFPO1NBQ3pDLENBQUMsQ0FBQztRQUVILGtDQUFrQztRQUNsQyxJQUFJLFdB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QUNGO1FBRUQsZ0NBQWdDO1FBQ2hDLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFO1lBQ3RDLEtBQUssRUFBRSxXQUFXO2dCQUNoQixDQUFDLENBQUMsNEVBQTRFO2dCQUM5RSxDQUFDLENBQUMsNkNBQTZDO1lBQ2pELFdBQVcsRUFBRSx3QkFBd0I7U0FDdEMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBOUtELGdFQThLQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XG5pbXBvcnQgKiBhcyBlY3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjcyc7XG5pbXBvcnQgKiBhcyBlY3NQYXR0ZXJucyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNzLXBhdHRlcm5zJztcbmltcG9ydCAqIGFzIGVsYnYyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lbGFzdGljbG9hZGJhbGFuY2luZ3YyJztcbmltcG9ydCAqIGFzIGxvZ3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xuaW1wb3J0ICogYXMgcm91dGU1MyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtcm91dGU1Myc7XG5pbXBvcnQgKiBhcyBhY20gZnJvbSAnYXdzLWNkay1saWIvYXdzLWNlcnRpZmljYXRlbWFuYWdlcic7XG5pbXBvcnQgKiBhcyB0YXJnZXRzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1yb3V0ZTUzLXRhcmdldHMnO1xuaW1wb3J0IHsgUGxhdGZvcm0gfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNyLWFzc2V0cyc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcblxuZXhwb3J0IGludGVyZmFjZSBLZWVwYVNlcnZlclN0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIGRvbWFpbk5hbWU/OiBzdHJpbmc7XG4gIGhvc3RlZFpvbmVJZD86IHN0cmluZztcbiAgY3JlYXRlSG9zdGVkWm9uZT86IGJvb2xlYW47XG59XG5cbmV4cG9ydCBjbGFzcyBLZWVwYVNlcnZlclN0YWNrV2l0aERvbWFpbiBleHRlbmRzIGNkay5TdGFjayB7XG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBLZWVwYVNlcnZlclN0YWNrUHJvcHMgPSB7fSkge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgLy8gQ3JlYXRlIFZQQ1xuICAgIGNvbnN0IHZwYyA9IG5ldyBlYzIuVnBjKHRoaXMsICdLZWVwYVZwYycsIHtcbiAgICAgIG1heEF6czogMixcbiAgICAgIG5hdEdhdGV3YXlzOiAxLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIEVDUyBDbHVzdGVyXG4gICAgY29uc3QgY2x1c3RlciA9IG5ldyBlY3MuQ2x1c3Rlcih0aGlzLCAnS2VlcGFDbHVzdGVyJywge1xuICAgICAgdnBjLFxuICAgICAgY29udGFpbmVySW5zaWdodHM6IHRydWUsXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgbG9nIGdyb3VwXG4gICAgY29uc3QgbG9nR3JvdXAgPSBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCAnS2VlcGFMb2dHcm91cCcsIHtcbiAgICAgIGxvZ0dyb3VwTmFtZTogJy9lY3Mva2VlcGEtc2VydmVyJyxcbiAgICAgIHJldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICB9KTtcblxuICAgIC8vIERvbWFpbiBhbmQgU1NMIHNldHVwIChvcHRpb25hbClcbiAgICBsZXQgY2VydGlmaWNhdGU6IGFjbS5DZXJ0aWZpY2F0ZSB8IHVuZGVmaW5lZDtcbiAgICBsZXQgaG9zdGVkWm9uZTogcm91dGU1My5JSG9zdGVkWm9uZSB8IHVuZGVmaW5lZDtcbiAgICBsZXQgZG9tYWluTmFtZSA9IHByb3BzLmRvbWFpbk5hbWU7XG5cbiAgICBpZiAoZG9tYWluTmFtZSkge1xuICAgICAgLy8gQ3JlYXRlIG9yIGltcG9ydCBob3N0ZWQgem9uZVxuICAgICAgaWYgKHByb3BzLmNyZWF0ZUhvc3RlZFpvbmUpIHtcbiAgICAgICAgaG9zdGVkWm9uZSA9IG5ldyByb3V0ZTUzLkhvc3RlZFpvbmUodGhpcywgJ0tlZXBhSG9zdGVkWm9uZScsIHtcbiAgICAgICAgICB6b25lTmFtZTogZG9tYWluTmFtZSxcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2UgaWYgKHByb3BzLmhvc3RlZFpvbmVJZCkge1xuICAgICAgICBob3N0ZWRab25lID0gcm91dGU1My5Ib3N0ZWRab25lLmZyb21Ib3N0ZWRab25lSWQodGhpcywgJ0V4aXN0aW5nSG9zdGVkWm9uZScsIHByb3BzLmhvc3RlZFpvbmVJZCk7XG4gICAgICB9XG5cbiAgICAgIC8vIENyZWF0ZSBTU0wgY2VydGlmaWNhdGVcbiAgICAgIGlmIChob3N0ZWRab25lKSB7XG4gICAgICAgIGNlcnRpZmljYXRlID0gbmV3IGFjbS5DZXJ0aWZpY2F0ZSh0aGlzLCAnS2VlcGFDZXJ0aWZpY2F0ZScsIHtcbiAgICAgICAgICBkb21haW5OYW1lOiBkb21haW5OYW1lLFxuICAgICAgICAgIHN1YmplY3RBbHRlcm5hdGl2ZU5hbWVzOiBbYHd3dy4ke2RvbWFpbk5hbWV9YCwgYGFwaS4ke2RvbWFpbk5hbWV9YF0sXG4gICAgICAgICAgdmFsaWRhdGlvbjogYWNtLkNlcnRpZmljYXRlVmFsaWRhdGlvbi5mcm9tRG5zKGhvc3RlZFpvbmUpLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBDcmVhdGUgRmFyZ2F0ZSBzZXJ2aWNlIHdpdGggbG9hZCBiYWxhbmNlclxuICAgIGNvbnN0IGZhcmdhdGVTZXJ2aWNlID0gbmV3IGVjc1BhdHRlcm5zLkFwcGxpY2F0aW9uTG9hZEJhbGFuY2VkRmFyZ2F0ZVNlcnZpY2UodGhpcywgJ0tlZXBhU2VydmljZScsIHtcbiAgICAgIGNsdXN0ZXIsXG4gICAgICBjcHU6IDUxMixcbiAgICAgIG1lbW9yeUxpbWl0TWlCOiAxMDI0LFxuICAgICAgZGVzaXJlZENvdW50OiAxLFxuICAgICAgdGFza0ltYWdlT3B0aW9uczoge1xuICAgICAgICBpbWFnZTogZWNzLkNvbnRhaW5lckltYWdlLmZyb21Bc3NldCgnLi4nLCB7XG4gICAgICAgICAgZmlsZTogJ0RvY2tlcmZpbGUnLFxuICAgICAgICAgIHBsYXRmb3JtOiBQbGF0Zm9ybS5MSU5VWF9BTUQ2NCxcbiAgICAgICAgICBidWlsZEFyZ3M6IHtcbiAgICAgICAgICAgIEJVSUxEX0RBVEU6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICB9LFxuICAgICAgICB9KSxcbiAgICAgICAgY29udGFpbmVyUG9ydDogMzAwMCxcbiAgICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgICBOT0RFX0VOVjogJ3Byb2R1Y3Rpb24nLFxuICAgICAgICAgIFBPUlQ6ICczMDAwJyxcbiAgICAgICAgICBLRUVQQV9BUElfS0VZOiAnMWt2cGFpZXVpZXBlbXZtZTc4ZmdnaDM5cjI3ZHJtZzRtNWswODZ0dTkxY2JjN2xmZGp0aG41N28xbzNqYzZibicsXG4gICAgICAgIH0sXG4gICAgICAgIGxvZ0RyaXZlcjogZWNzLkxvZ0RyaXZlcnMuYXdzTG9ncyh7XG4gICAgICAgICAgc3RyZWFtUHJlZml4OiAna2VlcGEtc2VydmVyJyxcbiAgICAgICAgICBsb2dHcm91cCxcbiAgICAgICAgfSksXG4gICAgICB9LFxuICAgICAgcHVibGljTG9hZEJhbGFuY2VyOiB0cnVlLFxuICAgICAgLy8gVXNlIEhUVFBTIGlmIGNlcnRpZmljYXRlIGlzIGF2YWlsYWJsZSwgb3RoZXJ3aXNlIEhUVFBcbiAgICAgIHByb3RvY29sOiBjZXJ0aWZpY2F0ZSA/IGVsYnYyLkFwcGxpY2F0aW9uUHJvdG9jb2wuSFRUUFMgOiBlbGJ2Mi5BcHBsaWNhdGlvblByb3RvY29sLkhUVFAsXG4gICAgICBjZXJ0aWZpY2F0ZTogY2VydGlmaWNhdGUsXG4gICAgICBkb21haW5OYW1lOiBkb21haW5OYW1lLFxuICAgICAgZG9tYWluWm9uZTogaG9zdGVkWm9uZSxcbiAgICAgIGxpc3RlbmVyUG9ydDogY2VydGlmaWNhdGUgPyA0NDMgOiA4MCxcbiAgICB9KTtcblxuICAgIC8vIEFkZCBIVFRQIHRvIEhUVFBTIHJlZGlyZWN0IGlmIHVzaW5nIGN1c3RvbSBkb21haW5cbiAgICBpZiAoY2VydGlmaWNhdGUgJiYgaG9zdGVkWm9uZSkge1xuICAgICAgZmFyZ2F0ZVNlcnZpY2UubG9hZEJhbGFuY2VyLmFkZExpc3RlbmVyKCdIdHRwUmVkaXJlY3RMaXN0ZW5lcicsIHtcbiAgICAgICAgcG9ydDogODAsXG4gICAgICAgIHByb3RvY29sOiBlbGJ2Mi5BcHBsaWNhdGlvblByb3RvY29sLkhUVFAsXG4gICAgICAgIGRlZmF1bHRBY3Rpb246IGVsYnYyLkxpc3RlbmVyQWN0aW9uLnJlZGlyZWN0KHtcbiAgICAgICAgICBwcm90b2NvbDogJ0hUVFBTJyxcbiAgICAgICAgICBwb3J0OiAnNDQzJyxcbiAgICAgICAgICBwZXJtYW5lbnQ6IHRydWUsXG4gICAgICAgIH0pLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gQ29uZmlndXJlIGhlYWx0aCBjaGVja1xuICAgIGZhcmdhdGVTZXJ2aWNlLnRhcmdldEdyb3VwLmNvbmZpZ3VyZUhlYWx0aENoZWNrKHtcbiAgICAgIHBhdGg6ICcvaGVhbHRoJyxcbiAgICAgIGhlYWx0aHlIdHRwQ29kZXM6ICcyMDAnLFxuICAgICAgaW50ZXJ2YWw6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDUpLFxuICAgICAgaGVhbHRoeVRocmVzaG9sZENvdW50OiAyLFxuICAgICAgdW5oZWFsdGh5VGhyZXNob2xkQ291bnQ6IDMsXG4gICAgfSk7XG5cbiAgICAvLyBBdXRvIFNjYWxpbmdcbiAgICBjb25zdCBzY2FsaW5nID0gZmFyZ2F0ZVNlcnZpY2Uuc2VydmljZS5hdXRvU2NhbGVUYXNrQ291bnQoe1xuICAgICAgbWluQ2FwYWNpdHk6IDEsXG4gICAgICBtYXhDYXBhY2l0eTogMTAsXG4gICAgfSk7XG5cbiAgICBzY2FsaW5nLnNjYWxlT25DcHVVdGlsaXphdGlvbignQ3B1U2NhbGluZycsIHtcbiAgICAgIHRhcmdldFV0aWxpemF0aW9uUGVyY2VudDogNzAsXG4gICAgfSk7XG5cbiAgICBzY2FsaW5nLnNjYWxlT25NZW1vcnlVdGlsaXphdGlvbignTWVtb3J5U2NhbGluZycsIHtcbiAgICAgIHRhcmdldFV0aWxpemF0aW9uUGVyY2VudDogODAsXG4gICAgfSk7XG5cbiAgICAvLyBPdXRwdXRzXG4gICAgY29uc3QgcHJvdG9jb2wgPSBjZXJ0aWZpY2F0ZSA/ICdodHRwcycgOiAnaHR0cCc7XG4gICAgY29uc3QgcG9ydCA9IGNlcnRpZmljYXRlID8gJycgOiAnOjgwJztcbiAgICBjb25zdCBiYXNlVXJsID0gZG9tYWluTmFtZSA/IGAke3Byb3RvY29sfTovLyR7ZG9tYWluTmFtZX0ke3BvcnR9YCA6IGBodHRwOi8vJHtmYXJnYXRlU2VydmljZS5sb2FkQmFsYW5jZXIubG9hZEJhbGFuY2VyRG5zTmFtZX1gO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0xvYWRCYWxhbmNlclVSTCcsIHtcbiAgICAgIHZhbHVlOiBiYXNlVXJsLFxuICAgICAgZGVzY3JpcHRpb246ICdMb2FkIEJhbGFuY2VyIFVSTCBmb3IgS2VlcGEgU2VydmVyJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBcGlCYXNlVVJMJywge1xuICAgICAgdmFsdWU6IGAke2Jhc2VVcmx9L2FwaS9rZWVwYS9gLFxuICAgICAgZGVzY3JpcHRpb246ICdCYXNlIFVSTCBmb3IgYWxsIEtlZXBhIEFQSSBlbmRwb2ludHMnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1dlYmhvb2tVUkwnLCB7XG4gICAgICB2YWx1ZTogYCR7YmFzZVVybH0vYXBpL2tlZXBhL3dlYmhvb2tgLFxuICAgICAgZGVzY3JpcHRpb246ICdXZWJob29rIFVSTCB0byBjb25maWd1cmUgaW4gS2VlcGEgZGFzaGJvYXJkJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdIZWFsdGhDaGVja1VSTCcsIHtcbiAgICAgIHZhbHVlOiBgJHtiYXNlVXJsfS9oZWFsdGhgLFxuICAgICAgZGVzY3JpcHRpb246ICdIZWFsdGggY2hlY2sgZW5kcG9pbnQnLFxuICAgIH0pO1xuXG4gICAgLy8gRG9tYWluLXNwZWNpZmljIG91dHB1dHNcbiAgICBpZiAoZG9tYWluTmFtZSkge1xuICAgICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0N1c3RvbURvbWFpbicsIHtcbiAgICAgICAgdmFsdWU6IGRvbWFpbk5hbWUsXG4gICAgICAgIGRlc2NyaXB0aW9uOiAnQ3VzdG9tIGRvbWFpbiBuYW1lJyxcbiAgICAgIH0pO1xuXG4gICAgICBpZiAoY2VydGlmaWNhdGUpIHtcbiAgICAgICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1NTTENlcnRpZmljYXRlJywge1xuICAgICAgICAgIHZhbHVlOiBjZXJ0aWZpY2F0ZS5jZXJ0aWZpY2F0ZUFybixcbiAgICAgICAgICBkZXNjcmlwdGlvbjogJ1NTTCBDZXJ0aWZpY2F0ZSBBUk4nLFxuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgaWYgKGhvc3RlZFpvbmUgJiYgcHJvcHMuY3JlYXRlSG9zdGVkWm9uZSkge1xuICAgICAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnTmFtZVNlcnZlcnMnLCB7XG4gICAgICAgICAgdmFsdWU6IGhvc3RlZFpvbmUuaG9zdGVkWm9uZU5hbWVTZXJ2ZXJzPy5qb2luKCcsICcpIHx8ICdOb3QgYXZhaWxhYmxlJyxcbiAgICAgICAgICBkZXNjcmlwdGlvbjogJ05hbWUgc2VydmVycyBmb3IgZG9tYWluIGNvbmZpZ3VyYXRpb24nLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBTZWN1cml0eSBhbmQgcGVyZm9ybWFuY2UgaW5mb1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdTZWN1cml0eUluZm8nLCB7XG4gICAgICB2YWx1ZTogY2VydGlmaWNhdGUgXG4gICAgICAgID8gJ0hUVFBTIGVuYWJsZWQgd2l0aCBTU0wgY2VydGlmaWNhdGUuIEhUVFAgYXV0b21hdGljYWxseSByZWRpcmVjdHMgdG8gSFRUUFMuJ1xuICAgICAgICA6ICdIVFRQIG9ubHkuIEFkZCBkb21haW4gbmFtZSB0byBlbmFibGUgSFRUUFMuJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnU2VjdXJpdHkgQ29uZmlndXJhdGlvbicsXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==