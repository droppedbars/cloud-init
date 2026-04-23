import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';

export interface DynamicRoleArgs {
  roleName: string;
  policyArns: pulumi.Input<string>[];
  permissionsBoundaryArn?: pulumi.Input<string>;
}

export class DynamicRole extends pulumi.ComponentResource {
  public readonly roleName: pulumi.Output<string>;
  public readonly roleArn: pulumi.Output<string>;

  constructor(name: string, args: DynamicRoleArgs, opts?: pulumi.ComponentResourceOptions) {
    super(`cloud-baseline:iam:DynamicRole:${args.roleName}`, name, args, opts);

    const currentCaller = aws.getCallerIdentityOutput({});

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
        },
      ],
    });

    const role = new aws.iam.Role(
      args.roleName,
      {
        name: args.roleName,
        assumeRolePolicy: roleAssumePolicy.json,
        permissionsBoundary: args.permissionsBoundaryArn,
      },
      { parent: this },
    );

    // 2. Attach policies to the role
    args.policyArns.forEach((policyArn, index) => {
      new aws.iam.RolePolicyAttachment(
        `${args.roleName}-policy-attachment-${index}`,
        {
          role: role.name,
          policyArn: policyArn,
        },
        { parent: this },
      );
    });

    this.roleName = role.name;
    this.roleArn = role.arn;

    this.registerOutputs({
      roleName: this.roleName,
      roleArn: this.roleArn,
    });
  }
}
