import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import { getGroupAssumeRolePolicyDocument } from '../policy/GROUP_ASSUME_ROLE_POLICY';

export interface DynamicGroupArgs {
  groupName: string;
  roles: Record<string, pulumi.Output<string>>;
  /** Policies attached to the group itself (available in every member's direct session). */
  sharedPolicyArns?: pulumi.Input<string>[];
  identityStrategy: 'Traditional' | 'IdentityCenter';
  ssoInstanceArn?: pulumi.Input<string>;
  identityStoreId?: pulumi.Input<string>;
}

export class DynamicGroup extends pulumi.ComponentResource {
  public readonly groupName: pulumi.Output<string>;
  public readonly groupArn: pulumi.Output<string>;
  public readonly groupId: pulumi.Output<string>;

  constructor(name: string, args: DynamicGroupArgs, opts?: pulumi.ComponentResourceOptions) {
    super(`cloud-baseline:iam:DynamicGroup:${args.groupName}`, name, args, opts);

    if (args.identityStrategy === 'IdentityCenter') {
      if (!args.identityStoreId || !args.ssoInstanceArn)
        throw new Error(
          'identityStoreId and ssoInstanceArn required for IdentityCenter strategy in DynamicGroup',
        );

      const currentCaller = aws.getCallerIdentityOutput({});

      const group = new aws.identitystore.Group(
        args.groupName,
        {
          identityStoreId: args.identityStoreId,
          displayName: args.groupName,
        },
        { parent: this },
      );

      Object.entries(args.roles).forEach(([roleName, roleArn]) => {
        new aws.ssoadmin.AccountAssignment(
          `${args.groupName}_${roleName}_ASSIGNMENT`,
          {
            instanceArn: args.ssoInstanceArn!,
            permissionSetArn: roleArn,
            principalId: group.groupId,
            principalType: 'GROUP',
            targetId: currentCaller.accountId,
            targetType: 'AWS_ACCOUNT',
          },
          { parent: this },
        );
      });

      // Note: sharedPolicyArns (e.g. self-service MFA) are ignored in IdentityCenter
      // because the AWS Access Portal natively handles MFA and portal login globally.

      this.groupName = group.displayName;
      // identitystore.Group does not have an ARN
      this.groupArn = pulumi.output('N/A in IdentityCenter');
      this.groupId = group.groupId;
    } else {
      const group = new aws.iam.Group(
        args.groupName,
        {
          name: args.groupName,
        },
        { parent: this },
      );

      // Create Assume Role Policies for each role this group is permitted to assume
      Object.entries(args.roles).forEach(([roleName, roleArn]) => {
        const groupAssumeRolePolicyDoc = getGroupAssumeRolePolicyDocument(roleArn);

        const assumePolicyName = `${args.groupName}_ASSUME_${roleName}_POLICY`;
        const groupAssumeRolePolicy = new aws.iam.Policy(
          assumePolicyName,
          {
            name: assumePolicyName,
            policy: groupAssumeRolePolicyDoc.json,
          },
          { parent: this },
        );

        new aws.iam.GroupPolicyAttachment(
          `${args.groupName}_${roleName}_ATTACHMENT`,
          {
            group: group.name,
            policyArn: groupAssumeRolePolicy.arn,
          },
          { parent: this },
        );
      });

      // Attach shared baseline policies (e.g. self-service MFA) directly to the group
      // so members have these permissions in their direct session before assuming a role.
      (args.sharedPolicyArns ?? []).forEach((policyArn, i) => {
        new aws.iam.GroupPolicyAttachment(
          `${args.groupName}-shared-policy-${i}`,
          { group: group.name, policyArn },
          { parent: this },
        );
      });

      this.groupName = group.name;
      this.groupArn = group.arn;
      this.groupId = pulumi.output(group.name);
    }

    this.registerOutputs({
      groupName: this.groupName,
      groupArn: this.groupArn,
      groupId: this.groupId,
    });
  }
}
