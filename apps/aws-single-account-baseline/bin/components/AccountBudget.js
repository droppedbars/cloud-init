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
exports.AccountBudget = void 0;
const aws = __importStar(require("@pulumi/aws"));
const pulumi = __importStar(require("@pulumi/pulumi"));
const path = __importStar(require("path"));
class AccountBudget extends pulumi.ComponentResource {
    constructor(name, args, opts) {
        super('cloud-baseline:billing:AccountBudget', name, args, opts);
        const notifications = [
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
            new aws.sns.TopicPolicy(`${name}-kill-switch-topic-policy`, {
                arn: killSwitchTopic.arn,
                policy: killSwitchTopic.arn.apply((arn) => JSON.stringify({
                    Version: '2012-10-17',
                    Statement: [
                        {
                            Effect: 'Allow',
                            Principal: { Service: 'budgets.amazonaws.com' },
                            Action: 'sns:Publish',
                            Resource: arn,
                        },
                    ],
                })),
            }, { parent: this });
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
            const killSwitchRole = new aws.iam.Role(`${name}-kill-switch-role`, {
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
            }, { parent: this });
            new aws.iam.RolePolicyAttachment(`${name}-kill-switch-basic-exec`, {
                role: killSwitchRole.name,
                policyArn: aws.iam.ManagedPolicy.AWSLambdaBasicExecutionRole,
            }, { parent: this });
            new aws.iam.RolePolicy(`${name}-kill-switch-policy`, {
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
            }, { parent: this });
            const killSwitchLambda = new aws.lambda.Function(`${name}-kill-switch-fn`, {
                role: killSwitchRole.arn,
                runtime: aws.lambda.Runtime.NodeJS18dX,
                handler: 'index.handler',
                code: new pulumi.asset.FileArchive(path.join(__dirname, '../lambda/kill-switch')),
                timeout: 120,
            }, { parent: this });
            // 5. Connect SNS to Lambda
            new aws.lambda.Permission(`${name}-kill-switch-invoke`, {
                action: 'lambda:InvokeFunction',
                function: killSwitchLambda.name,
                principal: 'sns.amazonaws.com',
                sourceArn: killSwitchTopic.arn,
            }, { parent: this });
            new aws.sns.TopicSubscription(`${name}-kill-switch-sub`, {
                topic: killSwitchTopic.arn,
                protocol: 'lambda',
                endpoint: killSwitchLambda.arn,
            }, { parent: this });
        }
        new aws.budgets.Budget(`${name}-monthly-budget`, {
            name: 'AccountBaselineMonthlyBudget',
            budgetType: 'COST',
            limitAmount: args.limitAmount,
            limitUnit: args.limitUnit,
            timeUnit: 'MONTHLY',
            notifications: notifications,
        }, { parent: this });
        this.registerOutputs({});
    }
}
exports.AccountBudget = AccountBudget;
//# sourceMappingURL=AccountBudget.js.map