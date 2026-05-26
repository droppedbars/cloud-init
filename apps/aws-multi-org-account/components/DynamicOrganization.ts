import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import { OrganizationalUnitConfig } from '../configLoader';

export interface DynamicOrganizationArgs {
  organizationalUnits: OrganizationalUnitConfig[];
}

export class DynamicOrganization extends pulumi.ComponentResource {
  public readonly organizationArn: pulumi.Output<string>;
  public readonly organizationId: pulumi.Output<string>;
  public readonly managementAccountId: pulumi.Output<string>;

  // Maps OU name to its ID
  public readonly ouIds: Record<string, pulumi.Output<string>> = {};
  // Maps account name to its ID
  public readonly accountIds: Record<string, pulumi.Output<string>> = {};
  // Maps OU name to an array of account IDs in that OU
  public readonly ouAccountIds: Record<string, pulumi.Output<string>[]> = {};

  constructor(name: string, args: DynamicOrganizationArgs, opts?: pulumi.ComponentResourceOptions) {
    super('cloud-init:iam:DynamicOrganization', name, args, opts);

    // 1. Create the AWS Organization
    const org = new aws.organizations.Organization(
      'main-org',
      {
        featureSet: 'ALL',
        awsServiceAccessPrincipals: ['sso.amazonaws.com'],
      },
      { parent: this },
    );

    this.organizationArn = org.arn;
    this.organizationId = org.id;
    this.managementAccountId = org.masterAccountId;

    // Add the management account to the account IDs map
    this.accountIds['Management'] = this.managementAccountId;

    // 2. Provision OUs and Accounts
    for (const ouConfig of args.organizationalUnits) {
      const ou = new aws.organizations.OrganizationalUnit(
        `ou-${ouConfig.name}`,
        {
          parentId: org.roots[0].id,
          name: ouConfig.name,
        },
        { parent: this },
      );

      this.ouIds[ouConfig.name] = ou.id;
      this.ouAccountIds[ouConfig.name] = [];

      for (const accountConfig of ouConfig.accounts) {
        const account = new aws.organizations.Account(
          `account-${accountConfig.name}`,
          {
            name: accountConfig.name,
            email: accountConfig.email,
            parentId: ou.id,
            // IAM Identity Center handles access, but you could optionally set iamUserAccessToBilling
            // or an administrative role name.
          },
          { parent: this },
        );

        this.accountIds[accountConfig.name] = account.id;
        this.ouAccountIds[ouConfig.name].push(account.id);
      }
    }

    this.registerOutputs({
      organizationArn: this.organizationArn,
      organizationId: this.organizationId,
      managementAccountId: this.managementAccountId,
      ouIds: this.ouIds,
      accountIds: this.accountIds,
      ouAccountIds: this.ouAccountIds,
    });
  }
}
