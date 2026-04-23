import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import { UserConfig } from '../configLoader';

export interface UserGroupMembershipsArgs {
  users: UserConfig[];
}

export class UserGroupMemberships extends pulumi.ComponentResource {
  constructor(
    name: string,
    args: UserGroupMembershipsArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('cloud-baseline:iam:UserGroupMemberships', name, args, opts);

    for (const userConfig of args.users) {
      if (userConfig.groups && userConfig.groups.length > 0) {
        new aws.iam.UserGroupMembership(
          `group-membership-${userConfig.name}`,
          {
            user: userConfig.name,
            groups: userConfig.groups,
          },
          { parent: this },
        );
      }
    }
  }
}
