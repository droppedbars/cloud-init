# Architectural Decisions & Changes

This document tracks the core architectural decisions and refactors made specifically to the `aws-multi-org-account` Pulumi project.

## Discovery-First Provisioning (Adopt-if-Exists)

To eliminate the brittle nature of manual boolean flags (e.g., `createOrganization`, `enableIdentityCenter`), the architecture has been overhauled to prioritize **automatic resource discovery**.

1. **Organizations:** The script now checks if the management account is already part of an AWS Organization. If so, it adopts the existing organization rather than attempting to create a new one.
2. **Identity Center:** The deployment enforces an early-exit guardrail. If AWS IAM Identity Center is not enabled in the management account, the script will intentionally fail and prompt the user to enable it manually. This ensures that the required Identity Store and SSO structures are fully initialized by AWS before Pulumi attempts to manage them.
3. **Accounts & OUs:** If an Organizational Unit (OU) or Account already exists with the requested name, Pulumi retrieves its ID and adopts it into the deployment graph. 

## Automated Suspended Account Handling

When AWS accounts are closed, they remain in a "suspended" state for 90 days. Because AWS enforces globally unique email addresses and prevents reusing the exact same account name within an organization, a collision occurs if the Pulumi script attempts to re-provision a previously closed account.

To solve this, the script automatically detects if an existing account is in a suspended state. If it is, the script generates a randomized 4-character suffix and appends it to both the account name (e.g., `Foo2-a1b2`) and the email address (using the `+` subaddressing feature: `foo2+a1b2@example.com`).

## Centralized Root Access Management

To improve security posture, the project automatically enables the `RootCredentialsManagement` and `RootSessions` features across the AWS Organization using the `aws.iam.OrganizationsFeatures` resource. This centralizes root access management to the management account, reducing reliance on long-term root user credentials in member accounts.

To facilitate this, the deployment ensures that **Trusted Access for IAM** (`iam.amazonaws.com`) is enabled in the AWS Organization. If an existing organization is adopted, the `aws.organizations.AwsServiceAccess` resource is dynamically injected to enable this integration.

## Identity Center Region Constraints & Opt-in Regions

When configuring the `"ssoRegion"` in `config.json`, the specified region **must be an AWS region that is enabled by default** (e.g., `us-east-1`, `ca-central-1`, `us-west-2`). 

AWS IAM Identity Center creates permission sets by assuming cross-account service-linked roles. If Identity Center is deployed in an **opt-in region** (such as `ca-west-1` / Calgary), newly provisioned member accounts will **not** have that region enabled by default. Consequently, Identity Center will be completely unable to manage those accounts, resulting in an obscure AWS timeout error during the `aws.ssoadmin.AccountAssignment` phase:

> `Obtaining permissions to manage your AWS account is taking longer than usual.`

Because there is no simple way to programmatically opt a new member account into a region using only the management account's provider, the architectural constraint stands: **Identity Center must be hosted in an enabled-by-default region for automated multi-account provisioning to succeed.**

## Simplification of Permissions

To resolve cross-account race conditions and eliminate dependency hell during initial provisioning, the identity model has been heavily simplified. Custom Permission Sets, custom roles, and budget kill switches have been temporarily removed. The system now exclusively uses the AWS-managed `AdministratorAccess` policy for all assigned group permissions. 
