# AWS Single Account Baseline: System Walkthrough

This document is designed for developers new to the codebase. It provides a concise overview of how the Pulumi application translates a configuration file into a robust AWS security and identity baseline.

## 🎯 The High-Level Goal
This project provisions a foundational AWS baseline. Instead of writing Pulumi code for every new user or role, the system dynamically generates IAM Users, Groups, Roles, Policies, and Security Alerts based entirely on a declarative `config.json` file.

## 🔄 Execution Flow (How it Works)

The orchestration happens inside `index.ts`, which follows a specific sequence:

1. **Ingest Config**: `configLoader.ts` reads `config.json`, acting as the single source of truth for the entire deployment. This includes determining the `identityStrategy` (Traditional IAM vs. IAM Identity Center).
2. **Policy Deduplication**: Iterates through the config to determine which IAM policies are needed. It generates shared policies (like MFA enforcement) centrally so they are only created once in AWS.
3. **Role Creation**: Generates IAM Roles or SSO Permission Sets (`DynamicRole.ts`) and attaches the requested policies and permission boundaries to them.
4. **Group Provisioning**: Generates IAM Groups or Identity Store Groups (`DynamicGroup.ts`). For Traditional IAM, it automatically creates and attaches an `sts:AssumeRole` policy granting group members permission to assume the specific Roles defined in the config. For Identity Center, it maps the groups to their respective Permission Sets using Account Assignments.
5. **Password Policy**: Enforces a deterministic account password policy to ensure first-login resets function smoothly (Traditional IAM only).
6. **User Provisioning**: Creates IAM Users or Identity Store Users (`BaselineUsers.ts`). For Traditional IAM, it generates temporary passwords encrypted in Pulumi state and forces a password reset on first login.
7. **Group Membership**: Attaches the users to their respective Groups (`UserGroupMemberships.ts`), handling resource dependencies automatically.
8. **Guardrails & Security**: Provisions ancillary components like Cost Budgets (with an optional Lambda-based automated kill-switch) (`AccountBudget.ts`) and a multi-region CloudTrail alerting pipeline (`SecurityAlerting.ts`) for events like Access Key creation.

---

## 📂 Directory Navigation Guide

When making changes, use this guide to find the relevant code:

- **`config.json` & `config.json-example`**: 
  - **What it is**: The declarative configuration. 
  - **Why touch it**: To add/remove users, define new roles, modify group memberships, or restrict allowed AWS regions.

- **`index.ts`**: 
  - **What it is**: The main Pulumi entry point. 
  - **Why touch it**: If you need to change the order of operations, add a new overarching component, or debug how policies are mapped to roles.

- **`/components/`**: 
  - **What it is**: Pulumi `ComponentResource` classes that encapsulate and abstract complex AWS infrastructure patterns.
  - **`DynamicRole.ts`**: Provisions IAM roles and trust policies, or SSO Permission Sets.
  - **`DynamicGroup.ts`**: Provisions groups and handles the critical `AssumeRole` or SSO Account Assignment mapping so users can switch to roles.
  - **`BaselineUsers.ts`**: Handles user creation and login profiles.
  - **`UserGroupMemberships.ts`**: Maps users to their designated groups.
  - **`AccountBudget.ts`**: Provisions Cost Budgets and an optional Lambda kill-switch.
  - **`SecurityAlerting.ts`**: Builds the CloudTrail → CloudWatch Logs → SNS pipeline.

- **`/policy/`**: 
  - **What it is**: Functions that return raw AWS IAM JSON documents. 
  - **Why touch it**: If you need to modify the granular permissions of a role or the baseline security posture.
  - *Key Files*:
    - `BASIC_ALL_USERS_POLICY.ts`: The core baseline that blocks actions unless the user has authenticated with MFA.
    - `SELF_SERVICE_MFA_POLICY.ts`: Attached directly to groups so users can bootstrap their own MFA devices *before* assuming roles.
    - `REGION_RESTRICTION_BOUNDARY.ts`: A boundary applied to lock down infrastructure to specific regions.

---

## ⚠️ Important Developer "Gotchas"

1. **MFA is Strictly Enforced**: All dynamic roles require MFA (`"aws:MultiFactorAuthPresent": "true"`) in their trust policy. If you create a user, log in, and set up MFA, **you must sign out and sign back in** before you can switch roles. The active session must be an MFA session.
2. **Direct vs. Assumed Permissions**: Permissions needed to *set up* an account (like managing your own MFA or access keys) are granted directly to the Group via `sharedPolicyArns`. Permissions needed to *operate* AWS (like EC2 or S3 access) are granted to Roles that the user assumes.
3. **Hardcoded Naming**: The system uses explicit names without random suffixes (e.g., `ACCOUNT_ADMIN_ROLE`). You cannot deploy this stack multiple times in the exact same AWS account without causing `EntityAlreadyExists` collisions.
