import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';

export default function getGroupAssumeRolePolicyDocument(roleArn: pulumi.Output<string>) {
  return aws.iam.getPolicyDocumentOutput({
    statements: [
      {
        actions: ['sts:AssumeRole'],
        resources: [roleArn],
      },
    ],
  });
}
