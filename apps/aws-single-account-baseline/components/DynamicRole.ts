import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';

export interface PolicyReference {
  name: string;
  arn: pulumi.Input<string>;
  isManaged: boolean;
}

export interface DynamicRoleArgs {
  roleName: string;
  policyRefs: PolicyReference[];
  permissionsBoundaryRef?: PolicyReference;
  identityStrategy: 'Traditional' | 'IdentityCenter';
  ssoInstanceArn?: pulumi.Input<string>;
}

export class DynamicRole extends pulumi.ComponentResource {
  public readonly roleName: pulumi.Output<string>;
  public readonly roleArn: pulumi.Output<string>;

  constructor(name: string, args: DynamicRoleArgs, opts?: pulumi.ComponentResourceOptions) {
    super(`cloud-init:iam:DynamicRole:${args.roleName}`, name, args, opts);

    const currentCaller = aws.getCallerIdentityOutput({});

    if (args.identityStrategy === 'IdentityCenter') {
      if (!args.ssoInstanceArn)
        throw new Error(
          `ssoInstanceArn must be provided for IdentityCenter strategy in DynamicRole ${args.roleName}`,
        );

      const permissionSet = new aws.ssoadmin.PermissionSet(
        args.roleName,
        {
          name: args.roleName,
          instanceArn: args.ssoInstanceArn,
        },
        { parent: this },
      );

      if (args.permissionsBoundaryRef) {
        new aws.ssoadmin.PermissionsBoundaryAttachment(
          `${args.roleName}-boundary-attachment`,
          {
            instanceArn: args.ssoInstanceArn,
            permissionSetArn: permissionSet.arn,
            permissionsBoundary: {
              customerManagedPolicyReference: args.permissionsBoundaryRef.isManaged
                ? undefined
                : {
                  name: args.permissionsBoundaryRef.name,
                },
              managedPolicyArn: args.permissionsBoundaryRef.isManaged
                ? args.permissionsBoundaryRef.arn
                : undefined,
            },
          },
          { parent: this, deleteBeforeReplace: true },
        );
      }

      args.policyRefs.forEach((policyRef, index) => {
        if (policyRef.isManaged) {
          new aws.ssoadmin.ManagedPolicyAttachment(
            `${args.roleName}-policy-attachment-${index}`,
            {
              instanceArn: args.ssoInstanceArn!,
              permissionSetArn: permissionSet.arn,
              managedPolicyArn: policyRef.arn,
            },
            { parent: this, deleteBeforeReplace: true },
          );
        } else {
          new aws.ssoadmin.CustomerManagedPolicyAttachment(
            `${args.roleName}-policy-attachment-${index}`,
            {
              instanceArn: args.ssoInstanceArn!,
              permissionSetArn: permissionSet.arn,
              customerManagedPolicyReference: {
                name: policyRef.name,
              },
            },
            { parent: this, deleteBeforeReplace: true },
          );
        }
      });

      this.roleName = permissionSet.name;
      this.roleArn = permissionSet.arn;
    } else {
      // 1. Create the matching role
      const roleAssumePolicy = aws.iam.getPolicyDocumentOutput({
        statements: [
          {
            actions: ['sts:AssumeRole'],
            principals: [
              {
                type: 'AWS',
                identifiers: [pulumi.interpolate`arn:aws:iam::${currentCaller.accountId}:root`],
              },
            ],
            conditions: [
              {
                test: 'Bool',
                variable: 'aws:MultiFactorAuthPresent',
                values: ['true'],
              },
            ],
          },
        ],
      });

      const role = new aws.iam.Role(
        args.roleName,
        {
          name: args.roleName,
          assumeRolePolicy: roleAssumePolicy.json,
          permissionsBoundary: args.permissionsBoundaryRef?.arn,
        },
        { parent: this },
      );

      // 2. Attach policies to the role
      args.policyRefs.forEach((policyRef, index) => {
        new aws.iam.RolePolicyAttachment(
          `${args.roleName}-policy-attachment-${index}`,
          {
            role: role.name,
            policyArn: policyRef.arn,
          },
          { parent: this },
        );
      });

      this.roleName = role.name;
      this.roleArn = role.arn;
    }

    this.registerOutputs({
      roleName: this.roleName,
      roleArn: this.roleArn,
    });
  }
}
