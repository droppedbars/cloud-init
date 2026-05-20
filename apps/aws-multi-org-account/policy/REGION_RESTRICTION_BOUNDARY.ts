import * as aws from '@pulumi/aws';

export default function getRegionRestrictionBoundaryDocument(allowedRegions: string[]) {
  // Note: Due to the nature of a Permissions Boundary, we must use an Allow *
  // statement, as a boundary strictly intersects with identity policies.
  // If we do not allow *, the boundary will implicitly deny everything.
  return aws.iam.getPolicyDocumentOutput({
    statements: [
      {
        sid: 'AllowAllToEstablishBoundary',
        actions: ['*'],
        resources: ['*'],
      },
      {
        sid: 'DenyOutsideApprovedRegions',
        effect: 'Deny',
        notActions: [
          'iam:*',
          'organizations:*',
          'route53:*',
          'cloudfront:*',
          'support:*',
          'budgets:*',
          'waf:*',
          'wafv2:*',
          'globalaccelerator:*',
          'importexport:*',
          'artifact:*',
          'health:*',
          'cloudwatch:*',
          'freetier:GetFreeTierUsage',
        ],
        resources: ['*'],
        conditions: [
          {
            test: 'StringNotEquals',
            variable: 'aws:RequestedRegion',
            values: allowedRegions,
          },
        ],
      },
      {
        sid: 'PreventBoundaryModification',
        effect: 'Deny',
        actions: [
          'iam:DeleteRolePermissionsBoundary',
          'iam:PutRolePermissionsBoundary',
          'iam:DeleteUserPermissionsBoundary',
          'iam:PutUserPermissionsBoundary',
        ],
        resources: ['*'],
        conditions: [
          {
            test: 'StringEquals',
            variable: 'iam:PermissionsBoundary',
            // Note: In AWS partition, arn:aws:iam is correct. Account ID doesn't need to be strictly interpolated if we use `*` or a generic pattern, but for stricter control we would use the account ID. However, using `*` for the account id part of the ARN is also valid.
            values: ['arn:aws:iam::*:policy/REGION_RESTRICTION_BOUNDARY'],
          },
        ],
      },
    ],
  });
}
