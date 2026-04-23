import * as aws from '@pulumi/aws';

export function getAccountAdminPolicyDocument() {
  return aws.iam.getPolicyDocumentOutput({
    statements: [
      {
        actions: [
          // Billing
          'billing:GetBillingData',
          'billing:GetBillingDetails',
          'billing:GetBillingNotifications',
          'billing:GetBillingPreferences',
          'billing:UpdatePreferences',
          'aws-portal:ViewBilling',
          'aws-portal:ModifyBilling',
          // Budgets
          'budgets:ViewBudget',
          'budgets:ModifyBudget',
          // Organizations
          'organizations:DescribeOrganization',
          'organizations:ListAccounts',
          'organizations:ListRoots',
          'organizations:ListOrganizationalUnitsForParent',
          'organizations:DescribeAccount',
          'organizations:InviteAccountToOrganization',
          'organizations:CreateAccount',
          'organizations:UpdateOrganizationalUnit',
          // Support
          'support:DescribeCases',
          'support:DescribeCommunications',
          'support:CreateCase',
          'support:AddAttachmentsToSet',
          'support:AddCommunicationToCase',
          'support:ResolveCase',
          // Service (Service Quotas)
          'servicequotas:ListServiceQuotas',
          'servicequotas:GetServiceQuota',
          'servicequotas:RequestServiceQuotaIncrease',
          'servicequotas:ListRequestedServiceQuotaChangeHistory',
        ],
        resources: ['*'], // Global services typically require * for resource
      },
    ],
  });
}
