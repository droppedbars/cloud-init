import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { loadConfig } from './configLoader';
import { BaselineUsers } from './components/BaselineUsers';
import { UserGroupMemberships } from './components/UserGroupMemberships';
import { DynamicRole } from './components/DynamicRole';
import { DynamicGroup } from './components/DynamicGroup';
import { AccountBudget } from './components/AccountBudget';

type GroupOutput = {
  groupName: pulumi.Output<string>;
  groupArn: pulumi.Output<string>;
};

const config = loadConfig();

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
const customPolicyMap: Record<string, pulumi.Output<string>> = {};
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

const stackName = pulumi.getStack();
const projectName = pulumi.getProject();

const oldParents = [
  `urn:pulumi:${stackName}::${projectName}::cloud-baseline:iam:BaselineUsers::baseline-users-component`,
  `urn:pulumi:${stackName}::${projectName}::cloud-baseline:iam:AccountAdminRole::admin-role-component`,
];

for (const role of config.roles) {
  oldParents.push(
    `urn:pulumi:${stackName}::${projectName}::cloud-baseline:iam:DynamicRole::dynamic-role-${role.name}`,
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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const policyModule = require(`./policy/${pol}`);
  const exportKeys = Object.keys(policyModule);
  const getPolicyDoc = policyModule[exportKeys[0]];
  const policyDoc = getPolicyDoc();

  const customPolicy = new aws.iam.Policy(
    `shared-policy-${pol}`,
    { name: pol, policy: policyDoc.json },
    { aliases: generateAliases(pol) },
  );
  customPolicyMap[pol] = customPolicy.arn;
}

// Create shared boundary policies
for (const pol of allBoundariesToCreate) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const policyModule = require(`./policy/${pol}`);
  const exportKeys = Object.keys(policyModule);
  const getPolicyDoc = policyModule[exportKeys[0]];
  const policyDoc = getPolicyDoc(config.allowedRegions);

  const customBoundary = new aws.iam.Policy(
    `shared-boundary-${pol}`,
    { name: pol, policy: policyDoc.json },
    { aliases: generateAliases(pol) },
  );
  customPolicyMap[pol] = customBoundary.arn;
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

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const policyModule = require(`./policy/${pol.name}`);
    const exportKeys = Object.keys(policyModule);
    const getPolicyDoc = policyModule[exportKeys[0]];
    const policyDoc = getPolicyDoc(pol.allowedActions);

    const roleSpecificPolicy = new aws.iam.Policy(`role-specific-policy-${mapKey}`, {
      name: physicalName,
      policy: policyDoc.json,
    });
    customPolicyMap[mapKey] = roleSpecificPolicy.arn;
  }
}

// 2. Provision dynamic roles
const roleMap: Record<string, pulumi.Output<string>> = {};
const roleComponents: DynamicRole[] = [];

for (const roleConfig of config.roles) {
  const policyArns = roleConfig.policies.map((p) => {
    if (typeof p === 'string') {
      return p.startsWith('arn:aws:iam::') ? p : customPolicyMap[p];
    }
    // PolicyConfig object
    if (p.name.startsWith('arn:aws:iam::')) return p.name;
    const roleSpecificKey = `${roleConfig.name}:${p.name}`;
    return customPolicyMap[roleSpecificKey] ?? customPolicyMap[p.name];
  });

  const boundaryArn = roleConfig.permissionsBoundary
    ? roleConfig.permissionsBoundary.startsWith('arn:aws:iam::')
      ? roleConfig.permissionsBoundary
      : customPolicyMap[roleConfig.permissionsBoundary]
    : undefined;

  const dynamicRole = new DynamicRole(`dynamic-role-${roleConfig.name}`, {
    roleName: roleConfig.name,
    policyArns: policyArns,
    permissionsBoundaryArn: boundaryArn,
  });
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
    },
    { dependsOn: roleComponents },
  );

  groupComponents.push(dynamicGroup);

  groupOutputs[groupConfig.name] = {
    groupName: dynamicGroup.groupName,
    groupArn: dynamicGroup.groupArn,
  };
}

// 3. Provision the baseline users
const users = new BaselineUsers('baseline-users-component', {
  users: config.users,
  allowedRegions: config.allowedRegions,
});

// 4. Attach users to groups
// Wait for users and groups to be created first by defining a dependsOn relationship
new UserGroupMemberships(
  'user-group-memberships',
  {
    users: config.users,
  },
  { dependsOn: [users, ...groupComponents] },
);

// Export outputs
export const initialPasswords = users.initialPasswords;

// 5. Provision Account Budget if configured
if (config.budget) {
  new AccountBudget('account-baseline-budget', {
    limitAmount: config.budget.limitAmount,
    limitUnit: config.budget.limitUnit,
    subscriberEmailAddresses: config.budget.subscriberEmailAddresses,
  });
}
