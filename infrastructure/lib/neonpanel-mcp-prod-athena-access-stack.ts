import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class NeonpanelMcpProdAthenaAccessStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const devAccountId = new cdk.CfnParameter(this, 'DevAccountId', {
      type: 'String',
      description: 'AWS account ID where the Neonpanel MCP service runs (trusted to assume this role).',
      default: '303498144074',
    });

    const roleName = new cdk.CfnParameter(this, 'RoleName', {
      type: 'String',
      description: 'Name for the cross-account Athena role to create in the prod account.',
      default: 'NeonpanelMcpAthenaWriteRole',
    });

    const athenaResultsBucket = new cdk.CfnParameter(this, 'AthenaResultsBucket', {
      type: 'String',
      description: 'S3 bucket name used for Athena query results (bucket, not ARN).',
    });

    const athenaResultsPrefix = new cdk.CfnParameter(this, 'AthenaResultsPrefix', {
      type: 'String',
      description: 'Prefix within Athena results bucket (recommend trailing slash). Use empty string for whole bucket.',
      default: 'athena-results/neonpanel-mcp/',
    });

    const dataBucketArn = new cdk.CfnParameter(this, 'DataBucketArn', {
      type: 'String',
      description:
        'S3 bucket ARN for the Iceberg table location (e.g. arn:aws:s3:::my-data-bucket). Must match table LOCATION bucket.',
    });

    const dataPrefix = new cdk.CfnParameter(this, 'DataPrefix', {
      type: 'String',
      description: 'Optional prefix under the data bucket to scope access (recommend trailing slash). Use empty string for whole bucket.',
      default: '',
    });

    const resultsBucketArn = cdk.Fn.join('', ['arn:aws:s3:::', athenaResultsBucket.valueAsString]);
    const resultsObjectsArn = cdk.Fn.join('', [
      resultsBucketArn,
      '/',
      athenaResultsPrefix.valueAsString,
      '*',
    ]);

    const dataObjectsArn = cdk.Fn.join('', [
      dataBucketArn.valueAsString,
      '/',
      dataPrefix.valueAsString,
      '*',
    ]);

    const role = new iam.Role(this, 'NeonpanelMcpAthenaWriteRole', {
      roleName: roleName.valueAsString,
      description: 'Athena/Glue + S3 access for Neonpanel MCP (Iceberg write capable).',
      assumedBy: new iam.AccountPrincipal(devAccountId.valueAsString),
    });

    role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AthenaQuery',
        effect: iam.Effect.ALLOW,
        actions: [
          'athena:StartQueryExecution',
          'athena:GetQueryExecution',
          'athena:GetQueryResults',
          'athena:GetWorkGroup',
        ],
        resources: ['*'],
      }),
    );

    role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'GlueCatalogRead',
        effect: iam.Effect.ALLOW,
        actions: [
          'glue:GetDatabase',
          'glue:GetDatabases',
          'glue:GetTable',
          'glue:GetTables',
          'glue:GetPartition',
          'glue:GetPartitions',
        ],
        resources: ['*'],
      }),
    );

    // Iceberg writes in Athena can require Glue catalog updates (table metadata).
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'GlueCatalogWriteForIceberg',
        effect: iam.Effect.ALLOW,
        actions: ['glue:UpdateTable'],
        resources: ['*'],
      }),
    );

    // Data bucket permissions (Iceberg table location). Iceberg writes often require
    // read/list + delete as part of transactional metadata / file management.
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ListUnderlyingDataBucket',
        effect: iam.Effect.ALLOW,
        actions: ['s3:ListBucket', 's3:GetBucketLocation'],
        resources: [dataBucketArn.valueAsString],
      }),
    );

    role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadWriteUnderlyingDataObjectsForIceberg',
        effect: iam.Effect.ALLOW,
        actions: [
          's3:GetObject',
          's3:GetObjectVersion',
          's3:PutObject',
          's3:DeleteObject',
          's3:AbortMultipartUpload',
          's3:ListMultipartUploadParts',
        ],
        resources: [dataObjectsArn],
      }),
    );

    // Athena results bucket permissions.
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ListResultsBucket',
        effect: iam.Effect.ALLOW,
        actions: ['s3:ListBucket', 's3:GetBucketLocation'],
        resources: [resultsBucketArn],
      }),
    );

    role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'WriteAthenaResults',
        effect: iam.Effect.ALLOW,
        actions: [
          's3:PutObject',
          's3:GetObject',
          's3:AbortMultipartUpload',
          's3:ListBucketMultipartUploads',
        ],
        resources: [resultsObjectsArn],
      }),
    );

    new cdk.CfnOutput(this, 'AthenaAssumeRoleArn', {
      value: role.roleArn,
      description: 'Set ATHENA_ASSUME_ROLE_ARN in the MCP service to this ARN.',
    });
  }
}
