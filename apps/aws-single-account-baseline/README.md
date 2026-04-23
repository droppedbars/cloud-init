# AWS Single Account Baseline

This Pulumi project sets up a baseline environment for a single AWS subscription.

## Prerequisites & Security

**IMPORTANT:** Before applying this baseline, you must manually log into the AWS Management Console as the **Root User** and configure a Multi-Factor Authentication (MFA) device. AWS strictly prohibits the programmatic management of root account credentials or MFA devices via Infrastructure as Code. While this baseline successfully enforces MFA for all generated IAM users, the root account itself must be secured by hand.

## Configuration

You can automatically provision IAM users, or attach existing users, to any dynamically assigned group (e.g. `ACCOUNT_ADMIN`) by defining them in the `config.json` file. You can also restrict all created users to specific AWS regions by providing an `allowedRegions` array.

**`config.json` Example:**

```json
{
  "roles": [
    {
      "name": "ACCOUNT_ADMIN_ROLE",
      "policies": ["ACCOUNT_ADMIN_POLICY"]
    }
  ],
  "groups": [
    {
      "name": "ACCOUNT_ADMIN",
      "roles": ["ACCOUNT_ADMIN_ROLE"]
    }
  ],
  "users": [
    {
      "name": "alice",
      "create": true,
      "groups": ["ACCOUNT_ADMIN"]
    },
    {
      "name": "bob",
      "create": false,
      "groups": ["ACCOUNT_ADMIN"]
    }
  ],
  "userPolicies": ["BASIC_ALL_USERS_POLICY"],
  "userPermissionsBoundary": "REGION_RESTRICTION_BOUNDARY",
  "allowedRegions": ["us-east-1", "eu-west-1"],
  "budget": {
    "limitAmount": "100",
    "limitUnit": "USD",
    "subscriberEmailAddresses": ["finance@example.com"]
  }
}
```

In the `"roles"` array, you define discrete IAM Roles and attach an array of `policies` to them. Pulumi will automatically locate local `.ts` files inside your `policy/` directory to satisfy the list (or it will accept raw AWS Managed ARNs).

In the `"groups"` array, you can define User Groups and specify an array of `roles` that members of the group are permitted to assume. Pulumi automatically bridges them by generating a `sts:AssumeRole` trust policy on the group targeting every matched role ARN.

Any user listed with `"create": true` will be dynamically provisioned by Pulumi. Regardless of whether they are created by this baseline or pre-existed in AWS (e.g. `"create": false`), any listed `groups` will automatically be attached to the user.

If `allowedRegions` is provided, a Permissions Boundary (`REGION_RESTRICTION_BOUNDARY`) is automatically created and attached to every provisioned user, explicitly denying actions outside the specified regions (while exempting global services like IAM and Route53).

If `budget` is provided, Pulumi automatically provisions an overarching AWS Cost Budget for the account, setting up notifications to the configured email addresses at both 80% (actual) and 100% (forecasted) thresholds.

## Accessing User Credentials

Upon successful deployment, each user is granted an AWS Management Console login profile with a temporary, auto-generated password (and a forced password reset on first login). Because these passwords are treated as secrets, Pulumi encrypts them in the state file.

To view the temporary passwords after deploying, run:

```bash
pulumi stack output initialPasswords --show-secrets
```

## Stack Management & Naming Collisions

**WARNING:** Because this project serves as a foundational baseline for a _single AWS account_, all generated IAM Roles, Groups, and Policies (such as `ACCOUNT_ADMIN_ROLE`) use **explicit, hardcoded physical names** without stack-specific suffixes.

If you attempt to run this script using a different Pulumi stack (e.g., deploying the `prod` stack after already deploying the `dev` stack) within the exact same AWS account, Pulumi will fail with an `EntityAlreadyExists` error. The AWS account can only house one instance of these explicitly named baseline resources.

_Note: Per our architectural rules, the IAM policy definitions explicitly declare specific actions instead of using wildcards (`_`) to adhere to the Principle of Least Privilege.\*
