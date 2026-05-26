import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import { GroupAssignmentConfig } from '../configLoader';

export interface DynamicGroupArgs {
  groupName: string;
  roles: Record<string, pulumi.Output<string>>;
  assignments?: GroupAssignmentConfig[];
  accountIds?: Record<string, pulumi.Output<string>>;
  ouAccountIds?: Record<string, pulumi.Output<string>[]>;
  /** Policies attached to the group itself (available in every member's direct session). */
  sharedPolicyArns?: pulumi.Input<string>[];
  ssoInstanceArn?: pulumi.Input<string>;
  identityStoreId?: pulumi.Input<string>;
}

export class DynamicGroup extends pulumi.ComponentResource {
  public readonly groupName: pulumi.Output<string>;
  public readonly groupArn: pulumi.Output<string>;
  public readonly groupId: pulumi.Output<string>;

  constructor(name: string, args: DynamicGroupArgs, opts?: pulumi.ComponentResourceOptions) {
    super(`cloud-init:iam:DynamicGroup:${args.groupName}`, name, args, opts);

    if (!args.identityStoreId || !args.ssoInstanceArn)
      throw new Error(
        'identityStoreId and ssoInstanceArn required for IdentityCenter strategy in DynamicGroup',
      );

    const group = new aws.identitystore.Group(
      args.groupName,
      {
        identityStoreId: args.identityStoreId,
        displayName: args.groupName,
      },
      { parent: this },
    );

    if (args.assignments && args.accountIds && args.ouAccountIds) {
      args.assignments.forEach((assignment, assignmentIndex) => {
        const target = assignment.target;

        // Determine the list of account IDs this assignment applies to
        let targetAccountIds: pulumi.Output<string>[] = [];
        if (args.accountIds![target]) {
          targetAccountIds = [args.accountIds![target]];
        } else if (args.ouAccountIds![target]) {
          targetAccountIds = args.ouAccountIds![target];
        } else {
          // If the target doesn't match a managed account or OU, fallback to assuming it's a literal AWS Account ID string
          targetAccountIds = [pulumi.output(target)];
        }

        assignment.roles.forEach((roleName) => {
          const roleArn = args.roles[roleName];
          if (!roleArn) {
            throw new Error(
              `Role ${roleName} not found in provided roles mapping for group ${args.groupName}`,
            );
          }

          targetAccountIds.forEach((targetAccountId, targetIndex) => {
            new aws.ssoadmin.AccountAssignment(
              `${args.groupName}_${roleName}_ASSIGNMENT_${assignmentIndex}_${targetIndex}`,
              {
                instanceArn: args.ssoInstanceArn!,
                permissionSetArn: roleArn,
                principalId: group.groupId,
                principalType: 'GROUP',
                targetId: targetAccountId,
                targetType: 'AWS_ACCOUNT',
              },
              { parent: this },
            );
          });
        });
      });
    }

    // Note: sharedPolicyArns (e.g. self-service MFA) are ignored in IdentityCenter
    // because the AWS Access Portal natively handles MFA and portal login globally.

    this.groupName = group.displayName;
    // identitystore.Group does not have an ARN
    this.groupArn = pulumi.output('N/A in IdentityCenter');
    this.groupId = group.groupId;

    this.registerOutputs({
      groupName: this.groupName,
      groupArn: this.groupArn,
      groupId: this.groupId,
    });
  }
}
