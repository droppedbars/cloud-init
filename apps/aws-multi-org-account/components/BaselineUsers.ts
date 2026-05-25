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
  identityStoreId?: pulumi.Input<string>;
}

export class BaselineUsers extends pulumi.ComponentResource {
  public readonly initialPasswords: Record<string, pulumi.Output<string>> = {};
  public readonly userIds: Record<string, pulumi.Output<string>> = {};

  constructor(name: string, args: BaselineUsersArgs, opts?: pulumi.ComponentResourceOptions) {
    super('cloud-init:iam:BaselineUsers', name, args, opts);

    const protect = args.preserveOnDestroy ?? false;

    for (const userConfig of args.users) {
      if (userConfig.create) {
        if (!args.identityStoreId)
          throw new Error(
            'identityStoreId required for IdentityCenter strategy in BaselineUsers',
          );

        const user = new aws.identitystore.User(
          `admin-user-${userConfig.name}`,
          {
            identityStoreId: args.identityStoreId,
            userName: userConfig.name,
            displayName: userConfig.name,
            name: {
              givenName: userConfig.name,
              familyName: 'User',
            },
            emails: {
              value: userConfig.email || `${userConfig.name}@example.com`,
              primary: true,
            },
          },
          { parent: this, protect },
        );

        // Note: Identity Store users don't have programmable initial passwords via Pulumi,
        // they use the AWS portal to set up their credentials via email.
        this.initialPasswords[userConfig.name] = pulumi.output('Set via SSO Email');
        this.userIds[userConfig.name] = user.userId;
      }
    }

    this.registerOutputs({
      initialPasswords: this.initialPasswords,
      userIds: this.userIds,
    });
  }
}
