import * as aws from '@pulumi/aws';

// Default read-oriented developer actions if none are specified in config.json
const DEFAULT_DEVELOPER_ACTIONS: string[] = [
  's3:ListAllMyBuckets',
  's3:ListBucket',
  's3:GetObject',
  'ec2:DescribeInstances',
  'ec2:DescribeSecurityGroups',
  'ec2:DescribeVpcs',
  'ec2:DescribeSubnets',
  'lambda:ListFunctions',
  'lambda:GetFunction',
  'cloudwatch:ListMetrics',
  'cloudwatch:GetMetricData',
  'logs:DescribeLogGroups',
  'logs:GetLogEvents',
  'dynamodb:ListTables',
  'dynamodb:DescribeTable',
  'dynamodb:Query',
  'dynamodb:Scan',
];

export function getGlobalDeveloperPolicyDocument(actions?: string[]) {
  const resolvedActions = actions && actions.length > 0 ? actions : DEFAULT_DEVELOPER_ACTIONS;

  return aws.iam.getPolicyDocumentOutput({
    statements: [
      {
        sid: 'DeveloperAccess',
        actions: resolvedActions,
        resources: ['*'],
      },
    ],
  });
}
