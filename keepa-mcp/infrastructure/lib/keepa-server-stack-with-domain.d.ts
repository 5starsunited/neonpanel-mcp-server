import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
export interface KeepaServerStackProps extends cdk.StackProps {
    domainName?: string;
    hostedZoneId?: string;
    createHostedZone?: boolean;
}
export declare class KeepaServerStackWithDomain extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: KeepaServerStackProps);
}
