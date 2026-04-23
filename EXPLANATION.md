# Project Setup and Architecture

This repository is structured as a **monorepo** utilizing NPM Workspaces and Turborepo. The goal of this architecture is to manage multiple Pulumi infrastructure projects ("apps") alongside shared configurations ("packages") efficiently, with centralized tooling and caching.

## Directory Structure

The repository is divided into two primary directories:

- `apps/`: Contains the actual deployable applications and infrastructure code. For example, `aws-single-account` is a Pulumi project that provisions an AWS environment.
- `packages/`: Contains internal, shared dependencies that are not deployed on their own but are consumed by the apps. Examples include shared ESLint and TypeScript configurations.

## Tooling Breakdown

### Turborepo

[Turborepo](https://turbo.build/) is the build system used to orchestrate tasks across the monorepo.

- **Configuration**: Found in `turbo.json` at the root of the project.
- **How it works**: Turborepo allows us to run scripts (like `lint`, `build`, `preview`, `deploy`) across all apps and packages simultaneously, respecting dependency graphs.
- **Caching**: It caches task outputs and logs. If a task (e.g., `lint`) has already been run and the underlying source code hasn't changed, Turborepo will instantly return the cached result rather than re-running the task, saving significant CI/CD and local development time.

### ESLint & Shared Configurations

To ensure consistent code quality and formatting without duplicating configuration files across every project, we use **Internal Packages**:

- **@cloud-baseline/eslint-config**: Located in `packages/eslint-config`, this package houses the base ESLint, TypeScript parser plugins, and Prettier configurations.
- **@cloud-baseline/typescript-config**: Located in `packages/typescript-config`, this package provides a base `tsconfig.json` defining strict compiler options.

**How it works**:
The `eslint-config` package exports the central ruleset. An app like `aws-single-account` simply adds `"@cloud-baseline/eslint-config": "*"` to its local `package.json` `devDependencies` and extends it in its own local `eslint.config.js` file:

```javascript
const baseConfig = require('@cloud-baseline/eslint-config');
module.exports = [...baseConfig];
```

This guarantees that linting and formatting rules remain completely uniform across all infrastructure baseline apps, while abstracting the complex rule definitions away from the actual code.

### Pulumi

[Pulumi](https://www.pulumi.com/) is our Infrastructure as Code (IaC) tool. It allows us to define cloud infrastructure using TypeScript.

- **How it's setup**: Each directory within `apps/` (e.g., `apps/aws-single-account`) is an independent Pulumi project, identifiable by its `Pulumi.yaml` and `package.json` files.
- **Execution Workflow**:
  - **Stack Initialization**: Before deploying, you initialize a "stack" (an isolated instance of your Pulumi program, e.g., `dev` or `prod`) using `pulumi stack init`.
  - **Configuration**: Stack-specific configurations (like regions) are set via `pulumi config set`.
  - **Preview**: You run `pulumi preview` to see a detailed diff of exactly what AWS resources Pulumi intends to create, modify, or delete.
  - **Up/Deploy**: Running `pulumi up` executes the instructions and provisions the resources in your AWS account.
- **Monorepo Integration**: While Pulumi manages the physical deployment and infrastructure state, Turborepo wraps the operational scripts. By defining `"preview"` and `"deploy"` pipelines in `turbo.json`, you have the foundation to run validations or deployments across multiple AWS account baselines in a standardized pipeline.

### AI Agent Configuration

This repository leverages AI-powered development assistance (like Antigravity) with explicit, project-level instructions to ensure code safety, architectural consistency, and strict operational workflows.

- **`AGENTS.md`**: Found at the root of the project, this file acts as the primary global ruleset. It defines critical architectural patterns (e.g., wrapping resources in `ComponentResource`, logical naming conventions) and fundamental security guardrails (e.g., secret hygiene, protecting stateful resources). The AI agent constantly cross-references these rules when writing or modifying code.
- **`.agents/` Directory**: Contains more granular, domain-specific AI rules. For instance, a `pulumi.md` file here maps specifically to Pulumi files (`*.ts`, `**/apps/**`). It enforces type-safety guidelines, IAM best practices (Principle of Least Privilege), and strict operational workflows (like mandating that `pulumi preview` output must be evaluated and verified by the user before running destructive operations like replacements or deletions).

**How it works**:
When an AI agent is invoked within this workspace, it parses these files to understand the specific context, constraints, and strict boundaries of the repository. This guarantees that any AI-generated infrastructure code natively adheres to the organization's compliance, stylistic, and safety standards out-of-the-box, acting as an automated guardrail during development.
