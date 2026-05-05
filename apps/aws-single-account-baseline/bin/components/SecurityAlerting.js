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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecurityAlerting = void 0;
const aws = __importStar(require("@pulumi/aws"));
const pulumi = __importStar(require("@pulumi/pulumi"));
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
class SecurityAlerting extends pulumi.ComponentResource {
    constructor(name, args, opts) {
        var _a;
        super('cloud-baseline:security:SecurityAlerting', name, {}, opts);
        // S3 log storage uses the stack's default region (e.g. ca-west-1) for data residency.
        // All other alerting resources (CloudTrail, CWL, Alarm, SNS) use us-east-1 so that IAM
        // global-service events and aws.signin events are captured without cross-region forwarding.
        // CloudWatch Alarms must be co-located with SNS, so both live in us-east-1.
        const defaultOpts = { parent: this };
        const usEast1Provider = new aws.Provider(`${name}-us-east-1-provider`, { region: 'us-east-1' }, { parent: this });
        const protect = (_a = args.preserveOnDestroy) !== null && _a !== void 0 ? _a : false;
        const regionalOpts = { parent: this, provider: usEast1Provider };
        // durableOpts applies protect to resources that hold audit history or send alerts.
        const durableOpts = Object.assign(Object.assign({}, regionalOpts), { protect });
        const durableDefaultOpts = Object.assign(Object.assign({}, defaultOpts), { protect });
        const identity = aws.getCallerIdentityOutput({}, { provider: usEast1Provider });
        // ── SNS Topic ─────────────────────────────────────────────────────────────
        const topic = new aws.sns.Topic(`${name}-topic`, { displayName: 'AWS Security Alerts' }, durableOpts);
        args.subscriberEmailAddresses.forEach((email, i) => {
            new aws.sns.TopicSubscription(`${name}-subscription-${i}`, { topic: topic.arn, protocol: 'email', endpoint: email }, regionalOpts);
        });
        // Allow EventBridge (console login) and CloudWatch Alarms (access key) to publish.
        new aws.sns.TopicPolicy(`${name}-topic-policy`, {
            arn: topic.arn,
            policy: pulumi.all([topic.arn, identity.accountId]).apply(([arn, accountId]) => JSON.stringify({
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
            })),
        }, regionalOpts);
        // ── Access Key Creation: CloudTrail → CloudWatch Logs → Alarm → SNS ───────
        if (args.notifyOnAccessKeyCreation) {
            // S3 bucket stays in the stack's default region for data residency.
            // CloudTrail supports writing log files to S3 buckets in any region.
            const trailBucket = new aws.s3.Bucket(`${name}-trail-bucket`, { forceDestroy: true }, durableDefaultOpts);
            const bucketPab = new aws.s3.BucketPublicAccessBlock(`${name}-trail-bucket-pab`, {
                bucket: trailBucket.id,
                blockPublicAcls: true,
                blockPublicPolicy: true,
                ignorePublicAcls: true,
                restrictPublicBuckets: true,
            }, defaultOpts);
            // NOTE: trailBucket.id creates a Pulumi dependency on the bucket itself, but NOT
            // on the bucket policy. CloudTrail validates the policy at trail-creation time, so
            // the trail must explicitly wait for the policy to be fully applied first.
            const bucketPolicy = new aws.s3.BucketPolicy(`${name}-trail-bucket-policy`, {
                bucket: trailBucket.id,
                policy: pulumi
                    .all([trailBucket.arn, identity.accountId])
                    .apply(([bucketArn, accountId]) => JSON.stringify({
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
                        {
                            Sid: 'DenyInsecureTransport',
                            Effect: 'Deny',
                            Principal: '*',
                            Action: 's3:*',
                            Resource: [`${bucketArn}`, `${bucketArn}/*`],
                            Condition: {
                                Bool: { 'aws:SecureTransport': 'false' },
                            },
                        },
                    ],
                })),
            }, Object.assign(Object.assign({}, defaultOpts), { dependsOn: [bucketPab] }));
            // CloudWatch Logs receives CloudTrail events in real-time.
            const logGroup = new aws.cloudwatch.LogGroup(`${name}-trail-logs`, { retentionInDays: 90 }, durableOpts);
            // IAM role that allows CloudTrail to write log events to this log group.
            const cwlRole = new aws.iam.Role(`${name}-trail-cwl-role`, {
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
            }, regionalOpts);
            const cwlRolePolicy = new aws.iam.RolePolicy(`${name}-trail-cwl-role-policy`, {
                role: cwlRole.id,
                policy: logGroup.arn.apply((arn) => JSON.stringify({
                    Version: '2012-10-17',
                    Statement: [
                        {
                            Effect: 'Allow',
                            Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
                            Resource: `${arn}:*`,
                        },
                    ],
                })),
            }, regionalOpts);
            new aws.cloudtrail.Trail(`${name}-trail`, {
                s3BucketName: trailBucket.id,
                cloudWatchLogsGroupArn: logGroup.arn.apply((arn) => `${arn}:*`),
                cloudWatchLogsRoleArn: cwlRole.arn,
                // us-east-1 natively captures IAM global service events — no forwarding needed.
                includeGlobalServiceEvents: true,
                isMultiRegionTrail: true,
                enableLogFileValidation: true,
                eventSelectors: [{ readWriteType: 'All', includeManagementEvents: true }],
            }, Object.assign(Object.assign({}, durableOpts), { dependsOn: [bucketPolicy, cwlRolePolicy] }));
            new aws.cloudwatch.LogMetricFilter(`${name}-access-key-metric-filter`, {
                logGroupName: logGroup.name,
                pattern: '{ $.eventName = "CreateAccessKey" }',
                metricTransformation: {
                    name: 'AccessKeyCreationCount',
                    namespace: 'CloudBaselineSecurityAlerting',
                    value: '1',
                    defaultValue: '0',
                },
            }, regionalOpts);
            new aws.cloudwatch.MetricAlarm(`${name}-access-key-alarm`, {
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
            }, regionalOpts);
        }
        // ── Console Login: EventBridge (us-east-1) → SNS ──────────────────────────
        // aws.signin events are only delivered to EventBridge in us-east-1,
        // which is why we keep everything in the same region.
        if (args.notifyOnConsoleLogin) {
            const rule = new aws.cloudwatch.EventRule(`${name}-console-login`, {
                description: 'Alert when any user signs into the AWS Console',
                eventPattern: JSON.stringify({
                    source: ['aws.signin'],
                    'detail-type': ['AWS Console Sign In via CloudTrail'],
                }),
            }, regionalOpts);
            new aws.cloudwatch.EventTarget(`${name}-console-login-target`, { rule: rule.name, arn: topic.arn }, regionalOpts);
        }
        this.topicArn = topic.arn;
        this.registerOutputs({ topicArn: this.topicArn });
    }
}
exports.SecurityAlerting = SecurityAlerting;
//# sourceMappingURL=SecurityAlerting.js.map