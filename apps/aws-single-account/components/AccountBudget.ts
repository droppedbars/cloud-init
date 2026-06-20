import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import * as path from 'path';

export interface AccountBudgetArgs {
  limitAmount: string;
  limitUnit: string;
  subscriberEmailAddresses: string[];
  allowedRegions: string[];
  killSwitch?: {
    thresholdAmount: string;
    subscriberEmailAddresses: string[];
  };
}

export class AccountBudget extends pulumi.ComponentResource {
  constructor(name: string, args: AccountBudgetArgs, opts?: pulumi.ComponentResourceOptions) {
    super('cloud-init:billing:AccountBudget', name, args, opts);

    const notifications: aws.types.input.budgets.BudgetNotification[] = [
      {
        comparisonOperator: 'GREATER_THAN',
        threshold: 80,
        thresholdType: 'PERCENTAGE',
        notificationType: 'ACTUAL',
        subscriberEmailAddresses: args.subscriberEmailAddresses,
      },
      {
        comparisonOperator: 'GREATER_THAN',
        threshold: 100,
        thresholdType: 'PERCENTAGE',
        notificationType: 'FORECASTED',
        subscriberEmailAddresses: args.subscriberEmailAddresses,
      },
    ];

    if (args.killSwitch) {
      // 1. Create SNS Topic for the Budget to publish to
      const killSwitchTopic = new aws.sns.Topic(`${name}-kill-switch-topic`, {}, { parent: this });

      new aws.sns.TopicPolicy(
        `${name}-kill-switch-topic-policy`,
        {
          arn: killSwitchTopic.arn,
          policy: killSwitchTopic.arn.apply((arn) =>
            JSON.stringify({
              Version: '2012-10-17',
              Statement: [
                {
                  Effect: 'Allow',
                  Principal: { Service: 'budgets.amazonaws.com' },
                  Action: 'sns:Publish',
                  Resource: arn,
                },
              ],
            }),
          ),
        },
        { parent: this },
      );

      // 2. Add the kill switch notification to the budget
      notifications.push({
        comparisonOperator: 'GREATER_THAN',
        threshold: Number(args.killSwitch.thresholdAmount),
        thresholdType: 'ABSOLUTE_VALUE',
        notificationType: 'ACTUAL',
        subscriberEmailAddresses: args.killSwitch.subscriberEmailAddresses,
        subscriberSnsTopicArns: [killSwitchTopic.arn],
      });

      // 3. Create Lambda IAM Role
      const killSwitchRole = new aws.iam.Role(
        `${name}-kill-switch-role`,
        {
          assumeRolePolicy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: { Service: 'lambda.amazonaws.com' },
                Action: 'sts:AssumeRole',
              },
            ],
          }),
        },
        { parent: this },
      );

      new aws.iam.RolePolicyAttachment(
        `${name}-kill-switch-basic-exec`,
        {
          role: killSwitchRole.name,
          policyArn: aws.iam.ManagedPolicy.AWSLambdaBasicExecutionRole,
        },
        { parent: this },
      );

      new aws.iam.RolePolicy(
        `${name}-kill-switch-policy`,
        {
          role: killSwitchRole.name,
          policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: [
                  'ec2:DescribeRegions',
                  'ec2:DescribeInstances',
                  'ec2:StopInstances',
                  'rds:DescribeDBInstances',
                  'rds:StopDBInstance',
                  'rds:DescribeDBClusters',
                  'rds:StopDBCluster',
                ],
                Resource: '*',
              },
            ],
          }),
        },
        { parent: this },
      );

      const killSwitchLambda = new aws.lambda.Function(
        `${name}-kill-switch-fn`,
        {
          role: killSwitchRole.arn,
          runtime: aws.lambda.Runtime.NodeJS18dX,
          handler: 'index.handler',
          code: new pulumi.asset.FileArchive(path.join(__dirname, '../lambda/kill-switch')),
          timeout: 120,
        },
        { parent: this },
      );

      // 5. Connect SNS to Lambda
      new aws.lambda.Permission(
        `${name}-kill-switch-invoke`,
        {
          action: 'lambda:InvokeFunction',
          function: killSwitchLambda.name,
          principal: 'sns.amazonaws.com',
          sourceArn: killSwitchTopic.arn,
        },
        { parent: this },
      );

      new aws.sns.TopicSubscription(
        `${name}-kill-switch-sub`,
        {
          topic: killSwitchTopic.arn,
          protocol: 'lambda',
          endpoint: killSwitchLambda.arn,
        },
        { parent: this },
      );
    }

    new aws.budgets.Budget(
      `${name}-monthly-budget`,
      {
        name: 'AccountBaselineMonthlyBudget',
        budgetType: 'COST',
        limitAmount: args.limitAmount,
        limitUnit: args.limitUnit,
        timeUnit: 'MONTHLY',
        notifications: notifications,
      },
      { parent: this },
    );

    this.registerOutputs({});
  }
}
