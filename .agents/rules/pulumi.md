---
trigger: always_on
---

---

name: pulumi-expert
description: Standards for infrastructure-as-code using Pulumi
globs: ["**/apps/**", "*.ts", "Pulumi.*.yaml"]

---

# Pulumi & IaC Standards

## 1. Resource Governance

- **Component Pattern:** For any group of 3+ related resources, wrap them in a `pulumi.ComponentResource`.
- **Logical Naming:** Resource names must follow the pattern `${project}-${stack}-${resourceName}`.
- **Protected Resources:** Any resource categorized as "Stateful" (Database, S3 Bucket, KMS Key) MUST include `protect: true` in its `CustomResourceOptions`.
- **Policies:** Policies must exist in a separate file that is imported by the Pulumi code. The file name must match the intended policy name, excluding any uniqueness added to avoid collisions. Policy references to specifc ARNs must be parameterized.

## 2. Type Safety & Outputs

- **Output Handling:** Never use `.toString()` or string interpolation on an `Output<T>`.
- **Interpolation:** Always use `pulumi.interpolate` for combining outputs with strings.
- **Explicit Returns:** When writing `ComponentResources`, explicitly define an `interface` for the component's `Args` and `Outputs`.

## 3. Security & Secrets

- **Zero-Plain-Text:** Any variable containing "key", "password", "secret", or "token" must be retrieved via `config.requireSecret()`.
- **IAM Principle of Least Privilege:**
  - Avoid `AdministratorAccess`.
  - Generate scoped policies for specific ARNs rather than `*`.
  - Use `aws.iam.getPolicyDocument` for cleaner JSON generation.

## 4. Operation Workflow (The "Skill" Trigger)

- **Preview First:** Before suggesting an "up" command, summarize the `pulumi preview` results. Ensure you run `pulumi preview` from within the apps/<project> directory.
- **Destructive Warning:** If a preview indicates a **Replace** or **Delete** for a stateful resource, highlight this in **BOLD RED TEXT** and ask for explicit user verification.
- **Refactoring:** If renaming a resource, you MUST include an `aliases` array in the options to prevent resource recreation.

## 5. Language Specifics (TypeScript)

- Use `import * as pulumi from "@pulumi/pulumi";`
- Use `import * as aws from "@pulumi/aws";`
- Prefer `const` over `let` for resource declarations.
