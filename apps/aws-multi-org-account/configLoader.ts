import * as fs from 'fs';
import * as path from 'path';

export interface PolicyConfig {
  name: string;
  allowedActions?: string[];
}

export interface RoleConfig {
  name: string;
  policies: (string | PolicyConfig)[];
  permissionsBoundary?: string;
}

export interface GroupAssignmentConfig {
  roles: string[];
  target: string; // The name of an Account or an Organizational Unit
}

export interface GroupConfig {
  name: string;
  roles?: string[]; // Legacy: assigns to the management account
  assignments?: GroupAssignmentConfig[];
  /** When true, attaches MANAGE_ACCESS_KEYS_POLICY granting iam:CreateAccessKey and iam:UpdateAccessKey to the group. */
  allowAccessKeyManagement?: boolean;
}

export interface AccountConfig {
  name: string;
  email: string;
}

export interface OrganizationalUnitConfig {
  name: string;
  accounts: AccountConfig[];
}

export interface UserConfig {
  name: string;
  email?: string;
  create: boolean;
  groups: string[];
}

export interface BudgetConfig {
  limitAmount: string;
  limitUnit: string;
  subscriberEmailAddresses: string[];
  killSwitch?: {
    thresholdAmount: string;
    subscriberEmailAddresses: string[];
  };
}

export interface AlertingConfig {
  /** Fire an alert when any IAM user creates an access key. */
  notifyOnAccessKeyCreation: boolean;
  /** Fire an alert when any user signs into the AWS Console. */
  notifyOnConsoleLogin: boolean;
  /** Email addresses that will receive the SNS notifications. */
  subscriberEmailAddresses: string[];
}

export interface Config {
  ssoRegion: string;
  organizationalUnits?: OrganizationalUnitConfig[];
  roles: RoleConfig[];
  groups: GroupConfig[];
  users: UserConfig[];
  allowedRegions: string[];
  budget?: BudgetConfig;
  alerting?: AlertingConfig;
  tags?: Record<string, string>;
  /**
   * When true, sets protect:true on durable resources (CloudTrail, S3 audit log bucket,
   * CloudWatch log group, SNS topic, and IAM users) so they survive a pulumi destroy.
   * Defaults to false — destruction is permitted by default.
   */
  preserveOnDestroy?: boolean;
}

export function loadConfig(): Config {
  const configPath = process.env.BASELINE_CONFIG_PATH
    ? path.resolve(process.cwd(), process.env.BASELINE_CONFIG_PATH)
    : path.join(__dirname, 'config.json');

  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found at ${configPath}`);
  }

  const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return {
    ssoRegion: configData.ssoRegion || 'us-east-1',
    organizationalUnits: configData.organizationalUnits || [],
    roles: configData.roles || [],
    groups: configData.groups || [],
    users: configData.users || [],
    allowedRegions: configData.allowedRegions || [],
    budget: configData.budget,
    alerting: configData.alerting,
    tags: configData.tags || {},
    preserveOnDestroy: configData.preserveOnDestroy ?? false,
  };
}
