import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import { UserConfig } from '../configLoader';

export interface UserGroupMembershipsArgs {
  users: UserConfig[];
  userIds: Record<string, pulumi.Output<string>>;
  groupIds: Record<string, pulumi.Output<string>>;
  identityStoreId?: pulumi.Input<string>;
}

export class UserGroupMemberships extends pulumi.ComponentResource {
  constructor(
    name: string,
    args: UserGroupMembershipsArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('cloud-init:iam:UserGroupMemberships', name, args, opts);

    for (const userConfig of args.users) {
      if (userConfig.groups && userConfig.groups.length > 0) {
        if (!args.identityStoreId)
          throw new Error(
            'identityStoreId required for IdentityCenter strategy in UserGroupMemberships',
          );

        for (const groupName of userConfig.groups) {
          new aws.identitystore.GroupMembership(
            `group-membership-${userConfig.name}-${groupName}`,
            {
              identityStoreId: args.identityStoreId,
              groupId: args.groupIds[groupName],
              memberId: args.userIds[userConfig.name],
            },
            { parent: this },
          );
        }
      }
    }
  }
}
