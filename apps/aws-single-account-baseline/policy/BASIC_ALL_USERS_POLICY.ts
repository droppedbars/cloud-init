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
        actions: [
          'iam:ChangePassword',
          'iam:GetLoginProfile',
          'iam:GetUser',
          'iam:UpdateLoginProfile',
        ],
        resources: ['arn:aws:iam::*:user/${aws:username}'],
      },
      {
        sid: 'AllowViewOwnAccessKeys',
        actions: ['iam:DeleteAccessKey', 'iam:ListAccessKeys'],
        resources: ['arn:aws:iam::*:user/${aws:username}'],
      },
      {
        sid: 'AllowManageOwnVirtualMFADevice',
        actions: ['iam:CreateVirtualMFADevice', 'iam:DeleteVirtualMFADevice'],
        resources: ['arn:aws:iam::*:mfa/*'],
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
          'iam:ChangePassword',
          'iam:CreateVirtualMFADevice',
          'iam:DeactivateMFADevice',
          'iam:EnableMFADevice',
          'iam:GetAccountPasswordPolicy',
          'iam:GetLoginProfile',
          'iam:GetUser',
          'iam:ListMFADevices',
          'iam:ListUsers',
          'iam:ListVirtualMFADevices',
          'iam:ResyncMFADevice',
          'iam:UpdateLoginProfile',
          'sts:GetSessionToken',
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
