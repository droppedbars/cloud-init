import * as aws from '@pulumi/aws';

export function getFinanceAdminPolicyDocument() {
  return aws.iam.getPolicyDocumentOutput({
    statements: [
      {
        sid: 'FinanceAdministration',
        actions: [
          // Billing Console
          'billing:GetBillingData',
          'billing:GetBillingDetails',
          'billing:GetBillingNotifications',
          'billing:GetBillingPreferences',
          'billing:UpdatePreferences',
          // Legacy Billing (Still sometimes needed)
          'aws-portal:ViewBilling',
          'aws-portal:ModifyBilling',
          'aws-portal:ViewPaymentMethods',
          'aws-portal:ModifyPaymentMethods',
          // Cost Explorer
          'ce:GetCostAndUsage',
          'ce:GetCostForecast',
          'ce:GetReservationUtilization',
          'ce:GetReservationPurchaseRecommendation',
          'ce:GetSavingsPlansUtilization',
          'ce:GetSavingsPlansPurchaseRecommendation',
          'ce:GetDimensionValues',
          // Budgets
          'budgets:ViewBudget',
          'budgets:ModifyBudget',
          // Cost and Usage Report
          'cur:DescribeReportDefinitions',
          'cur:PutReportDefinition',
          'cur:DeleteReportDefinition',
          'cur:ModifyReportDefinition',
          // Invoicing and Payments
          'invoicing:ListInvoices',
          'invoicing:GetInvoicePDF',
          'payments:ListPaymentPreferences',
          'payments:UpdatePaymentPreferences',
          'payments:GetPaymentStatus',
          // Tax Settings
          'tax:ListTaxRegistrations',
          'tax:PutTaxRegistration',
          'tax:GetTaxRegistration',
          // Purchase Orders
          'purchase-orders:ListPurchaseOrders',
          'purchase-orders:ViewPurchaseOrders',
          'purchase-orders:ModifyPurchaseOrders',
        ],
        resources: ['*'], // Global billing services require * for resource
      },
    ],
  });
}
