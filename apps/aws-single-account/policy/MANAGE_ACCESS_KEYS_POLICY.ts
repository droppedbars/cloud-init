import * as aws from '@pulumi/aws';

/**
 * Grants the ability to manage access keys (create, list, delete, update,
 * and view last used date) scoped to the caller's own IAM user.
 *
 * Attach this policy to a group only when programmatic credential management is
 * explicitly required.
 */
export default function getManageAccessKeysPolicyDocument() {
  return aws.iam.getPolicyDocumentOutput({
    statements: [
      {
        sid: 'AllowManageOwnAccessKeys',
        actions: [
          'iam:CreateAccessKey',
          'iam:UpdateAccessKey',
          'iam:DeleteAccessKey',
          'iam:ListAccessKeys',
          'iam:GetAccessKeyLastUsed',
        ],
        resources: ['arn:aws:iam::*:user/${aws:username}'],
      },
    ],
  });
}
