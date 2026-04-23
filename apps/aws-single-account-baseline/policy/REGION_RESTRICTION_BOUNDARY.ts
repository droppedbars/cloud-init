import * as aws from '@pulumi/aws';

export function getRegionRestrictionBoundaryDocument(allowedRegions: string[]) {
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
    ],
  });
}
