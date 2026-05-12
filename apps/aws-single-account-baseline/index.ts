import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { loadConfig } from './configLoader';
import { BaselineUsers } from './components/BaselineUsers';
import { UserGroupMemberships } from './components/UserGroupMemberships';
import { DynamicRole } from './components/DynamicRole';
import { DynamicGroup } from './components/DynamicGroup';
import { AccountBudget } from './components/AccountBudget';
import { SecurityAlerting } from './components/SecurityAlerting';
import { PolicyReference } from './components/DynamicRole';

type GroupOutput = {
  groupName: pulumi.Output<string>;
  groupArn: pulumi.Output<string>;
  groupId: pulumi.Output<string>;
};

const config = loadConfig();

const ssoProvider = config.ssoRegion
  ? new aws.Provider('sso-provider', { region: config.ssoRegion as aws.Region })
  : undefined;

const ssoAdminInstances =
  config.identityStrategy === 'IdentityCenter'
    ? aws.ssoadmin.getInstancesOutput({}, ssoProvider ? { provider: ssoProvider } : undefined)
    : undefined;
const ssoInstanceArn = ssoAdminInstances
  ? ssoAdminInstances.apply((i) => {
    if (!i.arns || i.arns.length === 0) {
      throw new Error(
        "AWS IAM Identity Center is not enabled in this account. Please enable it before using identityStrategy: 'IdentityCenter'.",
      );
    }
    return i.arns[0];
  })
  : undefined;

const identityStoreId = ssoAdminInstances
  ? ssoAdminInstances.apply((i) => {
    if (!i.identityStoreIds || i.identityStoreIds.length === 0) {
      throw new Error('No Identity Store found. Please ensure IAM Identity Center is enabled.');
    }
    return i.identityStoreIds[0];
  })
  : undefined;

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

// 1. Centrally create shared IAM Policies to prevent EntityAlreadyExists.
//    Policies with allowedActions are role-specific and get a unique name per role.
const customPolicyMap: Record<string, { arn: pulumi.Output<string>; isManaged: boolean }> = {};
const allPoliciesToCreate = new Set<string>();
const allBoundariesToCreate = new Set<string>();

for (const role of config.roles) {
  for (const pol of role.policies) {
    const polName = typeof pol === 'string' ? pol : pol.name;
    const hasArgs = typeof pol !== 'string' && pol.allowedActions && pol.allowedActions.length > 0;

    if (!polName.startsWith('arn:aws:iam::') && !hasArgs) {
      // Plain string or object without args — shared, deduplicated
      allPoliciesToCreate.add(polName);
    }
  }
  if (role.permissionsBoundary && !role.permissionsBoundary.startsWith('arn:aws:iam::')) {
    allBoundariesToCreate.add(role.permissionsBoundary);
  }
}

for (const group of config.groups) {
  // Opt-in access-key management: register shared policy for deduplication
  if (group.allowAccessKeyManagement) {
    allPoliciesToCreate.add('MANAGE_ACCESS_KEYS_POLICY');
  }
}

const stackName = pulumi.getStack();
const projectName = pulumi.getProject();

const oldParents = [
  `urn:pulumi:${stackName}::${projectName}::cloud-init:iam:BaselineUsers::baseline-users-component`,
  `urn:pulumi:${stackName}::${projectName}::cloud-init:iam:AccountAdminRole::admin-role-component`,
];

for (const role of config.roles) {
  oldParents.push(
    `urn:pulumi:${stackName}::${projectName}::cloud-init:iam:DynamicRole::dynamic-role-${role.name}`,
  );
}

const generateAliases = (resourceName: string): pulumi.Alias[] => {
  const aliases: pulumi.Alias[] = [{ name: resourceName }];
  for (const parentUrn of oldParents) {
    aliases.push({ name: resourceName, parent: parentUrn });
  }
  return aliases;
};

// Create shared (deduplicated) policies
for (const pol of allPoliciesToCreate) {
  try {
    const policyModule = await import(`./policy/${pol}`);
    const getPolicyDoc = policyModule.default;
    const policyDoc = typeof getPolicyDoc === 'function' ? getPolicyDoc() : getPolicyDoc;

    const customPolicy = new aws.iam.Policy(
      `shared-policy-${pol}`,
      { name: pol, policy: policyDoc.json },
      { aliases: generateAliases(pol) },
    );
    customPolicyMap[pol] = { arn: customPolicy.arn, isManaged: false };
  } catch (error: any) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') {
      // If no local file exists, assume it's an AWS managed policy shorthand
      customPolicyMap[pol] = {
        arn: pulumi.output(`arn:aws:iam::aws:policy/${pol}`),
        isManaged: true,
      };
    } else {
      throw error;
    }
  }
}

