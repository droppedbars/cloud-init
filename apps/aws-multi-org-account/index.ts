import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { loadConfig } from './configLoader';
import { BaselineUsers } from './components/BaselineUsers';
import { UserGroupMemberships } from './components/UserGroupMemberships';
import { DynamicGroup } from './components/DynamicGroup';
import { DynamicOrganization } from './components/DynamicOrganization';

type GroupOutput = {
  groupName: pulumi.Output<string>;
  groupArn: pulumi.Output<string>;
  groupId: pulumi.Output<string>;
};

const config = loadConfig();

// 0. Preliminary Checks and Organization Discovery
let existingOrg: aws.organizations.GetOrganizationResult | undefined;
let existingOus: { id: string; name: string }[] = [];
let existingAccounts: { id: string; name: string; email: string; status: string }[] = [];

try {
  existingOrg = await aws.organizations.getOrganization();
  if (existingOrg && existingOrg.roots && existingOrg.roots.length > 0) {
    const ous = await aws.organizations.getOrganizationalUnits({
      parentId: existingOrg.roots[0].id,
    });
    existingOus = ous.children;
    existingAccounts = existingOrg.accounts;
  }
} catch (e: unknown) {
  if (e instanceof Error && e.message.includes('AWSOrganizationsNotInUseException')) {
    pulumi.log.info('Organization is not yet created. It will be provisioned.');
  } else {
    pulumi.log.warn(`Could not fetch existing organization details: ${e}`);
  }
}

// Check Identity Center early
const ssoProvider = config.ssoRegion
  ? new aws.Provider('sso-provider', { region: config.ssoRegion as aws.Region })
  : undefined;

let ssoAdminInstances: aws.ssoadmin.GetInstancesResult | undefined;
try {
  ssoAdminInstances = await aws.ssoadmin.getInstances(
    {},
    ssoProvider ? { provider: ssoProvider } : undefined,
  );
  if (!ssoAdminInstances || !ssoAdminInstances.arns || ssoAdminInstances.arns.length === 0) {
    throw new Error('No Identity Center instances found.');
  }
} catch (e) {
  throw new Error(
    'AWS IAM Identity Center is not enabled in the management account. Please go enable it manually in the AWS Console and then run this deployment again.',
    { cause: e },
  );
}

const ssoInstanceArn = ssoAdminInstances.arns[0];
const identityStoreId = ssoAdminInstances.identityStoreIds[0];

// Warning for account closure
pulumi.log.warn(
  'Warning: AWS accounts being closed or removed will still exist in a suspended state for 90 days before permanent deletion. They cannot be fully destroyed immediately.',
);

const organization =
  config.organizationalUnits && config.organizationalUnits.length > 0
    ? new DynamicOrganization('main-organization', {
        organizationalUnits: config.organizationalUnits,
        existingOrgId: existingOrg?.id,
        existingRootId: existingOrg?.roots[0].id,
        existingMasterAccountId: existingOrg?.masterAccountId,
        existingOus,
        existingAccounts,
      })
    : undefined;

// We can export managementAccountId if needed later, but removing it to fix lint errors.
// const managementAccountId = organization?.managementAccountId;

// Automatically tag every AWS resource with ManagedBy + any user-defined tags from config.json.
// This must be registered before any resources are instantiated.
//
// Some AWS resources do not support tags at all (e.g. UserLoginProfile, policy attachments).
// These are explicitly excluded to prevent provider validation errors.
const NON_TAGGABLE_TYPES = new Set([
  'aws:iam/group:Group',
  'aws:iam/userLoginProfile:UserLoginProfile',
  'aws:iam/userGroupMembership:UserGroupMembership',
  'aws:iam/rolePolicyAttachment:RolePolicyAttachment',
  'aws:iam/groupPolicyAttachment:GroupPolicyAttachment',
  'aws:iam/userPolicyAttachment:UserPolicyAttachment',
  'aws:iam/accessKey:AccessKey',
  'aws:iam/accountPasswordPolicy:AccountPasswordPolicy',
  'aws:iam/rolePolicy:RolePolicy',
  'aws:cloudwatch/eventTarget:EventTarget',
  'aws:cloudwatch/logMetricFilter:LogMetricFilter',
  'aws:sns/topicPolicy:TopicPolicy',
  'aws:sns/topicSubscription:TopicSubscription',
  'aws:s3/bucketPolicy:BucketPolicy',
  'aws:s3/bucketPublicAccessBlock:BucketPublicAccessBlock',
  'aws:lambda/permission:Permission',
  'aws:identitystore/user:User',
  'aws:identitystore/group:Group',
  'aws:identitystore/groupMembership:GroupMembership',
  'aws:ssoadmin/accountAssignment:AccountAssignment',
  'aws:ssoadmin/managedPolicyAttachment:ManagedPolicyAttachment',
  'aws:ssoadmin/customerManagedPolicyAttachment:CustomerManagedPolicyAttachment',
  'aws:ssoadmin/permissionsBoundaryAttachment:PermissionsBoundaryAttachment',
]);

