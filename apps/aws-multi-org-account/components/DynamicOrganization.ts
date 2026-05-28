import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import { OrganizationalUnitConfig } from '../configLoader';

export interface DynamicOrganizationArgs {
  organizationalUnits: OrganizationalUnitConfig[];
  existingOrgId?: string;
  existingRootId?: string;
  existingMasterAccountId?: string;
  existingOus?: { id: string; name: string }[];
  existingAccounts?: { id: string; name: string; email: string; status: string }[];
}

export class DynamicOrganization extends pulumi.ComponentResource {
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

    // 1. Get or Create the AWS Organization
    let orgId: pulumi.Output<string>;
    let orgMasterAccountId: pulumi.Output<string>;
    let rootId: pulumi.Output<string>;

    let mainOrg: aws.organizations.Organization | undefined;

    if (!args.existingOrgId) {
      mainOrg = new aws.organizations.Organization(
        'main-org',
        {
          featureSet: 'ALL',
          awsServiceAccessPrincipals: ['sso.amazonaws.com', 'iam.amazonaws.com'],
        },
        { parent: this },
      );
      orgId = mainOrg.id;
      orgMasterAccountId = mainOrg.masterAccountId;
      rootId = mainOrg.roots[0].id;
    } else {
      orgId = pulumi.output(args.existingOrgId);
      orgMasterAccountId = pulumi.output(args.existingMasterAccountId!);
      rootId = pulumi.output(args.existingRootId!);
    }

    this.organizationId = orgId;
    this.managementAccountId = orgMasterAccountId;

    // Add the management account to the account IDs map
    this.accountIds['Management'] = this.managementAccountId;

    let iamServiceAccess: aws.organizations.AwsServiceAccess | undefined;
    if (args.existingOrgId) {
      iamServiceAccess = new aws.organizations.AwsServiceAccess(
        'iam-service-access',
        {
          servicePrincipal: 'iam.amazonaws.com',
        },
        { parent: this },
      );
    }

    // 2. Enable Centralized Root Access Management
    new aws.iam.OrganizationsFeatures(
      'centralized-root-access',
      {
        enabledFeatures: ['RootCredentialsManagement', 'RootSessions'],
      },
      {
        parent: this,
        dependsOn: [...(mainOrg ? [mainOrg] : []), ...(iamServiceAccess ? [iamServiceAccess] : [])],
      }, // Need to make sure org exists and IAM access is enabled
    );
    for (const ouConfig of args.organizationalUnits) {
      let ouId: pulumi.Output<string>;

      const existingOu = args.existingOus?.find((o) => o.name === ouConfig.name);
      if (existingOu) {
        ouId = pulumi.output(existingOu.id);
      } else {
        const ou = new aws.organizations.OrganizationalUnit(
          `ou-${ouConfig.name}`,
          {
            parentId: rootId,
            name: ouConfig.name,
          },
          { parent: this },
        );
        ouId = ou.id;
      }

      this.ouIds[ouConfig.name] = ouId;
      this.ouAccountIds[ouConfig.name] = [];

      for (const accountConfig of ouConfig.accounts) {
        const existingAccount = args.existingAccounts?.find(
          (a) => a.name === accountConfig.name || a.email === accountConfig.email,
        );

        let accountId: pulumi.Output<string>;

        if (existingAccount && existingAccount.status === 'ACTIVE') {
          accountId = pulumi.output(existingAccount.id);
        } else {
          let name = accountConfig.name;
          let email = accountConfig.email;

          // If the account is suspended/closed, append a random string
          if (existingAccount && existingAccount.status !== 'ACTIVE') {
            const suffix = Math.random().toString(36).substring(2, 6);
            name = `${name}-${suffix}`;
            const [local, domain] = email.split('@');
            email = `${local}+${suffix}@${domain || 'example.com'}`;
          }

          const account = new aws.organizations.Account(
            `account-${name}`,
            {
              name: name,
              email: email,
              parentId: ouId,
              // IAM Identity Center handles access
            },
            { parent: this },
          );
          accountId = account.id;
        }

        this.accountIds[accountConfig.name] = accountId;
        this.ouAccountIds[ouConfig.name].push(accountId);
      }
    }

    this.registerOutputs({
      organizationId: this.organizationId,
      managementAccountId: this.managementAccountId,
      ouIds: this.ouIds,
      accountIds: this.accountIds,
      ouAccountIds: this.ouAccountIds,
    });
  }
}