// Create the self-service MFA policy — attached to every group so users can
// bootstrap MFA from their direct session before assuming any role.
const selfServiceMfaModule = await import('./policy/SELF_SERVICE_MFA_POLICY');
const selfServiceMfaPolicy = new aws.iam.Policy('shared-policy-SELF_SERVICE_MFA_POLICY', {
  name: 'SELF_SERVICE_MFA_POLICY',
  policy: selfServiceMfaModule.default().json,
});

// Create shared boundary policies
for (const pol of allBoundariesToCreate) {
  try {
    const policyModule = await import(`./policy/${pol}`);
    const getPolicyDoc = policyModule.default;
    const policyDoc = typeof getPolicyDoc === 'function' ? getPolicyDoc(config.allowedRegions) : getPolicyDoc;

    const customBoundary = new aws.iam.Policy(
      `shared-boundary-${pol}`,
      { name: pol, policy: policyDoc.json },
      { aliases: generateAliases(pol) },
    );
    customPolicyMap[pol] = { arn: customBoundary.arn, isManaged: false };
  } catch (error: any) {
    if (error.code === 'MODULE_NOT_FOUND') {
      // If no local file exists, assume it's an AWS managed policy shorthand
      customPolicyMap[pol] = {
        arn: pulumi.output(`arn:aws:iam::aws:policy/${pol}`),
        isManaged: true,
      };
    } else {
      throw error;
    }
  }
}

// Create role-specific parameterized policies (e.g. GLOBAL_DEVELOPER_POLICY with allowedActions)
for (const role of config.roles) {
  for (const pol of role.policies) {
    if (typeof pol === 'string') continue;
    if (pol.name.startsWith('arn:aws:iam::')) continue;
    if (!pol.allowedActions || pol.allowedActions.length === 0) continue;

    const physicalName = `${role.name}_${pol.name}`;
    const mapKey = `${role.name}:${pol.name}`;
    if (customPolicyMap[mapKey]) continue;

    const policyModule = await import(`./policy/${pol.name}`);
    const getPolicyDoc = policyModule.default;
    const policyDoc = typeof getPolicyDoc === 'function' ? getPolicyDoc(pol.allowedActions) : getPolicyDoc;

    const roleSpecificPolicy = new aws.iam.Policy(`role-specific-policy-${mapKey}`, {
      name: physicalName,
      policy: policyDoc.json,
    });
    customPolicyMap[mapKey] = { arn: roleSpecificPolicy.arn, isManaged: false };
  }
}

// 2. Provision dynamic roles
const roleMap: Record<string, pulumi.Output<string>> = {};
const roleComponents: DynamicRole[] = [];

for (const roleConfig of config.roles) {
  const policyRefs: PolicyReference[] = roleConfig.policies.map((p) => {
    if (typeof p === 'string') {
      if (p.startsWith('arn:aws:iam::')) {
        return {
          arn: p,
          name: p.split('/').pop()!,
          isManaged: p.startsWith('arn:aws:iam::aws:policy/'),
        };
      }
      return {
        arn: customPolicyMap[p].arn,
        name: p,
        isManaged: customPolicyMap[p].isManaged,
      };
    }
    // PolicyConfig object
    if (p.name.startsWith('arn:aws:iam::')) {
      return {
        arn: p.name,
        name: p.name.split('/').pop()!,
        isManaged: p.name.startsWith('arn:aws:iam::aws:policy/'),
      };
    }
    const roleSpecificKey = `${roleConfig.name}:${p.name}`;
    if (customPolicyMap[roleSpecificKey]) {
      return {
        arn: customPolicyMap[roleSpecificKey].arn,
        name: `${roleConfig.name}_${p.name}`,
        isManaged: customPolicyMap[roleSpecificKey].isManaged,
      };
    }
    const mapped = customPolicyMap[p.name];
    return {
      arn: mapped.arn,
      name: p.name,
      isManaged: mapped.isManaged,
    };
  });

  let boundaryRef: PolicyReference | undefined = undefined;
  if (roleConfig.permissionsBoundary) {
    if (roleConfig.permissionsBoundary.startsWith('arn:aws:iam::')) {
      boundaryRef = {
        arn: roleConfig.permissionsBoundary,
        name: roleConfig.permissionsBoundary.split('/').pop()!,
        isManaged: roleConfig.permissionsBoundary.startsWith('arn:aws:iam::aws:policy/'),
      };
    } else {
      const mapped = customPolicyMap[roleConfig.permissionsBoundary];
      boundaryRef = {
        arn: mapped.arn,
        name: roleConfig.permissionsBoundary,
        isManaged: mapped.isManaged,
      };
    }
  }

  const dynamicRole = new DynamicRole(
    `dynamic-role-${roleConfig.name}`,
    {
      roleName: roleConfig.name,
      policyRefs: policyRefs,
      permissionsBoundaryRef: boundaryRef,
      identityStrategy: config.identityStrategy || 'Traditional',
      ssoInstanceArn: ssoInstanceArn,
    },
    ssoProvider ? { provider: ssoProvider } : undefined,
  );
  roleComponents.push(dynamicRole);
  roleMap[roleConfig.name] = dynamicRole.roleArn;
}

