# Testing Guide: AWS Single Account Baseline

This document outlines how to verify the security guardrails and automated features provisioned by this baseline. Because this project manages IAM permissions, alerting, and cost-controls, it is critical to verify that the AWS environment behaves exactly as expected after deployment.

---

## 🚀 Automated End-to-End Testing (Recommended)

The easiest way to verify the core guardrails is to run the automated E2E script. This script orchestrates Pulumi, swaps in a mock configuration, and drives both manual prompts and automated AWS CLI checks.

Ensure you have administrative AWS credentials active in your terminal, then run:

```bash
npm run test:e2e
```

**What the script does:**
1. Temporarily replaces your `config.json` with a test payload.
2. Initializes and deploys a throwaway Pulumi stack (`e2e-test`).
3. Pauses execution and hands you a temporary password to manually verify the MFA enforcement (Phase 1).
4. Automatically spins up an EC2 instance and fires a simulated AWS Budget SNS notification to verify the Kill Switch successfully stops the instance (Phase 2).
5. Destroys the infrastructure and restores your original configuration.

---

## Manual Verification Steps

If you prefer to verify features against your actual production stack, follow the manual steps below.

### 1. MFA Enforcement & Role Assumption

All dynamically generated roles require an MFA-authenticated session to assume.

**To verify failure (Password-only session):**
1. Sign in to the AWS Console using a baseline user password.
2. *Do not* set up an MFA device.
3. Attempt to Switch Roles to a role you are authorized for (e.g., `ACCOUNT_ADMIN_ROLE`).
4. **Expected Result:** AWS will display an "Invalid information in one or more fields" error (which is STS masking an Access Denied error).

**To verify success (MFA session):**
1. Navigate to "Security Credentials" and set up a Virtual MFA device.
2. **Sign out of the AWS Console entirely.**
3. Sign back in using your password *and* the new MFA code.
4. Attempt to Switch Roles to the same role.
5. **Expected Result:** The role switch succeeds.

---

## 2. Region Restriction Boundary

The baseline applies the `REGION_RESTRICTION_BOUNDARY` to lock down infrastructure creation to your `allowedRegions`.

**Prerequisite:** Assume a role that has administrative or developer permissions (e.g., `ACCOUNT_ADMIN_ROLE` or `GLOBAL_DEVELOPER_ROLE`).

**To verify failure (Blocked Region):**
1. In the AWS CLI, run a command to list or describe resources in a region *not* in your `config.json` allowed regions (e.g., `ap-southeast-1`):
   ```bash
   aws ec2 describe-instances --region ap-southeast-1
   ```
2. **Expected Result:** `AccessDeniedException`.

**To verify success (Allowed Region):**
1. Run the same command in an allowed region (e.g., `us-east-1`):
   ```bash
   aws ec2 describe-instances --region us-east-1
   ```
2. **Expected Result:** A successful JSON response containing reservations.

---

## 3. Security Alerting Pipeline

The alerting pipeline monitors CloudTrail in real-time for high-risk actions (like access key creation or root console logins).

**To verify the pipeline:**
1. From your local terminal (or the AWS Console), create a new access key for your user:
   ```bash
   aws iam create-access-key
   ```
2. **Expected Result:** Within 5 to 15 minutes, the `subscriberEmailAddresses` defined in your `alerting` configuration should receive an SNS email containing the CloudWatch Alarm trigger details for the Access Key Creation event.

---

## 4. Account Cost Kill Switch

The Kill Switch responds to AWS Budgets by executing a Lambda function that stops all running EC2 and RDS instances across all enabled AWS regions.

**To verify the shutdown logic (without waiting for the billing cycle):**
1. Launch a temporary, cheap EC2 instance (e.g., `t3.nano`) in any region. Ensure it is in the `running` state.
2. Find the SNS Topic ARN for the Kill Switch. You can find this in the AWS Console (under Amazon SNS -> Topics) named similarly to `*kill-switch-topic*`.
3. Use the AWS CLI to manually publish a message to that SNS Topic, simulating an AWS Budget trigger:
   ```bash
   aws sns publish \
     --topic-arn "arn:aws:sns:REGION:ACCOUNT_ID:account-init-budget-kill-switch-topic" \
     --message "Test Kill Switch Simulation"
   ```
4. **Expected Result:** 
   - You will immediately receive the raw SNS email to the configured `killSwitch` subscriber addresses.
   - Wait 1-2 minutes and refresh the EC2 Console. Your test instance should transition to the `stopping` or `stopped` state.
   - *(Optional)* You can verify the execution logs in CloudWatch Logs under the Lambda function `/aws/lambda/*kill-switch-fn`.

**To verify the Budget trigger:**
Because AWS Budgets evaluate costs asynchronously, you cannot trigger them instantly. To test the real trigger:
1. Temporarily change `killSwitch.thresholdAmount` in `config.json` to `"0.01"`.
2. Run `pulumi up`.
3. Over the next 8-12 hours, the next billing cycle will evaluate your costs. Assuming your account has incurred > $0.01, the budget will officially trigger, sending the AWS Budget formatted email and invoking the shutdown Lambda.
