import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

export interface SecurityAlertingArgs {
  /** Fire an alert whenever any IAM user creates an access key. */
  notifyOnAccessKeyCreation: boolean;
  /** Fire an alert whenever any user signs into the AWS Console. */
  notifyOnConsoleLogin: boolean;
  /** Email addresses that will receive SNS notifications. */
  subscriberEmailAddresses: string[];
}

export interface SecurityAlertingOutputs {
  topicArn: pulumi.Output<string>;
}

/**
 * Provisions SNS-based alerting for security-sensitive IAM events.
 *
 * ALL resources are provisioned in us-east-1 regardless of the stack's
 * default region. This is intentional:
 *
 *   - IAM is a global service. CloudTrail natively captures IAM events
 *     (CreateAccessKey, etc.) in us-east-1 without forwarding.
 *   - Console sign-in events (aws.signin) are only delivered to EventBridge
 *     in us-east-1.
 *   - CloudWatch Alarms must be in the same region as their SNS target.
 *
 * Placing everything in us-east-1 keeps the pipeline co-located and avoids
 * the cross-region forwarding issues that affect single-region trails.
 *
 * Access key creation path:
 *   CloudTrail (us-east-1) → CloudWatch Logs → Metric Filter → Alarm → SNS
 *
 * Console login path:
 *   EventBridge (us-east-1, aws.signin) → SNS
 *
 * CloudTrail management events are free for the first trail per region;
 * S3 and CloudWatch Logs storage are the only cost drivers.
 */
export class SecurityAlerting extends pulumi.ComponentResource {
  public readonly topicArn: pulumi.Output<string>;