const groupComponents: DynamicGroup[] = [];

// 2. Provision dynamic groups
for (const groupConfig of config.groups) {
  const requestedRoles = groupConfig.roles.reduce(
    (acc, roleName) => {
      if (roleMap[roleName]) {
        acc[roleName] = roleMap[roleName];
      } else {
        throw new Error(`Group ${groupConfig.name} references undefined role: ${roleName}`);
      }
      return acc;
    },
    {} as Record<string, pulumi.Output<string>>,
  );

  const dynamicGroup = new DynamicGroup(
    `dynamic-group-${groupConfig.name}`,
    {
      groupName: groupConfig.name,
      roles: requestedRoles,
      sharedPolicyArns: [
        selfServiceMfaPolicy.arn,
        ...(groupConfig.allowAccessKeyManagement
          ? [customPolicyMap['MANAGE_ACCESS_KEYS_POLICY'].arn]
          : []),
      ],
      identityStrategy: config.identityStrategy || 'Traditional',
      ssoInstanceArn: ssoInstanceArn,
      identityStoreId: identityStoreId,
    },
    {
      dependsOn: roleComponents,
      provider: ssoProvider,
    },
  );

  groupComponents.push(dynamicGroup);

  groupOutputs[groupConfig.name] = {
    groupName: dynamicGroup.groupName,
    groupArn: dynamicGroup.groupArn,
    groupId: dynamicGroup.groupId,
  };
}

// 3. Enforce a deterministic account password policy.
//    Without this, AWS applies opaque defaults which can cause misleading
//    "does not comply with password policy" errors on first-login resets.
new aws.iam.AccountPasswordPolicy('account-password-policy', {
  minimumPasswordLength: 12,
  requireLowercaseCharacters: true,
  requireUppercaseCharacters: true,
  requireNumbers: true,
  requireSymbols: true,
  allowUsersToChangePassword: true,
  // Disable forced rotation — MFA is the primary control here.
  maxPasswordAge: 0,
  passwordReusePrevention: 24,
  hardExpiry: false,
});

// 4. Provision the baseline users
const users = new BaselineUsers(
  'baseline-users-component',
  {
    users: config.users,
    allowedRegions: config.allowedRegions,
    preserveOnDestroy: config.preserveOnDestroy,
    identityStrategy: config.identityStrategy || 'Traditional',
    identityStoreId: identityStoreId,
  },
  ssoProvider ? { provider: ssoProvider } : undefined,
);

// 5. Attach users to groups
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
    identityStrategy: config.identityStrategy || 'Traditional',
    identityStoreId: identityStoreId,
  },
  {
    dependsOn: [users, ...groupComponents],
    provider: ssoProvider,
  },
);

// Export outputs
export const initialPasswords = users.initialPasswords;

// 6. Provision Account Budget if configured
if (config.budget) {
  new AccountBudget('account-init-budget', {
    limitAmount: config.budget.limitAmount,
    limitUnit: config.budget.limitUnit,
    subscriberEmailAddresses: config.budget.subscriberEmailAddresses,
    allowedRegions: config.allowedRegions,
    killSwitch: config.budget.killSwitch,
  });
}

// 7. Provision Security Alerting if configured
export const securityAlertingTopicArn = config.alerting
  ? new SecurityAlerting('security-alerting', {
    notifyOnAccessKeyCreation: config.alerting.notifyOnAccessKeyCreation,
    notifyOnConsoleLogin: config.alerting.notifyOnConsoleLogin,
    subscriberEmailAddresses: config.alerting.subscriberEmailAddresses,
    preserveOnDestroy: config.preserveOnDestroy,
  }).topicArn
  : undefined;
