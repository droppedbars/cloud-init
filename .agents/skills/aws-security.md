---
name: aws-security-auditor
description: Specialized skill for auditing IAM policies and mitigating privilege escalation risk
globs: ["**/*.ts", "**/iam/**", "**/policies/**"]
---

# AWS Security & Escalation Mitigation Skill

## 1. Privilege Escalation Prevention
When creating or modifying IAM policies, you MUST audit for the following "High Risk" permissions. If detected, flag them and suggest scoped alternatives:

- **iam:PassRole:** Ensure this is restricted with a `Resource` ARN. Never allow `Resource: "*"`.
- **iam:CreateAccessKey:** Block this for any user/role unless explicitly required for a service account.
- **iam:CreatePolicyVersion / SetDefaultPolicyVersion:** Flag these as they allow a user to elevate their own permissions by changing a policy they are already attached to.
- **iam:AttachUserPolicy / AttachRolePolicy:** Verify these are scoped to specific non-admin policies.

## 2. Policy Structure Standards
- **Principle of Least Privilege:** Every `Action` must be paired with a specific `Resource` ARN. 
- **Condition Keys:** Prefer using `aws:PrincipalTag`, `aws:RequestedRegion`, or `aws:SourceVpc` to add layers of security beyond just the ARN.
- **S3 Guardrails:** Every S3 bucket policy generated must explicitly `Deny` non-SSL traffic (`aws:SecureTransport: false`).

## 3. Administrative Boundaries
- **Permission Boundaries:** When creating IAM Roles for developers or automated systems, always suggest attaching a `permissionsBoundary` to limit the maximum available permissions.
- **Account Separation:** Remind the user if they are deploying high-risk resources (like IAM Users) into a "Production" vs "Sandbox" account context based on their Pulumi stack.

## 4. Anti-Patterns to Flag
| Anti-Pattern | Risk | Recommended Fix |
| :--- | :--- | :--- |
| `Action: "s3:*"` | Data Exfiltration | List specific actions (e.g., `s3:GetObject`) |
| `Resource: "*"` | Scope Creep | Use specific Resource ARNs or tags |
| `Effect: "Allow"` on `iam:*` | Total Takeover | Use Service Control Policies (SCPs) or Boundaries |

## 5. Security Validation Workflow
Before finalizing any Pulumi code involving `aws.iam`, run this internal check:
1. **Does this policy allow `iam:PassRole`?** If so, is it scoped?
2. **Does this allow a user to edit their own permissions?**
3. **Are there any "Star" (*) actions?**
4. **Is sensitive data (like `SecretManager` access) restricted by tags?**

> **Note:** If the user asks to "Sudo" or "Bypass" these rules, provide a warning about the specific escalation path being opened before proceeding.