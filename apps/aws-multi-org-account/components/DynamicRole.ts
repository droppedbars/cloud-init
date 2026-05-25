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
  ssoInstanceArn?: pulumi.Input<string>;
}

export class DynamicRole extends pulumi.ComponentResource {
  public readonly roleName: pulumi.Output<string>;
  public readonly roleArn: pulumi.Output<string>;

  constructor(name: string, args: DynamicRoleArgs, opts?: pulumi.ComponentResourceOptions) {
    super(`cloud-init:iam:DynamicRole:${args.roleName}`, name, args, opts);

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

    this.registerOutputs({
      roleName: this.roleName,
      roleArn: this.roleArn,
    });
  }
}