pulumi.runtime.registerStackTransformation((args) => {
  if (args.type.startsWith('aws:') && !NON_TAGGABLE_TYPES.has(args.type)) {
    args.props['tags'] = {
      ManagedBy: 'pulumi',
      Project: pulumi.getProject(),
      Stack: pulumi.getStack(),
      ...(config.tags ?? {}),
      // Preserve any tags already set on the resource
      ...args.props['tags'],
    };
    return { props: args.props, opts: args.opts };
  }
  return undefined;
});

export const groupOutputs: Record<string, GroupOutput> = {};
export let initialPasswords: Record<string, pulumi.Output<string>> | undefined = undefined;

// 1. Provision a single AdministratorAccess Permission Set
const adminPermissionSet = new aws.ssoadmin.PermissionSet(
  `permission-set-admin`,
  {
    name: 'SystemAdministrator',
    instanceArn: ssoInstanceArn!,
  },
  ssoProvider ? { provider: ssoProvider } : undefined,
);

const adminPolicyAttachment = new aws.ssoadmin.ManagedPolicyAttachment(
  `admin-managed-policy-attachment`,
  {
    instanceArn: ssoInstanceArn!,
    permissionSetArn: adminPermissionSet.arn,
    managedPolicyArn: 'arn:aws:iam::aws:policy/AdministratorAccess',
  },
  ssoProvider ? { provider: ssoProvider } : undefined,
);

const groupComponents: DynamicGroup[] = [];

// 2. Provision dynamic groups
let previousGroup: DynamicGroup | undefined = undefined;
for (const groupConfig of config.groups) {
  const dynamicGroup: DynamicGroup = new DynamicGroup(
    `dynamic-group-${groupConfig.name}`,
    {
      groupName: groupConfig.name,
      adminPermissionSetArn: adminPermissionSet.arn,
      assignments: groupConfig.assignments,
      accountIds: organization ? organization.accountIds : undefined,
      ouAccountIds: organization ? organization.ouAccountIds : undefined,
      ssoInstanceArn: ssoInstanceArn,
      identityStoreId: identityStoreId,
    },
    {
      dependsOn: [
        adminPermissionSet,
        adminPolicyAttachment,
        ...(organization ? [organization] : []),
        ...(previousGroup ? [previousGroup] : []),
      ],
      provider: ssoProvider,
    },
  );

  previousGroup = dynamicGroup;
  groupComponents.push(dynamicGroup);

  groupOutputs[groupConfig.name] = {
    groupName: dynamicGroup.groupName,
    groupArn: dynamicGroup.groupArn,
    groupId: dynamicGroup.groupId,
  };
}

// 3. Provision the baseline users
const users = new BaselineUsers(
  'baseline-users-component',
  {
    users: config.users,
    identityStoreId: identityStoreId,
  },
  ssoProvider ? { provider: ssoProvider } : undefined,
);

// 4. Attach users to groups
// Wait for users and groups to be created first by defining a dependsOn relationship
new UserGroupMemberships(
  'user-group-memberships',
  {
    users: config.users,
    userIds: users.userIds,
    groupIds: Object.keys(groupOutputs).reduce(
      (acc, key) => {
        acc[key] = groupOutputs[key].groupId;
        return acc;
      },
      {} as Record<string, pulumi.Output<string>>,
    ),
    identityStoreId: identityStoreId,
  },
  {
    dependsOn: [users, ...groupComponents],
    provider: ssoProvider,
  },
);

initialPasswords = users.initialPasswords;
