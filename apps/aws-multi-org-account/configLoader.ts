import * as fs from 'fs';
import * as path from 'path';

export interface GroupAssignmentConfig {
  target: string; // The name of an Account or an Organizational Unit
  permissionSet: string; // The name of the permission set to assign
}

export interface GroupConfig {
  name: string;
  assignments?: GroupAssignmentConfig[];
}

export interface AccountConfig {
  name: string;
  email: string;
}

export interface OrganizationalUnitConfig {
  name: string;
  accounts: AccountConfig[];
}

export interface PermissionSetConfig {
  name: string;
  managedPolicies?: string[];
}

export interface UserConfig {
  name: string;
  email?: string;
  create: boolean;
  groups: string[];
}

export interface Config {
  ssoRegion: string;
  retainOnDelete?: boolean;
  organizationalUnits?: OrganizationalUnitConfig[];
  permissionSets?: PermissionSetConfig[];
  groups: GroupConfig[];
  users: UserConfig[];
  tags?: Record<string, string>;
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
    retainOnDelete: configData.retainOnDelete ?? false,
    organizationalUnits: configData.organizationalUnits || [],
    permissionSets: configData.permissionSets || [],
    groups: configData.groups || [],
    users: configData.users || [],
    tags: configData.tags || {},
  };
}
