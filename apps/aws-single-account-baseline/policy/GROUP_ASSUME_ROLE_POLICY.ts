import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';

export function getGroupAssumeRolePolicyDocument(roleArn: pulumi.Output<string>) {
  return aws.iam.getPolicyDocumentOutput({
    statements: [
      {
        actions: ['sts:AssumeRole'],
        resources: [roleArn],
      },
    ],
  });
}
