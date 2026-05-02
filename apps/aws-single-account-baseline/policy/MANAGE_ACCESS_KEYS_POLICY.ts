import * as aws from '@pulumi/aws';

/**
 * Grants the ability to create and update (activate/deactivate) access keys
 * scoped to the caller's own IAM user.
 *
 * Attach this policy to a role only when programmatic credential management is
 * explicitly required; by default, users are denied these actions through
 * BASIC_ALL_USERS_POLICY which intentionally omits iam:CreateAccessKey and
 * iam:UpdateAccessKey.
 */
export function getManageAccessKeysPolicyDocument() {
  return aws.iam.getPolicyDocumentOutput({
    statements: [
      {
        sid: 'AllowManageOwnAccessKeys',
        actions: ['iam:CreateAccessKey', 'iam:UpdateAccessKey'],
        resources: ['arn:aws:iam::*:user/${aws:username}'],
      },
    ],
  });
}
