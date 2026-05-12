import * as aws from '@pulumi/aws';

/**
 * Grants every group member the ability to manage their own MFA device and
 * password from their direct IAM session — before they have assumed any role.
 *
 * This is distinct from the MFA-related statements in BASIC_ALL_USERS_POLICY:
 * that policy is attached to roles and is therefore unavailable in a fresh
 * direct session. Without this policy a user cannot reach the "Security
 * credentials" page in the console to bootstrap MFA, creating a dead-end.
 *
 * Note: this policy intentionally has no MFA-deny block. The deny block lives
 * on roles (via BASIC_ALL_USERS_POLICY) and governs what a user can do once
 * they have assumed a role. Here we only need to allow the bootstrap actions.
 */
export default function getSelfServiceMfaPolicyDocument() {
  return aws.iam.getPolicyDocumentOutput({
    statements: [
      {
        sid: 'AllowViewAccountInfo',
        actions: ['iam:GetAccountPasswordPolicy', 'iam:ListVirtualMFADevices'],
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
    ],
  });
}