  constructor(name: string, args: SecurityAlertingArgs, opts?: pulumi.ComponentResourceOptions) {
    super('cloud-baseline:security:SecurityAlerting', name, {}, opts);

    // S3 log storage uses the stack's default region (e.g. ca-west-1) for data residency.
    // All other alerting resources (CloudTrail, CWL, Alarm, SNS) use us-east-1 so that IAM
    // global-service events and aws.signin events are captured without cross-region forwarding.
    // CloudWatch Alarms must be co-located with SNS, so both live in us-east-1.
    const defaultOpts: pulumi.CustomResourceOptions = { parent: this };

    const usEast1Provider = new aws.Provider(
      `${name}-us-east-1-provider`,
      { region: 'us-east-1' },
      { parent: this },
    );

    const regionalOpts: pulumi.CustomResourceOptions = { parent: this, provider: usEast1Provider };
    const identity = aws.getCallerIdentityOutput({}, { provider: usEast1Provider });

    // ── SNS Topic ─────────────────────────────────────────────────────────────
    const topic = new aws.sns.Topic(
      `${name}-topic`,
      { displayName: 'AWS Security Alerts' },
      regionalOpts,
    );

    args.subscriberEmailAddresses.forEach((email, i) => {
      new aws.sns.TopicSubscription(
        `${name}-subscription-${i}`,
        { topic: topic.arn, protocol: 'email', endpoint: email },
        regionalOpts,
      );
    });

    // Allow EventBridge (console login) and CloudWatch Alarms (access key) to publish.
    new aws.sns.TopicPolicy(
      `${name}-topic-policy`,
      {
        arn: topic.arn,
        policy: pulumi.all([topic.arn, identity.accountId]).apply(([arn, accountId]) =>
          JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                // Replaces the default SNS policy that our custom policy overwrites.
                // sns:* is invalid in SNS resource policies — actions must be explicit.
                Sid: 'AllowTopicOwnerManage',
                Effect: 'Allow',
                Principal: { AWS: `arn:aws:iam::${accountId}:root` },
                Action: [
                  'sns:AddPermission',
                  'sns:DeleteTopic',
                  'sns:GetTopicAttributes',
                  'sns:ListSubscriptionsByTopic',
                  'sns:Publish',
                  'sns:RemovePermission',
                  'sns:SetTopicAttributes',
                  'sns:Subscribe',
                ],
                Resource: arn,
              },
              {
                Sid: 'AllowEventBridgePublish',
                Effect: 'Allow',
                Principal: { Service: 'events.amazonaws.com' },
                Action: 'sns:Publish',
                Resource: arn,
                Condition: { StringEquals: { 'aws:SourceAccount': accountId } },
              },
              {
                Sid: 'AllowCloudWatchAlarmsPublish',
                Effect: 'Allow',
                Principal: { Service: 'cloudwatch.amazonaws.com' },
                Action: 'sns:Publish',
                Resource: arn,
                Condition: { StringEquals: { 'aws:SourceAccount': accountId } },
              },
            ],
          }),
        ),
      },
      regionalOpts,
    );

    // ── Access Key Creation: CloudTrail → CloudWatch Logs → Alarm → SNS ───────
    if (args.notifyOnAccessKeyCreation) {
      // S3 bucket stays in the stack's default region for data residency.
      // CloudTrail supports writing log files to S3 buckets in any region.
      const trailBucket = new aws.s3.Bucket(
        `${name}-trail-bucket`,
        { forceDestroy: true },
        defaultOpts,
      );

      const bucketPab = new aws.s3.BucketPublicAccessBlock(
        `${name}-trail-bucket-pab`,
        {
          bucket: trailBucket.id,
          blockPublicAcls: true,
          blockPublicPolicy: true,
          ignorePublicAcls: true,
          restrictPublicBuckets: true,
        },
        defaultOpts,
      );

      // NOTE: trailBucket.id creates a Pulumi dependency on the bucket itself, but NOT
      // on the bucket policy. CloudTrail validates the policy at trail-creation time, so
      // the trail must explicitly wait for the policy to be fully applied first.
      const bucketPolicy = new aws.s3.BucketPolicy(
        `${name}-trail-bucket-policy`,
        {
          bucket: trailBucket.id,
          policy: pulumi
            .all([trailBucket.arn, identity.accountId])
            .apply(([bucketArn, accountId]) =>
              JSON.stringify({
                Version: '2012-10-17',
                Statement: [
                  {
                    Sid: 'AWSCloudTrailAclCheck',
                    Effect: 'Allow',
                    Principal: { Service: 'cloudtrail.amazonaws.com' },
                    Action: 's3:GetBucketAcl',
                    // No condition — CloudTrail calls GetBucketAcl during trail-creation
                    // validation without condition context keys populated.
                    Resource: bucketArn,
                  },
                  {
                    Sid: 'AWSCloudTrailWrite',
                    Effect: 'Allow',
                    Principal: { Service: 'cloudtrail.amazonaws.com' },
                    Action: 's3:PutObject',
                    Resource: `${bucketArn}/AWSLogs/${accountId}/*`,
                    Condition: {
                      StringEquals: { 's3:x-amz-acl': 'bucket-owner-full-control' },
                    },
                  },
                ],
              }),
            ),
        },
        { ...defaultOpts, dependsOn: [bucketPab] },
      );

      // CloudWatch Logs receives CloudTrail events in real-time.
      const logGroup = new aws.cloudwatch.LogGroup(
        `${name}-trail-logs`,
        { retentionInDays: 90 },
        regionalOpts,
      );

      // IAM role that allows CloudTrail to write log events to this log group.
      const cwlRole = new aws.iam.Role(
        `${name}-trail-cwl-role`,
        {
          assumeRolePolicy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: { Service: 'cloudtrail.amazonaws.com' },
                Action: 'sts:AssumeRole',
              },
            ],
          }),
        },
        regionalOpts,
      );

      const cwlRolePolicy = new aws.iam.RolePolicy(
        `${name}-trail-cwl-role-policy`,
        {
          role: cwlRole.id,
          policy: logGroup.arn.apply((arn) =>
            JSON.stringify({
              Version: '2012-10-17',
              Statement: [
                {
                  Effect: 'Allow',
                  Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
                  Resource: `${arn}:*`,
                },
              ],
            }),
          ),
        },
        regionalOpts,
      );

      new aws.cloudtrail.Trail(
        `${name}-trail`,
        {
          s3BucketName: trailBucket.id,
          cloudWatchLogsGroupArn: logGroup.arn.apply((arn) => `${arn}:*`),
          cloudWatchLogsRoleArn: cwlRole.arn,
          // us-east-1 natively captures IAM global service events — no forwarding needed.
          includeGlobalServiceEvents: true,
          isMultiRegionTrail: true,
          enableLogFileValidation: true,
          eventSelectors: [{ readWriteType: 'WriteOnly', includeManagementEvents: true }],
        },
        // Must wait for BOTH the bucket policy and the CWL role policy.
        // The role policy is an inline resource — referencing cwlRole.arn only ensures
        // the role itself exists, not that its permissions have been attached.
        { ...regionalOpts, dependsOn: [bucketPolicy, cwlRolePolicy] },
      );

      new aws.cloudwatch.LogMetricFilter(
        `${name}-access-key-metric-filter`,
        {
          logGroupName: logGroup.name,
          pattern: '{ $.eventName = "CreateAccessKey" }',
          metricTransformation: {
            name: 'AccessKeyCreationCount',
            namespace: 'CloudBaselineSecurityAlerting',
            value: '1',
            defaultValue: '0',
          },
        },
        regionalOpts,
      );

      new aws.cloudwatch.MetricAlarm(
        `${name}-access-key-alarm`,
        {
          comparisonOperator: 'GreaterThanOrEqualToThreshold',
          evaluationPeriods: 1,
          metricName: 'AccessKeyCreationCount',
          namespace: 'CloudBaselineSecurityAlerting',
          period: 300,
          statistic: 'Sum',
          threshold: 1,
          treatMissingData: 'notBreaching',
          alarmDescription: 'Fires when any IAM user creates an access key',
          alarmActions: [topic.arn],
        },
        regionalOpts,
      );
    }

    // ── Console Login: EventBridge (us-east-1) → SNS ──────────────────────────
    // aws.signin events are only delivered to EventBridge in us-east-1,
    // which is why we keep everything in the same region.
    if (args.notifyOnConsoleLogin) {
      const rule = new aws.cloudwatch.EventRule(
        `${name}-console-login`,
        {
          description: 'Alert when any user signs into the AWS Console',
          eventPattern: JSON.stringify({
            source: ['aws.signin'],
            'detail-type': ['AWS Console Sign In via CloudTrail'],
          }),
        },
        regionalOpts,
      );

      new aws.cloudwatch.EventTarget(
        `${name}-console-login-target`,
        { rule: rule.name, arn: topic.arn },
        regionalOpts,
      );
    }

    this.topicArn = topic.arn;
    this.registerOutputs({ topicArn: this.topicArn });
  }
}
