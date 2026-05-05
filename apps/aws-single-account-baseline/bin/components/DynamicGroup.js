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
exports.DynamicGroup = void 0;
const pulumi = __importStar(require("@pulumi/pulumi"));
const aws = __importStar(require("@pulumi/aws"));
const GROUP_ASSUME_ROLE_POLICY_1 = require("../policy/GROUP_ASSUME_ROLE_POLICY");
class DynamicGroup extends pulumi.ComponentResource {
    constructor(name, args, opts) {
        var _a;
        super(`cloud-baseline:iam:DynamicGroup:${args.groupName}`, name, args, opts);
        const group = new aws.iam.Group(args.groupName, {
            name: args.groupName,
        }, { parent: this });
        // Create Assume Role Policies for each role this group is permitted to assume
        Object.entries(args.roles).forEach(([roleName, roleArn]) => {
            const groupAssumeRolePolicyDoc = (0, GROUP_ASSUME_ROLE_POLICY_1.getGroupAssumeRolePolicyDocument)(roleArn);
            const assumePolicyName = `${args.groupName}_ASSUME_${roleName}_POLICY`;
            const groupAssumeRolePolicy = new aws.iam.Policy(assumePolicyName, {
                name: assumePolicyName,
                policy: groupAssumeRolePolicyDoc.json,
            }, { parent: this });
            new aws.iam.GroupPolicyAttachment(`${args.groupName}_${roleName}_ATTACHMENT`, {
                group: group.name,
                policyArn: groupAssumeRolePolicy.arn,
            }, { parent: this });
        });
        // Attach shared baseline policies (e.g. self-service MFA) directly to the group
        // so members have these permissions in their direct session before assuming a role.
        ((_a = args.sharedPolicyArns) !== null && _a !== void 0 ? _a : []).forEach((policyArn, i) => {
            new aws.iam.GroupPolicyAttachment(`${args.groupName}-shared-policy-${i}`, { group: group.name, policyArn }, { parent: this });
        });
        this.groupName = group.name;
        this.groupArn = group.arn;
        this.registerOutputs({
            groupName: this.groupName,
            groupArn: this.groupArn,
        });
    }
}
exports.DynamicGroup = DynamicGroup;
//# sourceMappingURL=DynamicGroup.js.map