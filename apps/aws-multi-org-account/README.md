# AWS Multi-Account Organization Baseline

This Pulumi project establishes a baseline environment for an AWS Organization with multiple member accounts. It automatically discovers your existing AWS Organization (or creates one if it doesn't exist), provisions Organizational Units (OUs), creates member accounts, and configures IAM Identity Center (SSO) for centralized access management.

## Prerequisites & Constraints

### 1. Manual Identity Center Enablement
You **must** manually enable AWS IAM Identity Center in your AWS Management Console before running this Pulumi stack. AWS does not permit provisioning the core Identity Center Instance programmatically via standard Pulumi/Terraform APIs. If Identity Center is not enabled, the Pulumi deployment will intentionally fail early to protect your infrastructure state.

### 2. Identity Center Region Constraints
When specifying `"ssoRegion"` in your `config.json`, the selected region **MUST be an AWS region that is enabled by default** (e.g., `us-east-1`, `ca-central-1`, `us-west-2`). 

**Do not deploy Identity Center in an "opt-in" region** (like `ca-west-1` / Calgary). Because newly provisioned AWS member accounts do not have opt-in regions enabled by default, Identity Center will be completely unable to manage those new accounts, resulting in hanging `aws.ssoadmin.AccountAssignment` resources and deployment timeouts.

## Configuration

The infrastructure is defined entirely by the `config.json` file located in the root of the project.

**`config.json` Example:**

```json
{
  "ssoRegion": "ca-central-1",
  "organizationalUnits": [
    {
      "name": "Workloads",
      "accounts": [
        {
          "name": "Production",
          "email": "prod@example.com"
        },
        {
          "name": "Staging",
          "email": "staging@example.com"
        }
      ]
    }
  ],
  "groups": [
    {
      "name": "OWNERS",
      "assignments": [
        {
          "target": "Management"
        },
        {
          "target": "Production"
        }
      ]
    },
    {
      "name": "DEVELOPERS",
      "assignments": [
        {
          "target": "Staging"
        }
      ]
    }
  ],
  "users": [
    {
      "name": "alice",
      "email": "alice@example.com",
      "create": true,
      "groups": ["OWNERS"]
    },
    {
      "name": "bob",
      "email": "bob@example.com",
      "create": true,
      "groups": ["DEVELOPERS"]
    }
  ],
  "tags": {
    "Environment": "prod",
    "Owner": "platform-team"
  }
}
```

### Auto-Discovery (Adopt-if-Exists)

The project employs a robust "discovery-first" pattern:
- **Organizations:** If the executing account is already a management account of an AWS Organization, Pulumi will adopt and use it automatically.
- **OUs and Accounts:** If OUs or Accounts with the requested names already exist within your organization, Pulumi will retrieve their metadata and manage them without attempting to blindly recreate them.

### Suspended Accounts & Naming Collisions

When an AWS account is closed, it remains in a "suspended" state for 90 days. During this period, the account name and email address are locked to prevent collisions. If the Pulumi script attempts to provision an account and detects that an account with that name is currently suspended, it will automatically generate a randomized 4-character suffix (e.g., `Production-f83e` and `prod+f83e@example.com`) to bypass the collision gracefully.

### Centralized Root Access

The project automatically enables the `RootCredentialsManagement` and `RootSessions` features within your AWS Organization. This strictly centralizes root user access control to your management account and drastically reduces the security risk of managing long-term root credentials in your member accounts.

## Deployment

To deploy the infrastructure, authenticate to AWS via the CLI as your management account, ensure your `config.json` is configured properly (with a valid, default-enabled `ssoRegion`), and run:

```bash
pulumi up
```
