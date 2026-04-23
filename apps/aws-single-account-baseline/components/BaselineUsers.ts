import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import { UserConfig } from '../configLoader';

export interface BaselineUsersArgs {
  users: UserConfig[];
  allowedRegions: string[];
}

export class BaselineUsers extends pulumi.ComponentResource {
  public readonly initialPasswords: Record<string, pulumi.Output<string>> = {};

  constructor(name: string, args: BaselineUsersArgs, opts?: pulumi.ComponentResourceOptions) {
    super('cloud-baseline:iam:BaselineUsers', name, args, opts);

    for (const userConfig of args.users) {
      if (userConfig.create) {
        const user = new aws.iam.User(
          `admin-user-${userConfig.name}`,
          {
            name: userConfig.name,
            forceDestroy: true,
          },
          { parent: this },
        );

        const loginProfile = new aws.iam.UserLoginProfile(
          `admin-login-profile-${userConfig.name}`,
          {
            user: user.name,
            passwordResetRequired: true,
          },
          { parent: this },
        );

        this.initialPasswords[userConfig.name] = loginProfile.password;
      }
    }

    this.registerOutputs({
      initialPasswords: this.initialPasswords,
    });
  }
}
