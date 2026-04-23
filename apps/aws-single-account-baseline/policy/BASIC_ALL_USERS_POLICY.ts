import * as aws from '@pulumi/aws';

export function getBasicAllUsersPolicyDocument() {
  return aws.iam.getPolicyDocumentOutput({
    statements: [
      {
        sid: 'AllowViewAccountInfo',
        actions: [
          'iam:GetAccountPasswordPolicy',
          'iam:GetAccountSummary',
          'iam:ListVirtualMFADevices',
        ],
        resources: ['*'], // Global IAM actions require *
      },
      {
        sid: 'AllowManageOwnPasswords',
        actions: ['iam:ChangePassword', 'iam:GetUser'],
        resources: ['arn:aws:iam::*:user/${aws:username}'],
      },
      {
        sid: 'AllowManageOwnAccessKeys',
        actions: [
          'iam:CreateAccessKey',
          'iam:DeleteAccessKey',
          'iam:ListAccessKeys',
          'iam:UpdateAccessKey',
        ],
        resources: ['arn:aws:iam::*:user/${aws:username}'],
      },
      {
        sid: 'AllowManageOwnVirtualMFADevice',
        actions: ['iam:CreateVirtualMFADevice', 'iam:DeleteVirtualMFADevice'],
        resources: ['arn:aws:iam::*:mfa/${aws:username}'],
      },
      {
        sid: 'AllowManageOwnUserMFA',
        actions: [
          'iam:DeactivateMFADevice',
          'iam:EnableMFADevice',
          'iam:ListMFADevices',
          'iam:ResyncMFADevice',
        ],
        resources: ['arn:aws:iam::*:user/${aws:username}'],
      },
      {
        sid: 'BlockMostAccessUnlessSignedInWithMFA',
        effect: 'Deny',
        notActions: [
          'iam:CreateVirtualMFADevice',
          'iam:EnableMFADevice',
          'iam:ListMFADevices',
          'iam:ListUsers',
          'iam:ListVirtualMFADevices',
          'iam:ResyncMFADevice',
          'sts:GetSessionToken',
          'iam:ChangePassword',
          'iam:GetUser',
          'iam:GetAccountPasswordPolicy',
        ],
        resources: ['*'],
        conditions: [
          {
            test: 'BoolIfExists',
            variable: 'aws:MultiFactorAuthPresent',
            values: ['false'],
          },
        ],
      },
    ],
  });
}
