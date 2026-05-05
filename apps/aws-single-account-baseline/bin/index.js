"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.securityAlertingTopicArn = exports.initialPasswords = exports.groupOutputs = void 0;
const aws = __importStar(require("@pulumi/aws"));
const pulumi = __importStar(require("@pulumi/pulumi"));
const configLoader_1 = require("./configLoader");
const BaselineUsers_1 = require("./components/BaselineUsers");
const UserGroupMemberships_1 = require("./components/UserGroupMemberships");
const DynamicRole_1 = require("./components/DynamicRole");
const DynamicGroup_1 = require("./components/DynamicGroup");
const AccountBudget_1 = require("./components/AccountBudget");
const SecurityAlerting_1 = require("./components/SecurityAlerting");
const config = (0, configLoader_1.loadConfig)();
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
]);
pulumi.runtime.registerStackTransformation((args) => {
    var _a;
    if (args.type.startsWith('aws:') && !NON_TAGGABLE_TYPES.has(args.type)) {
        args.props['tags'] = Object.assign(Object.assign({ ManagedBy: 'pulumi', Project: pulumi.getProject(), Stack: pulumi.getStack() }, ((_a = config.tags) !== null && _a !== void 0 ? _a : {})), args.props['tags']);
        return { props: args.props, opts: args.opts };
    }
    return undefined;
});
exports.groupOutputs = {};
// 1. Centrally create shared IAM Policies to prevent EntityAlreadyExists.
//    Policies with allowedActions are role-specific and get a unique name per role.
const customPolicyMap = {};
const allPoliciesToCreate = new Set();
const allBoundariesToCreate = new Set();
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
    `urn:pulumi:${stackName}::${projectName}::cloud-baseline:iam:BaselineUsers::baseline-users-component`,
    `urn:pulumi:${stackName}::${projectName}::cloud-baseline:iam:AccountAdminRole::admin-role-component`,
];
for (const role of config.roles) {
    oldParents.push(`urn:pulumi:${stackName}::${projectName}::cloud-baseline:iam:DynamicRole::dynamic-role-${role.name}`);
}
const generateAliases = (resourceName) => {
    const aliases = [{ name: resourceName }];
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
    const customPolicy = new aws.iam.Policy(`shared-policy-${pol}`, { name: pol, policy: policyDoc.json }, { aliases: generateAliases(pol) });
    customPolicyMap[pol] = customPolicy.arn;
}
// Create the self-service MFA policy — attached to every group so users can
// bootstrap MFA from their direct session before assuming any role.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const selfServiceMfaModule = require('./policy/SELF_SERVICE_MFA_POLICY');
const selfServiceMfaPolicy = new aws.iam.Policy('shared-policy-SELF_SERVICE_MFA_POLICY', {
    name: 'SELF_SERVICE_MFA_POLICY',
    policy: selfServiceMfaModule[Object.keys(selfServiceMfaModule)[0]]().json,
});
// Create shared boundary policies
for (const pol of allBoundariesToCreate) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const policyModule = require(`./policy/${pol}`);
    const exportKeys = Object.keys(policyModule);
    const getPolicyDoc = policyModule[exportKeys[0]];
    const policyDoc = getPolicyDoc(config.allowedRegions);
    const customBoundary = new aws.iam.Policy(`shared-boundary-${pol}`, { name: pol, policy: policyDoc.json }, { aliases: generateAliases(pol) });
    customPolicyMap[pol] = customBoundary.arn;
}
// Create role-specific parameterized policies (e.g. GLOBAL_DEVELOPER_POLICY with allowedActions)
for (const role of config.roles) {
    for (const pol of role.policies) {
        if (typeof pol === 'string')
            continue;
        if (pol.name.startsWith('arn:aws:iam::'))
            continue;
        if (!pol.allowedActions || pol.allowedActions.length === 0)
            continue;
        const physicalName = `${role.name}_${pol.name}`;
        const mapKey = `${role.name}:${pol.name}`;
        if (customPolicyMap[mapKey])
            continue;
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
const roleMap = {};
const roleComponents = [];
for (const roleConfig of config.roles) {
    const policyArns = roleConfig.policies.map((p) => {
        var _a;
        if (typeof p === 'string') {
            return p.startsWith('arn:aws:iam::') ? p : customPolicyMap[p];
        }
        // PolicyConfig object
        if (p.name.startsWith('arn:aws:iam::'))
            return p.name;
        const roleSpecificKey = `${roleConfig.name}:${p.name}`;
        return (_a = customPolicyMap[roleSpecificKey]) !== null && _a !== void 0 ? _a : customPolicyMap[p.name];
    });
    const boundaryArn = roleConfig.permissionsBoundary
        ? roleConfig.permissionsBoundary.startsWith('arn:aws:iam::')
            ? roleConfig.permissionsBoundary
            : customPolicyMap[roleConfig.permissionsBoundary]
        : undefined;
    const dynamicRole = new DynamicRole_1.DynamicRole(`dynamic-role-${roleConfig.name}`, {
        roleName: roleConfig.name,
        policyArns: policyArns,
        permissionsBoundaryArn: boundaryArn,
    });
    roleComponents.push(dynamicRole);
    roleMap[roleConfig.name] = dynamicRole.roleArn;
}
const groupComponents = [];
// 2. Provision dynamic groups
for (const groupConfig of config.groups) {
    const requestedRoles = groupConfig.roles.reduce((acc, roleName) => {
        if (roleMap[roleName]) {
            acc[roleName] = roleMap[roleName];
        }
        else {
            throw new Error(`Group ${groupConfig.name} references undefined role: ${roleName}`);
        }
        return acc;
    }, {});
    const dynamicGroup = new DynamicGroup_1.DynamicGroup(`dynamic-group-${groupConfig.name}`, {
        groupName: groupConfig.name,
        roles: requestedRoles,
        sharedPolicyArns: [
            selfServiceMfaPolicy.arn,
            ...(groupConfig.allowAccessKeyManagement
                ? [customPolicyMap['MANAGE_ACCESS_KEYS_POLICY']]
                : []),
        ],
    }, { dependsOn: roleComponents });
    groupComponents.push(dynamicGroup);
    exports.groupOutputs[groupConfig.name] = {
        groupName: dynamicGroup.groupName,
        groupArn: dynamicGroup.groupArn,
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
const users = new BaselineUsers_1.BaselineUsers('baseline-users-component', {
    users: config.users,
    allowedRegions: config.allowedRegions,
    preserveOnDestroy: config.preserveOnDestroy,
});
// 5. Attach users to groups
// Wait for users and groups to be created first by defining a dependsOn relationship
new UserGroupMemberships_1.UserGroupMemberships('user-group-memberships', {
    users: config.users,
}, { dependsOn: [users, ...groupComponents] });
// Export outputs
exports.initialPasswords = users.initialPasswords;
// 6. Provision Account Budget if configured
if (config.budget) {
    new AccountBudget_1.AccountBudget('account-baseline-budget', {
        limitAmount: config.budget.limitAmount,
        limitUnit: config.budget.limitUnit,
        subscriberEmailAddresses: config.budget.subscriberEmailAddresses,
        allowedRegions: config.allowedRegions,
        killSwitch: config.budget.killSwitch,
    });
}
// 7. Provision Security Alerting if configured
exports.securityAlertingTopicArn = config.alerting
    ? new SecurityAlerting_1.SecurityAlerting('security-alerting', {
        notifyOnAccessKeyCreation: config.alerting.notifyOnAccessKeyCreation,
        notifyOnConsoleLogin: config.alerting.notifyOnConsoleLogin,
        subscriberEmailAddresses: config.alerting.subscriberEmailAddresses,
        preserveOnDestroy: config.preserveOnDestroy,
    }).topicArn
    : undefined;
//# sourceMappingURL=index.js.map