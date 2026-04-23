## Pulumi Architecture Patterns

- **Prefer ComponentResources:** Wrap related resources (e.g., a VPC + Subnets + IGW) into a single `ComponentResource` class to reduce top-level stack complexity.
- **Explicit Logical Naming:** Always use descriptive logical names (the first argument in the constructor). Do NOT hardcode physical names; let Pulumi handle auto-naming with random suffixes to prevent collisions.
- **Stack References:** When accessing outputs from other stacks, use `pulumi.StackReference` rather than hardcoding resource IDs.

## Infrastructure Safety

- **Secret Hygiene:** Never pass sensitive strings (API keys, DB passwords) as plain text. Use `pulumi.Config.requireSecret()` or `pulumi.secret()`.
- **Delete Protection:** For stateful resources (Databases, S3 Buckets, EIPs), always set the resource option `{ protect: true }`.
- **Preview First:** Any command involving `pulumi up` or `pulumi destroy` MUST be preceded by a summary of the `pulumi preview` output for user confirmation.
- **No Wildcards:** In IAM policies or security groups, never use `*` for actions or CIDR blocks unless explicitly requested.

## Coding Conventions

- **Lint:** Always use the tools defined in the package.json to lint and format the code.

## Documentation

- **Documentation is critical:** Always keep the documentation up to date with the latest changes in the codebase.
- **EXPLANATION.md**: Update this file with the latest changes in the codebase focused on architectural, or tooling changes. For specific app changes, update the README.md in the specific app directory.
- **config.json-example**: Always keep this file up to date with the latest changes in the codebase.
