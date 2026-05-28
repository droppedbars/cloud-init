import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import { GroupAssignmentConfig } from '../configLoader';

export interface DynamicGroupArgs {
  groupName: string;
  adminPermissionSetArn: pulumi.Output<string>;
  assignments?: GroupAssignmentConfig[];
  accountIds?: Record<string, pulumi.Output<string>>;
  ouAccountIds?: Record<string, pulumi.Output<string>[]>;

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

    // Artificial delay to allow the newly created Group to propagate across AWS Identity Store
    // and SSO Admin's internal databases. Assigning a group immediately after creation
    // often causes the AccountAssignment API to lock up in an IN_PROGRESS state.
    const delayedGroupId = pulumi.output(group.groupId).apply(async (id) => {
      pulumi.log.info(
        `Waiting 60 seconds for Group '${args.groupName}' to propagate in Identity Store...`,
      );
      // eslint-disable-next-line no-undef
      await new Promise((resolve) => setTimeout(resolve, 60000));
      return id;
    });

    if (args.assignments && args.accountIds && args.ouAccountIds) {
      let previousAssignment: aws.ssoadmin.AccountAssignment | undefined = undefined;

      args.assignments.forEach((assignment, assignmentIndex) => {
        const target = assignment.target;

        // Determine the list of account IDs this assignment applies to
        let targetAccountIds: pulumi.Output<string>[];
        if (args.accountIds![target]) {
          targetAccountIds = [args.accountIds![target]];
        } else if (args.ouAccountIds![target]) {
          targetAccountIds = args.ouAccountIds![target];
        } else {
          // If the target doesn't match a managed account or OU, fallback to assuming it's a literal AWS Account ID string
          targetAccountIds = [pulumi.output(target)];
        }

        targetAccountIds.forEach((targetAccountId, targetIndex) => {
          pulumi
            .all([targetAccountId, args.adminPermissionSetArn, delayedGroupId])
            .apply(([acctId, _pArn, gId]) => {
              pulumi.log.info(
                `Queueing Account Assignment: Group '${args.groupName}' (${gId}) -> Target Account '${acctId}'`,
              );
            });

          const currentAssignment = new aws.ssoadmin.AccountAssignment(
            `${args.groupName}_ADMIN_ASSIGNMENT_${assignmentIndex}_${targetIndex}`,
            {
              instanceArn: args.ssoInstanceArn!,
              permissionSetArn: args.adminPermissionSetArn,
              principalId: delayedGroupId,
              principalType: 'GROUP',
              targetId: targetAccountId,
              targetType: 'AWS_ACCOUNT',
            },
            {
              parent: this,
              dependsOn: previousAssignment ? [previousAssignment] : [],
            },
          );
          previousAssignment = currentAssignment;
        });
      });
    }

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
