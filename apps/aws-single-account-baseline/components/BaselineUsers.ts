import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import { UserConfig } from '../configLoader';

export interface BaselineUsersArgs {
  users: UserConfig[];
  allowedRegions: string[];
  /**
   * When true, sets protect:true on IAM user resources so they survive a
   * pulumi destroy. Defaults to false.
   */
  preserveOnDestroy?: boolean;
}

export class BaselineUsers extends pulumi.ComponentResource {
  public readonly initialPasswords: Record<string, pulumi.Output<string>> = {};

  constructor(name: string, args: BaselineUsersArgs, opts?: pulumi.ComponentResourceOptions) {
    super('cloud-baseline:iam:BaselineUsers', name, args, opts);

    const protect = args.preserveOnDestroy ?? false;

    for (const userConfig of args.users) {
      if (userConfig.create) {
        const user = new aws.iam.User(
          `admin-user-${userConfig.name}`,
          {
            name: userConfig.name,
            forceDestroy: true,
          },
          { parent: this, protect },
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
