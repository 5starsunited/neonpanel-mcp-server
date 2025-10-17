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
exports.KeepaServerStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const ec2 = __importStar(require("aws-cdk-lib/aws-ec2"));
const ecs = __importStar(require("aws-cdk-lib/aws-ecs"));
const ecsPatterns = __importStar(require("aws-cdk-lib/aws-ecs-patterns"));
const elbv2 = __importStar(require("aws-cdk-lib/aws-elasticloadbalancingv2"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
const aws_ecr_assets_1 = require("aws-cdk-lib/aws-ecr-assets");
class KeepaServerStack extends cdk.Stack {
    constructor(scope, id, props) {
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
                    platform: aws_ecr_assets_1.Platform.LINUX_AMD64,
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
exports.KeepaServerStack = KeepaServerStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoia2VlcGEtc2VydmVyLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsia2VlcGEtc2VydmVyLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLHlEQUEyQztBQUMzQyx5REFBMkM7QUFDM0MsMEVBQTREO0FBQzVELDhFQUFnRTtBQUNoRSwyREFBNkM7QUFDN0MsK0RBQXNEO0FBR3RELE1BQWEsZ0JBQWlCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDN0MsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFzQjtRQUM5RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixhQUFhO1FBQ2IsTUFBTSxHQUFHLEdBQUcsSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxVQUFVLEVBQUU7WUFDeEMsTUFBTSxFQUFFLENBQUM7WUFDVCxXQUFXLEVBQUUsQ0FBQztTQUNmLENBQUMsQ0FBQztRQUVILHFCQUFxQjtRQUNyQixNQUFNLE9BQU8sR0FBRyxJQUFJLEdBQUcsQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRTtZQUNwRCxHQUFHO1lBQ0gsaUJBQWlCLEVBQUUsSUFBSTtTQUN4QixDQUFDLENBQUM7UUFFSCxtQkFBbUI7UUFDbkIsTUFBTSxRQUFRLEdBQUcsSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDeEQsWUFBWSxFQUFFLG1CQUFtQjtZQUNqQyxTQUFTLEVBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBQyxRQUFRO1lBQ3RDLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE9BQU87U0FDekMsQ0FBQyxDQUFDO1FBRUgsaURBQWlEO1FBQ2pELDZDQUE2QztRQUM3QyxNQUFNLGNBQWMsR0FBRyxJQUFJLFdBQVcsQ0FBQyxxQ0FBcUMsQ0FBQyxJQUFJLEVB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ay1saWInO1xuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xuaW1wb3J0ICogYXMgZWNzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lY3MnO1xuaW1wb3J0ICogYXMgZWNzUGF0dGVybnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjcy1wYXR0ZXJucyc7XG5pbXBvcnQgKiBhcyBlbGJ2MiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWxhc3RpY2xvYWRiYWxhbmNpbmd2Mic7XG5pbXBvcnQgKiBhcyBsb2dzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcbmltcG9ydCB7IFBsYXRmb3JtIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjci1hc3NldHMnO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5cbmV4cG9ydCBjbGFzcyBLZWVwYVNlcnZlclN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBjZGsuU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgLy8gQ3JlYXRlIFZQQ1xuICAgIGNvbnN0IHZwYyA9IG5ldyBlYzIuVnBjKHRoaXMsICdLZWVwYVZwYycsIHtcbiAgICAgIG1heEF6czogMixcbiAgICAgIG5hdEdhdGV3YXlzOiAxLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIEVDUyBDbHVzdGVyXG4gICAgY29uc3QgY2x1c3RlciA9IG5ldyBlY3MuQ2x1c3Rlcih0aGlzLCAnS2VlcGFDbHVzdGVyJywge1xuICAgICAgdnBjLFxuICAgICAgY29udGFpbmVySW5zaWdodHM6IHRydWUsXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgbG9nIGdyb3VwXG4gICAgY29uc3QgbG9nR3JvdXAgPSBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCAnS2VlcGFMb2dHcm91cCcsIHtcbiAgICAgIGxvZ0dyb3VwTmFtZTogJy9lY3Mva2VlcGEtc2VydmVyJyxcbiAgICAgIHJldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBGYXJnYXRlIHNlcnZpY2Ugd2l0aCBIVFRQIGxvYWQgYmFsYW5jZXJcbiAgICAvLyBQTEFURk9STSBGSVhFRDogVXNpbmcgUGxhdGZvcm0uTElOVVhfQU1ENjRcbiAgICBjb25zdCBmYXJnYXRlU2VydmljZSA9IG5ldyBlY3NQYXR0ZXJucy5BcHBsaWNhdGlvbkxvYWRCYWxhbmNlZEZhcmdhdGVTZXJ2aWNlKHRoaXMsICdLZWVwYVNlcnZpY2UnLCB7XG4gICAgICBjbHVzdGVyLFxuICAgICAgY3B1OiA1MTIsXG4gICAgICBtZW1vcnlMaW1pdE1pQjogMTAyNCxcbiAgICAgIGRlc2lyZWRDb3VudDogMSxcbiAgICAgIHRhc2tJbWFnZU9wdGlvbnM6IHtcbiAgICAgICAgaW1hZ2U6IGVjcy5Db250YWluZXJJbWFnZS5mcm9tQXNzZXQoJy4uJywge1xuICAgICAgICAgIGZpbGU6ICdEb2NrZXJmaWxlJyxcbiAgICAgICAgICBwbGF0Zm9ybTogUGxhdGZvcm0uTElOVVhfQU1ENjQsXG4gICAgICAgICAgYnVpbGRBcmdzOiB7XG4gICAgICAgICAgICBCVUlMRF9EQVRFOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgfSxcbiAgICAgICAgfSksXG4gICAgICAgIGNvbnRhaW5lclBvcnQ6IDMwMDAsXG4gICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgTk9ERV9FTlY6ICdwcm9kdWN0aW9uJyxcbiAgICAgICAgICBQT1JUOiAnMzAwMCcsXG4gICAgICAgICAgLy8gVXNlIGVudmlyb25tZW50IHZhcmlhYmxlIGluc3RlYWQgb2YgU1NNIHNlY3JldCBmb3Igc2ltcGxpY2l0eVxuICAgICAgICAgIEtFRVBBX0FQSV9LRVk6ICcxa3ZwYWlldWllcGVtdm1lNzhmZ2doMzlyMjdkcm1nNG01azA4NnR1OTFjYmM3bGZkanRobjU3bzFvM2pjNmJuJyxcbiAgICAgICAgfSxcbiAgICAgICAgbG9nRHJpdmVyOiBlY3MuTG9nRHJpdmVycy5hd3NMb2dzKHtcbiAgICAgICAgICBzdHJlYW1QcmVmaXg6ICdrZWVwYS1zZXJ2ZXInLFxuICAgICAgICAgIGxvZ0dyb3VwLFxuICAgICAgICB9KSxcbiAgICAgIH0sXG4gICAgICBwdWJsaWNMb2FkQmFsYW5jZXI6IHRydWUsXG4gICAgICBwcm90b2NvbDogZWxidjIuQXBwbGljYXRpb25Qcm90b2NvbC5IVFRQLFxuICAgICAgbGlzdGVuZXJQb3J0OiA4MCxcbiAgICB9KTtcblxuICAgIC8vIENvbmZpZ3VyZSBoZWFsdGggY2hlY2tcbiAgICBmYXJnYXRlU2VydmljZS50YXJnZXRHcm91cC5jb25maWd1cmVIZWFsdGhDaGVjayh7XG4gICAgICBwYXRoOiAnL2hlYWx0aCcsXG4gICAgICBoZWFsdGh5SHR0cENvZGVzOiAnMjAwJyxcbiAgICAgIGludGVydmFsOiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcyg1KSxcbiAgICAgIGhlYWx0aHlUaHJlc2hvbGRDb3VudDogMixcbiAgICAgIHVuaGVhbHRoeVRocmVzaG9sZENvdW50OiAzLFxuICAgIH0pO1xuXG4gICAgLy8gQXV0byBTY2FsaW5nXG4gICAgY29uc3Qgc2NhbGluZyA9IGZhcmdhdGVTZXJ2aWNlLnNlcnZpY2UuYXV0b1NjYWxlVGFza0NvdW50KHtcbiAgICAgIG1pbkNhcGFjaXR5OiAxLFxuICAgICAgbWF4Q2FwYWNpdHk6IDEwLFxuICAgIH0pO1xuXG4gICAgc2NhbGluZy5zY2FsZU9uQ3B1VXRpbGl6YXRpb24oJ0NwdVNjYWxpbmcnLCB7XG4gICAgICB0YXJnZXRVdGlsaXphdGlvblBlcmNlbnQ6IDcwLFxuICAgIH0pO1xuXG4gICAgc2NhbGluZy5zY2FsZU9uTWVtb3J5VXRpbGl6YXRpb24oJ01lbW9yeVNjYWxpbmcnLCB7XG4gICAgICB0YXJnZXRVdGlsaXphdGlvblBlcmNlbnQ6IDgwLFxuICAgIH0pO1xuXG4gICAgLy8gT3V0cHV0IHRoZSBVUkxzXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0xvYWRCYWxhbmNlclVSTCcsIHtcbiAgICAgIHZhbHVlOiBgaHR0cDovLyR7ZmFyZ2F0ZVNlcnZpY2UubG9hZEJhbGFuY2VyLmxvYWRCYWxhbmNlckRuc05hbWV9YCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnTG9hZCBCYWxhbmNlciBVUkwgZm9yIEtlZXBhIFNlcnZlcicsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnV2ViaG9va1VSTCcsIHtcbiAgICAgIHZhbHVlOiBgaHR0cDovLyR7ZmFyZ2F0ZVNlcnZpY2UubG9hZEJhbGFuY2VyLmxvYWRCYWxhbmNlckRuc05hbWV9L2FwaS9rZWVwYS93ZWJob29rYCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnV2ViaG9vayBVUkwgdG8gY29uZmlndXJlIGluIEtlZXBhIGRhc2hib2FyZCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQXBpRW5kcG9pbnRzJywge1xuICAgICAgdmFsdWU6IGBodHRwOi8vJHtmYXJnYXRlU2VydmljZS5sb2FkQmFsYW5jZXIubG9hZEJhbGFuY2VyRG5zTmFtZX0vYXBpL2tlZXBhL2AsXG4gICAgICBkZXNjcmlwdGlvbjogJ0Jhc2UgVVJMIGZvciBhbGwgS2VlcGEgQVBJIGVuZHBvaW50cycsXG4gICAgfSk7XG5cbiAgICAvLyBTZWN1cml0eSBpbmZvcm1hdGlvblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdTZWN1cml0eUluZm8nLCB7XG4gICAgICB2YWx1ZTogJ0FQSSBydW5zIG9uIEhUVFAgcG9ydCAzMDAwIGluc2lkZSBjb250YWluZXIgKHNlY3VyZSBwcml2YXRlIG5ldHdvcmspLiBMb2FkIGJhbGFuY2VyIGV4cG9zZXMgcG9ydCA4MC4nLFxuICAgICAgZGVzY3JpcHRpb246ICdTZWN1cml0eSBDb25maWd1cmF0aW9uIC0gRG9ja2VyIFBsYXRmb3JtIEZpeGVkIScsXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==